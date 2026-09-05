import { afterEach, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const scriptsDir = resolve(import.meta.dir, '../../../router/install_scripts')
const tempDirs: string[] = []
const detectedPowerShell =
  process.platform === 'win32'
    ? spawnSync('where.exe', ['powershell.exe'], { encoding: 'utf8' }).stdout
    : spawnSync('/bin/sh', ['-lc', 'command -v pwsh'], { encoding: 'utf8' }).stdout
const pwshBin =
  process.env.PWSH_BIN || detectedPowerShell?.trim().split(/\r?\n/, 1)[0] || ''
if (process.env.REQUIRE_POWERSHELL_TESTS === '1' && !pwshBin) {
  throw new Error('PowerShell runtime is required; refusing to skip installer checks')
}
// The real installers intentionally manage User-scope environment variables on
// Windows. Run their fixtures only on a disposable runner, never a personal PC.
if (
  process.platform === 'win32' &&
  process.env.ANYROUTERS_DISPOSABLE_WINDOWS_TEST_HOST !== '1'
) {
  throw new Error('Windows installer fixtures require a disposable test host')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function source(name: string) {
  return readFileSync(join(scriptsDir, name), 'utf8')
}

function fixture(
  options: {
    includeLuna?: boolean
    nativeCapabilities?: boolean
    emptyNativeCapabilities?: boolean
  } = {}
) {
  const includeLuna = options.includeLuna ?? true
  const nativeCapabilities = options.nativeCapabilities ?? true
  return {
    generated_at: 'native-fixture',
    models: [
      {
        slug: 'gpt-5.5',
        use_responses_lite: false,
        multi_agent_version: null,
        tool_mode: null,
      },
      {
        slug: 'gpt-5.6-sol',
        use_responses_lite: true,
        multi_agent_version: options.emptyNativeCapabilities
          ? ''
          : nativeCapabilities
            ? 'v2'
            : null,
        tool_mode: options.emptyNativeCapabilities
          ? ''
          : nativeCapabilities
            ? 'code_mode_only'
            : null,
      },
      {
        slug: 'gpt-5.6-terra',
        use_responses_lite: true,
        multi_agent_version: 'v2',
        tool_mode: 'code_mode_only',
      },
      ...(includeLuna
        ? [
            {
              slug: 'gpt-5.6-luna',
              use_responses_lite: true,
              multi_agent_version: 'v1',
              tool_mode: 'code_mode_only',
            },
          ]
        : []),
    ],
  }
}

function isolatedShellFixture(
  options: {
    includeLuna?: boolean
    nativeCapabilities?: boolean
    emptyNativeCapabilities?: boolean
  } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'anyrouters-codex-native-'))
  tempDirs.push(root)
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  mkdirSync(home)
  mkdirSync(bin)
  const fixturePath = join(root, 'catalog.json')
  const codexLog = join(root, 'codex.log')
  const installerLog = join(root, 'installer.log')
  const launchctlLog = join(root, 'launchctl.log')
  writeFileSync(fixturePath, JSON.stringify(fixture(options)))

  const codex = join(bin, 'codex')
  writeFileSync(
    codex,
    `#!/bin/sh
printf '%s|%s|%s %s|%s\n' "\${CODEX_HOME:-missing}" "\${CODEX_NON_INTERACTIVE:-missing}" "\${1:-}" "\${2:-}" "\${OPENAI_BASE_URL:-missing}" >> "$CODEX_LOG"
if [ "\${1:-}" = "--version" ]; then echo 'codex-cli test'; exit 0; fi
if [ "\${1:-}" = "debug" ] && [ "\${2:-}" = "models" ]; then
  if [ -f "\${CODEX_HOME:-}/config.toml" ] && grep -q 'BROKEN_CONFIG' "\${CODEX_HOME}/config.toml"; then exit 9; fi
  exec /bin/cat "$CATALOG_FIXTURE"
fi
exit 2
`
  )
  chmodSync(codex, 0o755)

  const curl = join(bin, 'curl')
  writeFileSync(
    curl,
    `#!/bin/sh
case "$*" in
  *api.anyrouters.com/v1/models*) printf '200'; exit 0 ;;
  *chatgpt.com/codex/install.sh*)
    printf 'official-installer-requested\n' >> "$INSTALLER_LOG"
    previous=''
    for argument in "$@"; do
      if [ "$previous" = '-o' ]; then printf '#!/bin/sh\nexit 0\n' > "$argument"; exit 0; fi
      previous="$argument"
    done
    ;;
esac
exit 3
`
  )
  chmodSync(curl, 0o755)

  const launchctl = join(bin, 'launchctl')
  writeFileSync(
    launchctl,
    `#!/bin/sh
printf '%s\n' "$*" >> "$LAUNCHCTL_LOG"
`
  )
  chmodSync(launchctl, 0o755)

  const env = {
    ...process.env,
    HOME: home,
    SHELL: '/bin/bash',
    PATH: `${bin}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    CODEX_HOME: join(root, 'external-codex-home-must-survive'),
    OPENAI_API_KEY: 'old-env-key',
    OPENAI_BASE_URL: 'https://old-relay.invalid/v1',
    CODEX_API_KEY: 'old-codex-key',
    ANYROUTERS_CODEX_BIN: codex,
    CATALOG_FIXTURE: fixturePath,
    CODEX_LOG: codexLog,
    INSTALLER_LOG: installerLog,
    LAUNCHCTL_LOG: launchctlLog,
  }

  return {
    root,
    home,
    codexLog,
    installerLog,
    launchctlLog,
    env,
    run(
      script: 'codex.sh' | 'codex-config.sh' | 'codex-official.sh',
      key = 'sk-test-native'
    ) {
      return spawnSync('bash', [join(scriptsDir, script), key], {
        env,
        encoding: 'utf8',
      })
    },
  }
}

function isolatedPowerShellFixture(
  options: {
    npmShimStderrWarning?: boolean
    homeName?: string
  } = {}
) {
  const root = mkdtempSync(join(tmpdir(), 'anyrouters-codex-native-pwsh-'))
  tempDirs.push(root)
  const home = join(root, options.homeName ?? 'home')
  const bin = join(root, 'bin')
  const codexDir = join(home, '.codex')
  const powerShellProfileDir = join(home, 'Documents', 'WindowsPowerShell')
  const powerShellProfile = join(
    powerShellProfileDir,
    'Microsoft.PowerShell_profile.ps1'
  )
  mkdirSync(home)
  mkdirSync(bin)
  mkdirSync(codexDir)
  mkdirSync(powerShellProfileDir, { recursive: true })
  const fixturePath = join(root, 'catalog.json')
  const codexLog = join(root, 'codex.log')
  const statePath = join(root, 'state.txt')
  const wrapperPath = join(root, 'wrapper.ps1')
  writeFileSync(fixturePath, JSON.stringify(fixture()))

  const codex = join(
    bin,
    process.platform === 'win32'
      ? options.npmShimStderrWarning
        ? 'codex.ps1'
        : 'codex.cmd'
      : 'codex'
  )
  if (process.platform === 'win32') {
    if (options.npmShimStderrWarning) {
      writeFileSync(
        codex,
        `param([string]$First, [string]$Second)
$baseUrlValue = $env:OPENAI_BASE_URL
if (-not $baseUrlValue) { $baseUrlValue = 'missing' }
Add-Content -Path $env:CODEX_LOG -Value "$($env:CODEX_HOME)|$($env:CODEX_NON_INTERACTIVE)|$First $Second|$baseUrlValue"
& $env:ComSpec /d /s /c 'echo WARNING: proceeding, even though we could not create PATH aliases 1>&2'
if ($First -eq '--version') {
  Write-Output 'codex-cli pwsh-test'
  exit 0
}
if ($First -eq 'debug' -and $Second -eq 'models') {
  Get-Content -Raw $env:CATALOG_FIXTURE
  exit 0
}
exit 2
`.replace(/\n/g, '\r\n')
      )
    } else {
      writeFileSync(
        codex,
        `@echo off
set "BASE_URL_VALUE=%OPENAI_BASE_URL%"
if not defined BASE_URL_VALUE set "BASE_URL_VALUE=missing"
>>"%CODEX_LOG%" echo %CODEX_HOME%^|%CODEX_NON_INTERACTIVE%^|%~1 %~2^|%BASE_URL_VALUE%
if "%~1"=="--version" (
  echo codex-cli pwsh-test
  exit /b 0
)
if "%~1"=="debug" if "%~2"=="models" (
  type "%CATALOG_FIXTURE%"
  exit /b 0
)
exit /b 2
`.replace(/\n/g, '\r\n')
      )
    }
  } else {
    writeFileSync(
      codex,
      `#!/bin/sh
printf '%s|%s|%s %s|%s\n' "\${CODEX_HOME:-missing}" "\${CODEX_NON_INTERACTIVE:-missing}" "\${1:-}" "\${2:-}" "\${OPENAI_BASE_URL:-missing}" >> "$CODEX_LOG"
if [ "\${1:-}" = "--version" ]; then echo 'codex-cli pwsh-test'; exit 0; fi
if [ "\${1:-}" = "debug" ] && [ "\${2:-}" = "models" ]; then exec /bin/cat "$CATALOG_FIXTURE"; fi
exit 2
`
    )
    chmodSync(codex, 0o755)
  }

  writeFileSync(
    wrapperPath,
    `param([string]$ScriptPath, [string]$StatePath)
function Invoke-RestMethod {
  param(
    [string]$Method,
    [string]$Uri,
    [hashtable]$Headers,
    [int]$TimeoutSec,
    [string]$ErrorAction
  )
  if ($Uri -like '*chatgpt.com/codex/install.ps1') {
    return '$global:AnyRoutersInstallerStubRan = $true'
  }
  return [pscustomobject]@{}
}
. $ScriptPath
$legacyBaseUrl = [Environment]::GetEnvironmentVariable('OPENAI_BASE_URL', 'Process')
if (-not $legacyBaseUrl) { $legacyBaseUrl = 'missing' }
$processApiKey = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY', 'Process')
$userApiKey = 'not-windows'
if ($env:OS -eq 'Windows_NT') {
  $userApiKey = [Environment]::GetEnvironmentVariable('OPENAI_API_KEY', 'User')
}
[System.IO.File]::WriteAllText(
  $StatePath,
  "$($env:CODEX_HOME)|$($env:CODEX_NON_INTERACTIVE)|$legacyBaseUrl|$processApiKey|$userApiKey",
  [System.Text.UTF8Encoding]::new($false)
)
`
  )

  const oldConfig = `model = "old-model"
model_provider = "old-provider"
model_reasoning_effort = "xhigh"
model_catalog_json = "old-catalog.json"

[mcp_servers.notion]
url = "https://mcp.notion.com/mcp"

[model_providers.anyrouters]
name = "Replace Me"
`
  writeFileSync(join(codexDir, 'config.toml'), oldConfig)
  writeFileSync(join(codexDir, 'auth.json'), 'desktop-login')
  writeFileSync(join(codexDir, 'anyrouters-api-key'), 'old-key\n')
  writeFileSync(join(codexDir, 'model-catalog-anyrouters-gpt56.json'), 'old-catalog')
  writeFileSync(
    powerShellProfile,
    '$env:OPENAI_BASE_URL = "https://other-relay.invalid/v1"\n$env:AWS_REGION = "us-east-1"\n'
  )

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ANYROUTERS_KEY: 'sk-pwsh-native',
    ANYROUTERS_CODEX_BIN: codex,
    CATALOG_FIXTURE: fixturePath,
    CODEX_LOG: codexLog,
    CODEX_HOME: join(root, 'external-codex-home-must-survive'),
    CODEX_NON_INTERACTIVE: 'keep-existing-value',
    OPENAI_API_KEY: 'old-env-key',
    OPENAI_BASE_URL: 'https://old-relay.invalid/v1',
    CODEX_API_KEY: 'old-codex-key',
  }

  return {
    home,
    codexDir,
    codexLog,
    powerShellProfile,
    statePath,
    env,
    run(script: 'codex.ps1' | 'codex-config.ps1' | 'codex-official.ps1') {
      return spawnSync(
        pwshBin,
        ['-NoLogo', '-NoProfile', '-File', wrapperPath, join(scriptsDir, script), statePath],
        { env, encoding: 'utf8' }
      )
    },
  }
}

function assertNativeConfig(home: string) {
  const codexDir = join(home, '.codex')
  const config = readFileSync(join(codexDir, 'config.toml'), 'utf8')
  expect(config).toContain('model = "gpt-5.6-sol"')
  expect(config).toContain('model_provider = "anyrouters"')
  expect(config).toContain('env_key = "OPENAI_API_KEY"')
  expect(config).not.toContain('[model_providers.anyrouters.auth]')
  expect(config).not.toContain('model_catalog_json')
  expect(config).not.toContain('model_reasoning_effort = "medium"')
  expect(existsSync(join(codexDir, 'anyrouters-api-key'))).toBe(false)
  expect(existsSync(join(codexDir, 'model-catalog-anyrouters-gpt56.json'))).toBe(false)
  expect(readdirSync(codexDir).some((name) => name.startsWith('.anyrouters-native.'))).toBe(
    false
  )
  expect(existsSync(join(codexDir, '.anyrouters-native.lock'))).toBe(false)
}

test('codex.sh skips installation when the existing Codex has required native capabilities', () => {
  const run = isolatedShellFixture()
  const result = run.run('codex.sh')
  expect(result.status, result.stderr + result.stdout).toBe(0)
  expect(result.stdout).toContain(
    'Existing compatible Codex detected; skipping installation.'
  )
  expect(existsSync(run.installerLog)).toBe(false)
})

for (const script of ['codex.sh', 'codex-config.sh'] as const) {
  test(`${script} rejects GPT-6 when only GPT-5.6 native metadata is available`, () => {
    const run = isolatedShellFixture()
    Object.assign(run.env, { ANYROUTERS_MODEL: 'gpt-6-astra' })
    const result = run.run(script)
    expect(result.status, result.stdout + result.stderr).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('gpt-6-astra')
    expect(existsSync(join(run.home, '.codex/config.toml'))).toBe(false)
  })
  test(`${script} accepts native GPT-6 and keeps HTTPS Responses without a catalog override`, () => {
    const run = isolatedShellFixture()
    const catalog = fixture()
    catalog.models.push({ slug: 'gpt-6-astra', use_responses_lite: true, multi_agent_version: 'v2', tool_mode: 'code_mode_only' })
    writeFileSync(run.env.CATALOG_FIXTURE, JSON.stringify(catalog))
    Object.assign(run.env, { ANYROUTERS_MODEL: 'gpt-6-astra' })
    const result = run.run(script)
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const config = readFileSync(join(run.home, '.codex/config.toml'), 'utf8')
    expect(config).toContain('model = "gpt-6-astra"')
    expect(config).toContain('wire_api = "responses"')
    expect(config).toContain('supports_websockets = false')
    expect(config).not.toContain('model_catalog_json')
  })
  test(`${script} refuses an incompatible saved GPT-6 reasoning effort without overwriting it`, () => {
    const run = isolatedShellFixture()
    const catalog = fixture()
    catalog.models.push({ slug: 'gpt-6-astra', use_responses_lite: true, multi_agent_version: 'v2', tool_mode: 'code_mode_only' })
    writeFileSync(run.env.CATALOG_FIXTURE, JSON.stringify(catalog))
    Object.assign(run.env, { ANYROUTERS_MODEL: 'gpt-6-astra' })
    mkdirSync(join(run.home, '.codex'))
    const config = 'model = "gpt-5.5"\nmodel_reasoning_effort = "none"\n'
    writeFileSync(join(run.home, '.codex/config.toml'), config)
    const result = run.run(script)
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('model_reasoning_effort')
    expect(readFileSync(join(run.home, '.codex/config.toml'), 'utf8')).toBe(config)
  })
}

test('codex.sh requests an upgrade when required native capabilities are missing', () => {
  const run = isolatedShellFixture({ includeLuna: false })
  const result = run.run('codex.sh')
  expect(result.status).not.toBe(0)
  expect(result.stdout).toContain(
    'Existing Codex lacks the required native GPT-5.6 capabilities'
  )
  expect(readFileSync(run.installerLog, 'utf8')).toContain(
    'official-installer-requested'
  )
})

test('codex-official.sh restores the built-in provider and preserves unrelated state', () => {
  const run = isolatedShellFixture()
  const codexDir = join(run.home, '.codex')
  mkdirSync(codexDir)
  const originalConfig = `model = "third-party-model"
model_provider = "thirdparty"
model_catalog_json = "third-party-catalog.json"
profile = "legacy-relay"
openai_base_url = "https://other-relay.invalid/v1"
chatgpt_base_url = "https://other-chat.invalid"
model_reasoning_effort = "xhigh"

[mcp_servers.notion]
url = "https://mcp.notion.com/mcp"

[model_providers.anyrouters]
name = "AnyRouters"

[model_providers.allrouters]
name = "AllRouters"

[model_providers.thirdparty]
name = "Keep Dormant"
`
  const originalAuth = 'keep-chatgpt-login'
  const originalProfile = `keep-profile-line
export OPENAI_BASE_URL="https://other-relay.invalid/v1"
# anyrouters-codex-managed-begin
export OPENAI_API_KEY=sk-anyrouters
# anyrouters-codex-managed-end
# allrouters-codex-managed-begin
export OPENAI_API_KEY=sk-allrouters
# allrouters-codex-managed-end
export AWS_ACCESS_KEY_ID="keep-aws"
`
  writeFileSync(join(codexDir, 'config.toml'), originalConfig)
  writeFileSync(join(codexDir, 'auth.json'), originalAuth)
  writeFileSync(join(run.home, '.bashrc'), originalProfile)
  const fishDir = join(run.home, '.config', 'fish')
  mkdirSync(fishDir, { recursive: true })
  writeFileSync(
    join(fishDir, 'config.fish'),
    'set -gx OPENAI_BASE_URL https://other-relay.invalid/v1\nset -gx AWS_REGION us-east-1\n'
  )

  const result = run.run('codex-official.sh')
  expect(result.status, result.stderr + result.stdout).toBe(0)
  const config = readFileSync(join(codexDir, 'config.toml'), 'utf8')
  expect(config).not.toContain('model = ')
  expect(config).not.toContain('model_provider = ')
  expect(config).not.toContain('model_catalog_json')
  expect(config).not.toContain('profile = ')
  expect(config).not.toContain('openai_base_url')
  expect(config).not.toContain('chatgpt_base_url')
  expect(config).not.toContain('[model_providers.anyrouters]')
  expect(config).not.toContain('[model_providers.allrouters]')
  expect(config).toContain('[model_providers.thirdparty]')
  expect(config).toContain('model_reasoning_effort = "xhigh"')
  expect(config).toContain('[mcp_servers.notion]')
  expect(readFileSync(join(codexDir, 'auth.json'), 'utf8')).toBe(originalAuth)

  const profile = readFileSync(join(run.home, '.bashrc'), 'utf8')
  expect(profile).toContain('keep-profile-line')
  expect(profile).toContain('AWS_ACCESS_KEY_ID="keep-aws"')
  expect(profile).not.toContain('OPENAI_BASE_URL')
  expect(profile).not.toContain('OPENAI_API_KEY')
  expect(profile).not.toContain('anyrouters-codex-managed')
  expect(profile).not.toContain('allrouters-codex-managed')
  expect(readFileSync(join(run.home, '.bashrc.router-official.bak'), 'utf8')).toBe(
    originalProfile
  )
  const fishProfile = readFileSync(join(fishDir, 'config.fish'), 'utf8')
  expect(fishProfile).not.toContain('OPENAI_BASE_URL')
  expect(fishProfile).toContain('AWS_REGION')
  expect(
    readdirSync(codexDir).filter((name) =>
      name.startsWith('codex-official-backup-')
    )
  ).toHaveLength(1)
  const calls = readFileSync(run.codexLog, 'utf8')
    .split('\n')
    .filter(Boolean)
  expect(calls.some((line) => line.includes('logout'))).toBe(false)
})

test('codex-official.sh fails closed before changing config or profiles', () => {
  const run = isolatedShellFixture()
  const codexDir = join(run.home, '.codex')
  mkdirSync(codexDir)
  const originalConfig = `model = "custom"
model_provider = "anyrouters"
BROKEN_CONFIG

[model_providers.anyrouters]
name = "AnyRouters"
`
  const originalProfile = `# anyrouters-codex-managed-begin
export OPENAI_API_KEY=sk-old
# anyrouters-codex-managed-end
`
  writeFileSync(join(codexDir, 'config.toml'), originalConfig)
  writeFileSync(join(run.home, '.bashrc'), originalProfile)

  const result = run.run('codex-official.sh')
  expect(result.status).not.toBe(0)
  expect(result.stderr + result.stdout).toContain(
    'restored official config did not validate'
  )
  expect(readFileSync(join(codexDir, 'config.toml'), 'utf8')).toBe(originalConfig)
  expect(readFileSync(join(run.home, '.bashrc'), 'utf8')).toBe(originalProfile)
  expect(
    readdirSync(codexDir).filter((name) =>
      name.startsWith('codex-official-backup-')
    )
  ).toHaveLength(0)
})

for (const script of ['codex.sh', 'codex-config.sh'] as const) {
  test(`${script} uses the native catalog without forcing reasoning or patching metadata`, () => {
    const run = isolatedShellFixture()
    const result = run.run(script)
    expect(result.status, result.stderr + result.stdout).toBe(0)
    assertNativeConfig(run.home)
    const calls = readFileSync(run.codexLog, 'utf8').trim().split('\n')
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls.every((line) => !line.startsWith(run.env.CODEX_HOME))).toBe(true)
    expect(calls.every((line) => line.includes('|1|debug models'))).toBe(true)
    expect(calls.every((line) => line.endsWith('|missing'))).toBe(true)
  })

  test(`${script} migrates the legacy override while preserving user configuration`, () => {
    const run = isolatedShellFixture()
    const codexDir = join(run.home, '.codex')
    mkdirSync(codexDir)
    const oldCatalogPath = join(codexDir, 'model-catalog-anyrouters-gpt56.json')
    const oldConfig = `model = "old-model"
model_provider = "old-provider"
model_reasoning_effort = "xhigh"
disable_response_storage = true
model_catalog_json = ${JSON.stringify(oldCatalogPath)}
approval_policy = "on-request"

[mcp_servers.notion]
url = "https://mcp.notion.com/mcp"

[features]
apps = true

[model_providers.anyrouters]
name = "Replace Me"
base_url = "https://old.invalid/v1"

[model_providers.anyrouters.auth]
command = "old-helper"

[model_providers.old-provider]
name = "Keep Me"
`
    const oldAuth = '{"auth_mode":"chatgpt","tokens":{"access_token":"keep"}}'
    writeFileSync(join(codexDir, 'config.toml'), oldConfig)
    writeFileSync(join(codexDir, 'auth.json'), oldAuth)
    writeFileSync(join(codexDir, 'anyrouters-api-key'), 'old-key\n')
    writeFileSync(oldCatalogPath, 'old-catalog')
    const oldProfile = `keep-profile-line
export OPENAI_BASE_URL="https://old-relay.invalid/v1"
OPENAI_API_KEY="old-key"
export AWS_ACCESS_KEY_ID="keep-aws"
export HTTPS_PROXY="http://keep-proxy.invalid"
`
    writeFileSync(join(run.home, '.bashrc'), oldProfile)

    const result = run.run(script, 'sk-new-native')
    expect(result.status, result.stderr + result.stdout).toBe(0)
    const config = readFileSync(join(codexDir, 'config.toml'), 'utf8')
    expect(config).toContain('model_reasoning_effort = "xhigh"')
    expect(config).toContain('disable_response_storage = true')
    expect(config).toContain('approval_policy = "on-request"')
    expect(config).toContain('[mcp_servers.notion]')
    expect(config).toContain('[features]')
    expect(config).toContain('[model_providers.old-provider]')
    expect(config).not.toContain('model_catalog_json')
    expect(config).not.toContain('https://old.invalid/v1')
    expect(readFileSync(join(codexDir, 'auth.json'), 'utf8')).toBe(oldAuth)
    expect(readFileSync(oldCatalogPath, 'utf8')).toBe('old-catalog')
    const updatedProfile = readFileSync(join(run.home, '.bashrc'), 'utf8')
    expect(updatedProfile).toContain('keep-profile-line')
    expect(updatedProfile).toContain('AWS_ACCESS_KEY_ID="keep-aws"')
    expect(updatedProfile).toContain('HTTPS_PROXY="http://keep-proxy.invalid"')
    expect(updatedProfile).not.toContain('https://old-relay.invalid/v1')
    expect(updatedProfile).not.toContain('OPENAI_API_KEY="old-key"')
    expect(updatedProfile).toContain('# anyrouters-codex-managed-begin')
    expect(updatedProfile).toContain('unset OPENAI_BASE_URL')
    expect(updatedProfile).toContain('export OPENAI_API_KEY=sk-new-native')
    expect(updatedProfile).not.toContain('unset OPENAI_API_KEY')
    expect(readFileSync(join(run.home, '.bashrc.anyrouters.bak'), 'utf8')).toBe(oldProfile)
    expect(existsSync(join(run.home, '.bash_profile'))).toBe(false)
    expect(readFileSync(join(run.home, '.profile'), 'utf8')).toContain(
      'unset OPENAI_BASE_URL'
    )
    expect(readFileSync(join(codexDir, 'anyrouters-api-key'), 'utf8')).toBe('old-key\n')
    const launchctlCalls = readFileSync(run.launchctlLog, 'utf8').trim().split('\n')
    expect(launchctlCalls).toContain('setenv OPENAI_API_KEY sk-new-native')
    expect(launchctlCalls).toContain('unsetenv OPENAI_BASE_URL')
    expect(launchctlCalls).not.toContain('unsetenv OPENAI_API_KEY')

    const backups = readdirSync(codexDir).filter((name) =>
      name.startsWith('anyrouters-native-backup-')
    )
    expect(backups).toHaveLength(1)
    const backup = join(codexDir, backups[0])
    expect(readFileSync(join(backup, 'config.toml'), 'utf8')).toBe(oldConfig)
    expect(readFileSync(join(backup, 'auth.json'), 'utf8')).toBe(oldAuth)
    expect(readFileSync(join(backup, 'anyrouters-api-key'), 'utf8')).toBe('old-key\n')
    expect(readFileSync(join(backup, 'model-catalog-anyrouters-gpt56.json'), 'utf8')).toBe(
      'old-catalog'
    )
  })

  test(`${script} fails closed when a required native model is missing`, () => {
    const run = isolatedShellFixture({ includeLuna: false })
    const result = run.run(script)
    const codexDir = join(run.home, '.codex')
    expect(result.status).not.toBe(0)
    expect(result.stderr + result.stdout).toContain('gpt-5.6-luna')
    expect(existsSync(join(codexDir, 'config.toml'))).toBe(false)
    expect(existsSync(join(codexDir, 'anyrouters-api-key'))).toBe(false)
    expect(readdirSync(codexDir).some((name) => name.startsWith('anyrouters-native-backup-'))).toBe(
      false
    )
  })

  test(`${script} fails closed when native collaboration or tools are unavailable`, () => {
    const run = isolatedShellFixture({ nativeCapabilities: false })
    const result = run.run(script)
    expect(result.status).not.toBe(0)
    expect(result.stderr + result.stdout).toContain('native collaboration/tool metadata')
    expect(existsSync(join(run.home, '.codex', 'config.toml'))).toBe(false)
  })

  test(`${script} rejects empty native collaboration or tool metadata`, () => {
    const run = isolatedShellFixture({ emptyNativeCapabilities: true })
    const result = run.run(script)
    expect(result.status).not.toBe(0)
    expect(result.stderr + result.stdout).toContain('native collaboration/tool metadata')
    expect(existsSync(join(run.home, '.codex', 'config.toml'))).toBe(false)
  })

  test(`${script} is idempotent when configuration and key are unchanged`, () => {
    const run = isolatedShellFixture()
    const first = run.run(script)
    expect(first.status, first.stderr + first.stdout).toBe(0)
    const second = run.run(script)
    expect(second.status, second.stderr + second.stdout).toBe(0)
    expect(second.stdout).toContain('already up to date')
    const profile = readFileSync(join(run.home, '.bashrc'), 'utf8')
    expect(profile).toContain('export OPENAI_API_KEY=sk-test-native')
    expect(profile).not.toContain('unset OPENAI_API_KEY')
    const launchctlCalls = readFileSync(run.launchctlLog, 'utf8')
      .trim()
      .split('\n')
    expect(
      launchctlCalls.filter((line) => line === 'setenv OPENAI_API_KEY sk-test-native')
    ).toHaveLength(2)
    expect(launchctlCalls).not.toContain('unsetenv OPENAI_API_KEY')
    const backups = readdirSync(join(run.home, '.codex')).filter((name) =>
      name.startsWith('anyrouters-native-backup-')
    )
    expect(backups).toHaveLength(1)
  })

  test(`${script} leaves an invalid existing configuration byte-for-byte unchanged`, () => {
    const run = isolatedShellFixture()
    const codexDir = join(run.home, '.codex')
    mkdirSync(codexDir)
    writeFileSync(join(codexDir, 'config.toml'), 'BROKEN_CONFIG')
    writeFileSync(join(codexDir, 'auth.json'), 'desktop-login')
    writeFileSync(join(codexDir, 'anyrouters-api-key'), 'old-key\n')
    const result = run.run(script)
    expect(result.status).not.toBe(0)
    expect(result.stderr + result.stdout).toContain('config.toml is invalid')
    expect(readFileSync(join(codexDir, 'config.toml'), 'utf8')).toBe('BROKEN_CONFIG')
    expect(readFileSync(join(codexDir, 'auth.json'), 'utf8')).toBe('desktop-login')
    expect(readFileSync(join(codexDir, 'anyrouters-api-key'), 'utf8')).toBe('old-key\n')
    expect(readdirSync(codexDir).some((name) => name.startsWith('anyrouters-native-backup-'))).toBe(
      false
    )
  })
}

const powerShellTest = pwshBin ? test : test.skip
for (const script of ['codex.ps1', 'codex-config.ps1'] as const) {
  powerShellTest(`PowerShell ${script} checks GPT-6 metadata and preserves incompatible settings`, () => {
    const run = isolatedPowerShellFixture()
    Object.assign(run.env, { ANYROUTERS_MODEL: 'gpt-6-astra' })
    const configPath = join(run.codexDir, 'config.toml')
    const original = readFileSync(configPath, 'utf8')
    const missing = run.run(script)
    expect(missing.status).not.toBe(0)
    expect(readFileSync(configPath, 'utf8')).toBe(original)

    const catalog = fixture()
    catalog.models.push({ slug: 'gpt-6-astra', use_responses_lite: true, multi_agent_version: 'v2', tool_mode: 'code_mode_only' })
    writeFileSync(run.env.CATALOG_FIXTURE, JSON.stringify(catalog))
    for (const effort of ['none', 'minimal']) {
      const incompatible = original.replace('"xhigh"', `"${effort}"`)
      writeFileSync(configPath, incompatible)
      const invalid = run.run(script)
      expect(invalid.status).not.toBe(0)
      expect(invalid.stdout + invalid.stderr).toContain('model_reasoning_effort')
      expect(readFileSync(configPath, 'utf8')).toBe(incompatible)
    }

    writeFileSync(configPath, original)
    const valid = run.run(script)
    expect(valid.status, valid.stdout + valid.stderr).toBe(0)
    const configured = readFileSync(configPath, 'utf8')
    expect(configured).toContain('model = "gpt-6-astra"')
    expect(configured).toContain('supports_websockets = false')
    expect(configured).toContain('model_reasoning_effort = "xhigh"')
    expect(configured).not.toContain('model_catalog_json')
  }, 30_000)

  powerShellTest(`PowerShell ${script} keeps a spaced home and switches GPT-6 back to GPT-5.6`, () => {
    const run = isolatedPowerShellFixture({ homeName: 'Test User' })
    const catalog = fixture()
    catalog.models.push({ slug: 'gpt-6-astra', use_responses_lite: true, multi_agent_version: 'v2', tool_mode: 'code_mode_only' })
    writeFileSync(run.env.CATALOG_FIXTURE, JSON.stringify(catalog))
    Object.assign(run.env, { ANYROUTERS_MODEL: 'gpt-6-astra' })
    const first = run.run(script)
    expect(first.status, first.stdout + first.stderr).toBe(0)
    const configPath = join(run.codexDir, 'config.toml')
    expect(readFileSync(configPath, 'utf8')).toContain('model = "gpt-6-astra"')

    Object.assign(run.env, { ANYROUTERS_MODEL: 'gpt-5.6-sol' })
    const switched = run.run(script)
    expect(switched.status, switched.stdout + switched.stderr).toBe(0)
    const config = readFileSync(configPath, 'utf8')
    expect(config).toContain('model = "gpt-5.6-sol"')
    expect(config).toContain('model_reasoning_effort = "xhigh"')
    expect(config).toContain('[mcp_servers.notion]')
    expect(config.charCodeAt(0)).not.toBe(0xfeff)
    expect(readFileSync(join(run.codexDir, 'auth.json'), 'utf8')).toBe('desktop-login')
  }, 30_000)
}

powerShellTest(
  'PowerShell installers execute safely in an isolated Codex home',
  () => {
    for (const script of ['codex.ps1', 'codex-config.ps1'] as const) {
      const run = isolatedPowerShellFixture()
      const first = run.run(script)
      expect(first.status, first.stderr + first.stdout).toBe(0)
      const config = readFileSync(join(run.codexDir, 'config.toml'), 'utf8')
      expect(config).toContain('model = "gpt-5.6-sol"')
      expect(config).toContain('model_provider = "anyrouters"')
      expect(config).toContain('model_reasoning_effort = "xhigh"')
      expect(config).toContain('[mcp_servers.notion]')
      expect(config).toContain('env_key = "OPENAI_API_KEY"')
      expect(config).not.toContain('[model_providers.anyrouters.auth]')
      expect(config).not.toContain('model_catalog_json')
      expect(readFileSync(join(run.codexDir, 'auth.json'), 'utf8')).toBe(
        'desktop-login'
      )
      expect(readFileSync(join(run.codexDir, 'anyrouters-api-key'), 'utf8')).toBe(
        'old-key\n'
      )
      const state = readFileSync(run.statePath, 'utf8').split('|')
      expect(state[0]).toContain('external-codex-home-must-survive')
      expect(state[1]).toBe('keep-existing-value')
      expect(state[2]).toBe('missing')
      expect(state[3]).toBe('sk-pwsh-native')
      expect(state[4]).toBe(
        process.platform === 'win32' ? 'sk-pwsh-native' : 'not-windows'
      )
      const codexCalls = readFileSync(run.codexLog, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
      expect(codexCalls.every((line) => line.includes('|1|'))).toBe(true)
      expect(codexCalls.every((line) => line.endsWith('|missing'))).toBe(true)

      const second = run.run(script)
      expect(second.status, second.stderr + second.stdout).toBe(0)
      expect(second.stdout).toContain('already up to date')
      expect(
        readdirSync(run.codexDir).filter((name) =>
          name.startsWith('anyrouters-native-backup-')
        )
      ).toHaveLength(1)
      expect(existsSync(join(run.codexDir, '.anyrouters-native.lock'))).toBe(false)
    }
  },
  30_000
)

powerShellTest(
  'PowerShell official restore keeps login and unrelated configuration',
  () => {
    const run = isolatedPowerShellFixture()
    const configured = run.run('codex.ps1')
    expect(configured.status, configured.stderr + configured.stdout).toBe(0)

    const restored = run.run('codex-official.ps1')
    expect(restored.status, restored.stderr + restored.stdout).toBe(0)
    const config = readFileSync(join(run.codexDir, 'config.toml'), 'utf8')
    expect(config).not.toContain('model_provider = "anyrouters"')
    expect(config).not.toContain('[model_providers.anyrouters]')
    expect(config).not.toContain('model = "gpt-5.6-sol"')
    expect(config).toContain('model_reasoning_effort = "xhigh"')
    expect(config).toContain('[mcp_servers.notion]')
    expect(readFileSync(join(run.codexDir, 'auth.json'), 'utf8')).toBe(
      'desktop-login'
    )
    const profile = readFileSync(run.powerShellProfile, 'utf8')
    expect(profile).not.toContain('OPENAI_BASE_URL')
    expect(profile).toContain('AWS_REGION')
    expect(existsSync(`${run.powerShellProfile}.router-official.bak`)).toBe(true)
    const codexCalls = readFileSync(run.codexLog, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
    expect(codexCalls.some((line) => line.includes('logout'))).toBe(false)
    expect(
      readdirSync(run.codexDir).filter((name) =>
        name.startsWith('codex-official-backup-')
      )
    ).toHaveLength(1)
  },
  30_000
)

powerShellTest(
  'PowerShell official restore accepts a successful npm shim warning on stderr',
  () => {
    const run = isolatedPowerShellFixture({ npmShimStderrWarning: true })
    const restored = run.run('codex-official.ps1')
    expect(restored.status, restored.stderr + restored.stdout).toBe(0)
    const config = readFileSync(join(run.codexDir, 'config.toml'), 'utf8')
    expect(config).not.toContain('model_provider = "old-provider"')
    expect(config).not.toContain('[model_providers.anyrouters]')
    expect(config).toContain('model_reasoning_effort = "xhigh"')
    expect(config).toContain('[mcp_servers.notion]')
    const codexCalls = readFileSync(run.codexLog, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
    expect(codexCalls.every((line) => line.startsWith(run.codexDir))).toBe(true)
  },
  30_000
)

test('PowerShell installers validate native capabilities and preserve unrelated settings', () => {
  for (const name of ['codex.ps1', 'codex-config.ps1']) {
    const script = source(name)
    expect(script).toContain('debug models')
    expect(script).toContain('System.Diagnostics.ProcessStartInfo')
    expect(script).toContain('ReadToEndAsync')
    expect(script).toContain('Convert-CodexCatalogJson')
    expect(script).toContain('gpt-5.6-sol')
    expect(script).toContain('gpt-5.6-terra')
    expect(script).toContain('gpt-5.6-luna')
    expect(script).toContain('multi_agent_version')
    expect(script).toContain('tool_mode')
    expect(script).toContain('env_key = "OPENAI_API_KEY"')
    expect(script).not.toContain('[model_providers.anyrouters.auth]')
    expect(script).toContain('anyrouters-native-backup-')
    expect(script).toContain('[System.IO.File]::Replace')
    expect(script).toContain('CODEX_NON_INTERACTIVE')
    expect(script).toContain('Protect-PrivatePath')
    expect(script).toContain('Test-FileContentEqual')
    expect(script).toContain('Preserve-McpAndUnrelatedCodexConfig')
    expect(script).not.toContain('Set-JsonField $entry "multi_agent_version" $null')
    expect(script).not.toContain('Set-JsonField $entry "tool_mode" $null')
    expect(script).not.toContain('model_reasoning_effort = "medium"')
    expect(script).not.toContain('model_catalog_json = $catalogLiteral')
    expect(script).not.toContain('setx OPENAI_API_KEY')
    expect(script).toContain(
      '[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $ApiKey, "User")'
    )
  }
})

test('official restore scripts reset generic routing without logging the user out', () => {
  for (const name of ['codex-official.sh', 'codex-official.ps1']) {
    const script = source(name)
    expect(script).toContain('model_provider')
    expect(script).toContain('model_catalog_json')
    expect(script).toContain('profile')
    expect(script).toContain('openai_base_url')
    expect(script).toContain('chatgpt_base_url')
    expect(script).toContain('model_providers.anyrouters')
    expect(script).toContain('model_providers.allrouters')
    expect(script).toContain('OPENAI_API_KEY')
    expect(script).toContain('OPENAI_BASE_URL')
    if (name.endsWith('.ps1')) {
      expect(script).toContain('Remove-RouterProfileOverrides')
      expect(script).toContain('CurrentUserCurrentHost')
      expect(script).toContain('System.Diagnostics.ProcessStartInfo')
      expect(script).toContain('ReadToEndAsync')
      expect(script).not.toContain('[System.IO.Path]::GetTempPath()')
    } else {
      expect(script).toContain('remove_managed_profile_block')
    }
    expect(script).toContain('auth.json')
    expect(script).toContain('codex login status')
    expect(script).not.toMatch(/^\s*codex logout/m)
  }
})
