import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const pwsh = process.env.PWSH_BIN || (process.platform === 'win32' ? 'powershell.exe' : '')
if (!pwsh && process.env.REQUIRE_POWERSHELL_TESTS === '1') throw new Error('PowerShell required')
const psTest = pwsh ? test : test.skip
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const scripts = resolve(import.meta.dir, '../../../router/install_scripts')

// Execute production function definitions, not top-level credential/config writes.
// OS discovery and capability responses are fixture seams.
function discovery(script: string, scenario: string) {
  const root = mkdtempSync(join(tmpdir(), 'an-win-discovery-'))
  roots.push(root)
  const app = join(root, 'OpenAI.Codex_26.901')
  const local = join(root, 'Local')
  const stable = join(local, 'OpenAI', 'Codex', 'bin', 'stable', 'codex.exe')
  const old = join(root, 'npm', 'codex.cmd')
  const stale = join(local, 'OpenAI', 'Codex', 'bin', 'alpha', 'codex.exe')
  for (const path of [stable, old, stale]) {
    mkdirSync(resolve(path, '..'), { recursive: true })
    writeFileSync(path, path === stable ? 'compatible fixture' : 'incompatible fixture')
  }
  mkdirSync(app)
  const runner = join(root, 'probe.ps1')
  writeFileSync(runner, [
    "$ErrorActionPreference = 'Stop'",
    "$tokens = $null; $errors = $null",
    "$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:SCRIPT_UNDER_TEST, [ref]$tokens, [ref]$errors)",
    "if ($errors.Count) { throw 'PowerShell parse failed' }",
    "foreach ($definition in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) { . ([scriptblock]::Create($definition.Extent.Text)) }",
    // Windows may enumerate the long path even when tmpdir() uses an 8.3 alias.
    // Identify the fixture by its contents, not the spelling of the same path.
    "function Test-CodexNativeCompatibility([string]$CodexExe) { return (Get-Content -LiteralPath $CodexExe -Raw) -eq 'compatible fixture' }",
    "function Get-Command { param([string]$Name, [switch]$All, $ErrorAction); if ($Name -eq 'codex') { return [pscustomobject]@{ CommandType='Application'; Source=$env:OLD_CLI } }; if ($Name -eq 'Get-AppxPackage') { return [pscustomobject]@{ Name='Get-AppxPackage' } } }",
    "function Get-AppxPackage { param([string]$Name, $ErrorAction); if ($Name -eq 'OpenAI.Codex') { return [pscustomobject]@{ InstallLocation=$env:APP_ROOT } } }",
    "if ($env:SCENARIO -eq 'choose-compatible') {",
    "  $selected = Resolve-CodexExecutable $false",
    "  if (-not $selected -or (Get-Content -LiteralPath $selected -Raw) -ne 'compatible fixture') { throw 'Selected stale or npm CLI instead of compatible CLI' }",
    "  Write-Output 'compatible-selected'",
    "} elseif ($env:SCENARIO -eq 'missing-desktop') {",
    "  try { Assert-CodexDesktopRuntime; throw 'Missing desktop runtime was accepted' }",
    "  catch { if ($_.Exception.Message -notlike '*missing its bundled CLI*') { throw }; Write-Output 'missing-desktop-blocked' }",
    "} elseif ($env:SCENARIO -eq 'invalid-override') {",
    "  $env:ANYROUTERS_CODEX_BIN = Join-Path $env:APP_ROOT 'missing.exe'",
    "  try { Resolve-CodexExecutable $false; throw 'Invalid override was accepted' }",
    "  catch { if ($_.Exception.Message -notlike '*does not point to an existing executable*') { throw }; Write-Output 'override-blocked' }",
    "} elseif ($env:SCENARIO -eq 'broken-candidate') {",
    "  $definition = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-CodexNativeCompatibility' }, $false)[0]",
    "  . ([scriptblock]::Create($definition.Extent.Text))",
    "  $ConflictingCodexEnvNames = @(); $Model = 'gpt-6-astra'",
    "  function Invoke-CodexCaptured { throw 'Executable cannot start' }",
    "  if (Test-CodexNativeCompatibility 'broken.exe') { throw 'Broken candidate accepted' }",
    "  Write-Output 'broken-candidate-skipped'",
    "}",
  ].join('\n'))
  const env = { ...process.env, ANYROUTERS_CODEX_BIN: '', LOCALAPPDATA: local,
    STABLE_CLI: stable, OLD_CLI: old, APP_ROOT: app, SCENARIO: scenario,
    SCRIPT_UNDER_TEST: join(scripts, script) }
  return spawnSync(pwsh, ['-NoLogo', '-NoProfile', '-File', runner], { env, encoding: 'utf8', timeout: 15000 })
}

for (const script of ['codex.ps1', 'codex-config.ps1']) {
  psTest('PowerShell ' + script + ' skips an executable that cannot start', () => {
    const result = discovery(script, 'broken-candidate')
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('broken-candidate-skipped')
  })
  psTest('PowerShell ' + script + ' selects compatible CLI past stale npm and alpha copies', () => {
    const result = discovery(script, 'choose-compatible')
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('compatible-selected')
  })
  psTest('PowerShell ' + script + ' recognizes OpenAI.Codex and blocks missing bundled runtime', () => {
    const result = discovery(script, 'missing-desktop')
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('missing-desktop-blocked')
  })
  psTest('PowerShell ' + script + ' rejects missing explicit CLI override', () => {
    const result = discovery(script, 'invalid-override')
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
}

test('Windows standalone scripts share the same discovery and update implementation', () => {
  const helper = (name: string) => {
    const text = readFileSync(join(scripts, name), 'utf8')
    return text.slice(text.indexOf('function Get-CodexCliCandidates'), text.indexOf('function Test-CodexNativeCompatibility'))
  }
  expect(helper('codex.ps1')).toBe(helper('codex-config.ps1'))
})
