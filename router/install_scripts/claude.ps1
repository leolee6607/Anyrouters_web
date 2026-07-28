# AnyRouters one-line installer - Claude Code. Safe to run more than once.
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$Key = $env:ANYROUTERS_KEY
if (-not $Key) {
  Write-Host "X No API key. Run:  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; `$env:ANYROUTERS_KEY='YOUR_KEY'; irm https://anyrouters.com/install/claude.ps1 | iex"
  return
}
$Model = $env:ANYROUTERS_MODEL
if (-not $Model) {
  $Model = "claude-sonnet-4-6"
}

function Normalize-AnyRoutersKey([string]$Value) {
  $k = $Value.Trim().Trim('"').Trim("'")
  if ($k.StartsWith("Bearer ", [System.StringComparison]::OrdinalIgnoreCase)) {
    $k = $k.Substring(7).Trim()
  }
  if ($k.StartsWith("sk-anyrouters-sk-", [System.StringComparison]::OrdinalIgnoreCase)) {
    $k = "sk-" + $k.Substring(17)
  } elseif ($k.StartsWith("sk-anyrouters-", [System.StringComparison]::OrdinalIgnoreCase)) {
    $k = "sk-" + $k.Substring(14)
  } elseif ($k.StartsWith("anyrouters-sk-", [System.StringComparison]::OrdinalIgnoreCase)) {
    $k = "sk-" + $k.Substring(14)
  }
  return $k
}

function Normalize-HttpProxy([string]$Value) {
  if (-not $Value) {
    return $null
  }
  $proxy = $Value.Trim().Trim('"').Trim("'")
  if (-not $proxy -or $proxy -match "(?i)^socks") {
    return $null
  }
  if ($proxy -notmatch "^[a-zA-Z][a-zA-Z0-9+.-]*://") {
    $proxy = "http://$proxy"
  }
  try {
    $uri = [Uri]$proxy
    if ($uri.Scheme -notin @("http", "https") -or -not $uri.Host -or $uri.Port -le 0) {
      return $null
    }
    return $uri.AbsoluteUri.TrimEnd("/")
  } catch {
    return $null
  }
}

function Get-ClaudeSettingsProxyCandidates {
  if (-not $env:USERPROFILE) {
    return @()
  }
  $settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
  if (-not (Test-Path $settingsPath)) {
    return @()
  }
  try {
    $settings = Get-Content -Raw -Path $settingsPath | ConvertFrom-Json
    if (-not $settings.env) {
      return @()
    }
    return @($settings.env.HTTPS_PROXY, $settings.env.HTTP_PROXY)
  } catch {
    return @()
  }
}

function Get-WindowsProxyCandidates {
  $values = @()
  try {
    $internetSettings = Get-ItemProperty `
      -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" `
      -ErrorAction Stop
    if ([int]$internetSettings.ProxyEnable -eq 1 -and $internetSettings.ProxyServer) {
      $proxyServer = [string]$internetSettings.ProxyServer
      if ($proxyServer -match ";|=") {
        foreach ($part in ($proxyServer -split ";")) {
          if ($part -match "^\s*(?:https?|proxy)\s*=\s*(.+?)\s*$") {
            $values += $Matches[1]
          }
        }
      } else {
        $values += $proxyServer
      }
    }
  } catch {}
  return $values
}

function Get-ProxyCandidates {
  $values = @(
    $env:ANYROUTERS_PROXY,
    $env:HTTPS_PROXY,
    $env:HTTP_PROXY,
    [Environment]::GetEnvironmentVariable("HTTPS_PROXY", "User"),
    [Environment]::GetEnvironmentVariable("HTTP_PROXY", "User")
  )
  $values += @(Get-ClaudeSettingsProxyCandidates)
  $values += @(Get-WindowsProxyCandidates)

  $normalized = @()
  foreach ($value in $values) {
    $proxy = Normalize-HttpProxy ([string]$value)
    if ($proxy -and $normalized -notcontains $proxy) {
      $normalized += $proxy
    }
  }
  return $normalized
}

function Test-AnyRoutersApiRoute([string]$Proxy, [bool]$Direct = $false) {
  $result = [ordered]@{
    Supported = $false
    Available = $false
    IsApiJson = $false
    StatusCode = ""
    ContentType = ""
    IsHtml = $false
  }
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) {
    return [pscustomobject]$result
  }
  $result.Supported = $true

  $bodyPath = [IO.Path]::GetTempFileName()
  try {
    $arguments = @(
      "-sS",
      "--max-time", "15",
      "-o", $bodyPath,
      "-w", "%{http_code}|%{content_type}"
    )
    if ($Direct) {
      $arguments += @("--noproxy", "*")
    } elseif ($Proxy) {
      $arguments += @("--proxy", $Proxy)
    }
    $arguments += "https://api.anyrouters.com/v1/models"

    $meta = (@(& $curl.Source @arguments 2>$null) -join "").Trim()
    $exitCode = $LASTEXITCODE
    $body = if (Test-Path $bodyPath) {
      [string](Get-Content -Raw -Path $bodyPath -ErrorAction SilentlyContinue)
    } else {
      ""
    }
    if ($meta -match "^(\d{3})\|(.*)$") {
      $result.StatusCode = $Matches[1]
      $result.ContentType = $Matches[2]
    }
    $trimmedBody = $body.TrimStart()
    $result.Available = $exitCode -eq 0
    $result.IsHtml = $trimmedBody -match "(?is)^(?:<!doctype html|<html|<meta)"
    $result.IsApiJson =
      $result.Available -and
      $result.StatusCode -in @("200", "401") -and
      (
        $result.ContentType -match "(?i)application/json" -or
        $trimmedBody.StartsWith("{") -or
        $trimmedBody.StartsWith("[")
      )
  } catch {
    $result.Available = $false
  } finally {
    Remove-Item $bodyPath -Force -ErrorAction SilentlyContinue
  }
  return [pscustomobject]$result
}

$OriginalKey = $Key
$Key = Normalize-AnyRoutersKey $Key
if ($OriginalKey -ne $Key) {
  Write-Host "Fixed API key prefix: removed accidental sk-anyrouters-."
}
if (-not $Key -or $Key -match "YOUR_KEY|YOUR_ANYROUTERS_API_KEY|本页顶部|API 密钥") {
  Write-Host "X Replace the placeholder with your real AnyRouters API key."
  return
}

$ClaudeProxy = $null
$directProbe = Test-AnyRoutersApiRoute $null $true
if (-not $directProbe.IsApiJson) {
  foreach ($candidate in @(Get-ProxyCandidates)) {
    $proxyProbe = Test-AnyRoutersApiRoute $candidate $false
    if ($proxyProbe.IsApiJson) {
      $ClaudeProxy = $candidate
      break
    }
  }
}

if ($directProbe.Supported -and -not $directProbe.IsApiJson -and -not $ClaudeProxy) {
  Write-Host "X AnyRouters API is not reachable through the current Windows terminal route."
  if ($directProbe.StatusCode -eq "403" -or $directProbe.IsHtml) {
    Write-Host "  Direct access returned an HTML 403 page. This is a proxy-routing issue, not an API login error."
  }
  Write-Host "  Keep your proxy app connected, enable an HTTP or Mixed proxy, then re-run this command."
  Write-Host "  Rule mode is supported, but api.anyrouters.com must go through the proxy."
  Write-Host "  SOCKS-only and PAC-only settings cannot be written directly to Claude Code."
  Write-Host "  If automatic detection is unavailable, set ANYROUTERS_PROXY first, for example:"
  Write-Host '  $env:ANYROUTERS_PROXY="http://127.0.0.1:YOUR_HTTP_PORT"'
  return
}

if ($ClaudeProxy) {
  Write-Host "Detected a working HTTP proxy for Claude Code: $ClaudeProxy"
  Write-Host "The proxy will be saved only in Claude settings; Windows global proxy settings will not be changed."
  $env:HTTP_PROXY = $ClaudeProxy
  $env:HTTPS_PROXY = $ClaudeProxy
}

try {
  $validationArguments = @{
    Method = "Get"
    Uri = "https://api.anyrouters.com/v1/models"
    Headers = @{ Authorization = "Bearer $Key" }
    TimeoutSec = 20
  }
  if ($ClaudeProxy) {
    $validationArguments["Proxy"] = $ClaudeProxy
  }
  Invoke-RestMethod @validationArguments | Out-Null
} catch {
  $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "network error" }
  Write-Host "X API key validation failed ($status)."
  Write-Host "  Copy the complete key from AnyRouters API Keys. Do not add sk-anyrouters- before it."
  return
}

$Reset = $true
if ($Reset) {
  Write-Host "Resetting AnyRouters Claude Code environment ..."
}

$NpmPrefix = if ($env:ANYROUTERS_NPM_PREFIX) { $env:ANYROUTERS_NPM_PREFIX } else { Join-Path $env:LOCALAPPDATA "AnyRouters\npm" }
$ConflictingClaudeEnvNames = @(
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLOUD_ML_REGION",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_MANTLE",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "ANTHROPIC_AWS_WORKSPACE_ID"
)

function Test-InstallerHtml([string]$Content) {
  if (-not $Content) {
    return $true
  }
  return $Content.Substring(0, [Math]::Min(512, $Content.Length)) -match "(?is)<!doctype html|<html|</html"
}

function Clear-ClaudeConflictingEnv {
  foreach ($name in $ConflictingClaudeEnvNames) {
    [Environment]::SetEnvironmentVariable($name, $null, "User")
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
}

function ConvertTo-PlainObject($Value) {
  if ($null -eq $Value) {
    return $null
  }
  if ($Value -is [System.Collections.IDictionary]) {
    $result = [ordered]@{}
    foreach ($key in $Value.Keys) {
      $result[$key] = ConvertTo-PlainObject $Value[$key]
    }
    return $result
  }
  if ($Value -is [pscustomobject]) {
    $result = [ordered]@{}
    foreach ($property in $Value.PSObject.Properties) {
      $result[$property.Name] = ConvertTo-PlainObject $property.Value
    }
    return $result
  }
  if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
    $items = @()
    foreach ($item in $Value) {
      $items += ,(ConvertTo-PlainObject $item)
    }
    return $items
  }
  return $Value
}

function Update-ClaudeUserSettings {
  if (-not $env:USERPROFILE) {
    return
  }

  $settingsDir = Join-Path $env:USERPROFILE ".claude"
  $settingsPath = Join-Path $settingsDir "settings.json"
  New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null

  $settings = [ordered]@{}
  if (Test-Path $settingsPath) {
    $raw = Get-Content -Raw -Path $settingsPath -ErrorAction SilentlyContinue
    if ($raw -and $raw.Trim()) {
      try {
        $settings = ConvertTo-PlainObject ($raw | ConvertFrom-Json)
      } catch {
        $backupPath = "$settingsPath.anyrouters-invalid-$(Get-Date -Format yyyyMMddHHmmss).bak"
        Copy-Item $settingsPath $backupPath -Force
        Write-Host "Backed up unreadable Claude settings to: $backupPath"
        $settings = [ordered]@{}
      }
    }
  }
  if (-not ($settings -is [System.Collections.IDictionary])) {
    $settings = [ordered]@{}
  }
  if (-not $settings.Contains("env") -or -not ($settings["env"] -is [System.Collections.IDictionary])) {
    $settings["env"] = [ordered]@{}
  }

  $envBlock = $settings["env"]
  $changed = $false
  foreach ($name in ($ConflictingClaudeEnvNames + @("ANTHROPIC_AUTH_TOKEN"))) {
    if ($envBlock.Contains($name)) {
      $envBlock.Remove($name)
      $changed = $true
    }
  }
  if ($settings.Contains("apiKeyHelper")) {
    $settings.Remove("apiKeyHelper")
    $changed = $true
  }
  if (-not $envBlock.Contains("ANTHROPIC_BASE_URL") -or $envBlock["ANTHROPIC_BASE_URL"] -ne "https://api.anyrouters.com") {
    $envBlock["ANTHROPIC_BASE_URL"] = "https://api.anyrouters.com"
    $changed = $true
  }
  if (-not $envBlock.Contains("ANTHROPIC_MODEL") -or $envBlock["ANTHROPIC_MODEL"] -ne $Model) {
    $envBlock["ANTHROPIC_MODEL"] = $Model
    $changed = $true
  }
  if ($ClaudeProxy) {
    foreach ($proxyName in @("HTTP_PROXY", "HTTPS_PROXY")) {
      if (-not $envBlock.Contains($proxyName) -or $envBlock[$proxyName] -ne $ClaudeProxy) {
        $envBlock[$proxyName] = $ClaudeProxy
        $changed = $true
      }
    }
  }

  if ($changed) {
    if (Test-Path $settingsPath) {
      Copy-Item $settingsPath "$settingsPath.anyrouters.bak" -Force
    }
    $settings | ConvertTo-Json -Depth 32 | Set-Content -Path $settingsPath -Encoding UTF8
    Write-Host "Updated Claude Code settings: $settingsPath"
  }
}

function Add-UserPath([string]$PathToAdd, [bool]$Prefer = $false) {
  if (-not $PathToAdd) {
    return
  }
  if (-not (Test-Path $PathToAdd)) {
    return
  }

  $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $currentUserPath) {
    $currentUserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
  }

  $parts = @()
  if ($currentUserPath) {
    $parts = $currentUserPath -split ';' | Where-Object { $_ -and ($_ -ine $PathToAdd) }
  }
  if ($Prefer) {
    $parts = @($PathToAdd) + $parts
  } else {
    $parts = $parts + @($PathToAdd)
  }
  [Environment]::SetEnvironmentVariable("Path", ($parts -join ';'), "User")

  $envParts = @()
  if ($env:PATH) {
    $envParts = $env:PATH -split ';' | Where-Object { $_ -and ($_ -ine $PathToAdd) }
  }
  $envParts = @($PathToAdd) + $envParts
  $env:PATH = $envParts -join ';'
}

function Test-ClaudeCommandWorks([string]$CommandPath) {
  if (-not $CommandPath -or -not (Test-Path $CommandPath)) {
    return $false
  }
  try {
    & $CommandPath --version *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Get-AnyRoutersClaudeDirs([string]$NpmPrefix) {
  $dirs = @()
  if ($NpmPrefix) {
    $dirs += $NpmPrefix
    $dirs += (Join-Path $NpmPrefix "bin")
    $dirs += (Join-Path $NpmPrefix "node_modules\.bin")
  }
  return $dirs | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
}

function Add-AnyRoutersClaudePaths([string]$NpmPrefix) {
  $dirs = @(Get-AnyRoutersClaudeDirs $NpmPrefix)
  [Array]::Reverse($dirs)
  foreach ($dir in $dirs) {
    Add-UserPath $dir $true
  }
}

function Get-LegacyClaudeLaunchers {
  $launchers = @()
  if ($env:USERPROFILE) {
    $launchers += (Join-Path $env:USERPROFILE ".local\cmd-shims\claude.cmd")
    $launchers += (Join-Path $env:USERPROFILE ".local\bin\claude.cmd")
    $launchers += (Join-Path $env:USERPROFILE ".local\bin\claude.exe")
  }
  if ($env:APPDATA) {
    $launchers += (Join-Path $env:APPDATA "npm\claude.cmd")
    $launchers += (Join-Path $env:APPDATA "npm\claude.ps1")
    $launchers += (Join-Path $env:APPDATA "npm\claude")
  }
  return $launchers | Where-Object { $_ } | Select-Object -Unique
}

function Remove-LegacyClaudeLaunchers {
  foreach ($launcher in (Get-LegacyClaudeLaunchers)) {
    if (Test-Path $launcher) {
      Remove-Item -Path $launcher -Force -ErrorAction SilentlyContinue
      if (-not (Test-Path $launcher)) {
        Write-Host "Removed old Claude launcher: $launcher"
      }
    }
  }
}

function Test-IsUserPath([string]$PathValue) {
  if (-not $PathValue) {
    return $false
  }
  $roots = @($env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA) | Where-Object { $_ }
  foreach ($root in $roots) {
    if ($PathValue.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }
  return $false
}

function Get-CmdClaudePaths {
  $output = @(cmd.exe /d /c "where claude 2>nul")
  if ($LASTEXITCODE -ne 0) {
    return @()
  }
  return $output | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() }
}

function Test-CmdClaudeWorks {
  cmd.exe /d /c "claude --version >nul 2>nul"
  return $LASTEXITCODE -eq 0
}

function Remove-BrokenCmdClaudeLaunchers {
  foreach ($launcher in (Get-CmdClaudePaths)) {
    if (-not (Test-Path $launcher)) {
      continue
    }
    if (-not (Test-IsUserPath $launcher)) {
      continue
    }
    if (Test-ClaudeCommandWorks $launcher) {
      continue
    }
    Remove-Item -Path $launcher -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $launcher)) {
      Write-Host "Removed broken Claude launcher from cmd PATH: $launcher"
    }
  }
}

function Get-ClaudeCandidateDirs([string]$NpmPrefix) {
  $dirs = @()
  if ($NpmPrefix) {
    $dirs += $NpmPrefix
    $dirs += (Join-Path $NpmPrefix "bin")
    $dirs += (Join-Path $NpmPrefix "node_modules\.bin")
  }
  if ($env:APPDATA) {
    $dirs += (Join-Path $env:APPDATA "npm")
  }
  if ($env:LOCALAPPDATA) {
    $dirs += (Join-Path $env:LOCALAPPDATA "Programs\Claude")
  }
  if ($env:USERPROFILE) {
    $dirs += (Join-Path $env:USERPROFILE ".claude\local")
    $dirs += (Join-Path $env:USERPROFILE ".claude\local\bin")
    $dirs += (Join-Path $env:USERPROFILE ".local\bin")
  }
  return $dirs | Where-Object { $_ } | Select-Object -Unique
}

function Add-ClaudeCandidatePaths([string]$NpmPrefix) {
  Add-AnyRoutersClaudePaths $NpmPrefix
}

function Find-ClaudeCommand([string]$NpmPrefix) {
  foreach ($dir in (Get-ClaudeCandidateDirs $NpmPrefix)) {
    foreach ($file in @("claude.cmd", "claude.exe", "claude.ps1", "claude")) {
      $candidate = Join-Path $dir $file
      if (Test-ClaudeCommandWorks $candidate) {
        return $candidate
      }
    }
  }

  foreach ($cmd in @(Get-Command claude -All -ErrorAction SilentlyContinue)) {
    if ($cmd -and $cmd.Source -and (Test-ClaudeCommandWorks $cmd.Source)) {
      return $cmd.Source
    }
  }
  return $null
}

function Test-CmdCanFindClaude {
  cmd.exe /d /c "where claude >nul 2>nul"
  return $LASTEXITCODE -eq 0
}

function Repair-CmdClaudePath([string]$NpmPrefix) {
  Add-ClaudeCandidatePaths $NpmPrefix
  if (Test-CmdClaudeWorks) {
    return $true
  }
  Remove-BrokenCmdClaudeLaunchers
  Add-ClaudeCandidatePaths $NpmPrefix
  if (Test-CmdClaudeWorks) {
    return $true
  }

  $anyRoutersCommand = $null
  foreach ($dir in (Get-AnyRoutersClaudeDirs $NpmPrefix)) {
    foreach ($file in @("claude.cmd", "claude.exe", "claude.ps1", "claude")) {
      $candidate = Join-Path $dir $file
      if (Test-ClaudeCommandWorks $candidate) {
        $anyRoutersCommand = $candidate
        break
      }
    }
    if ($anyRoutersCommand) {
      break
    }
  }
  if ($anyRoutersCommand) {
    Remove-LegacyClaudeLaunchers
    Add-ClaudeCandidatePaths $NpmPrefix
  }
  return (Test-CmdClaudeWorks)
}

function Install-ClaudeWithUserNpm {
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "X Node.js and npm are required. Install Node.js from https://nodejs.org then re-run."
    return $false
  }

  New-Item -ItemType Directory -Force -Path $NpmPrefix | Out-Null
  Write-Host "Installing Claude Code with npm into: $NpmPrefix"
  npm install -g --prefix "$NpmPrefix" @anthropic-ai/claude-code
  if ($LASTEXITCODE -ne 0) {
    return $false
  }

  Add-ClaudeCandidatePaths $NpmPrefix
  Remove-LegacyClaudeLaunchers
  return $true
}

Write-Host "Installing Claude Code ..."
$installed = $false
try {
  $installerArguments = @{
    Uri = "https://claude.ai/install.ps1"
    ErrorAction = "Stop"
  }
  if ($ClaudeProxy) {
    $installerArguments["Proxy"] = $ClaudeProxy
  }
  $installer = Invoke-RestMethod @installerArguments
  if (Test-InstallerHtml $installer) {
    Write-Host "Official installer returned an HTML page. Skipping it."
  } else {
    Invoke-Expression $installer
    $claudePath = Find-ClaudeCommand $null
    if ($claudePath) {
      $installed = $true
      Add-UserPath (Split-Path -Parent $claudePath) $true
    } else {
      Write-Host "Official installer finished, but claude is not on PATH. Falling back to npm install."
    }
  }
} catch {
  Write-Host "Official installer failed."
}
if (-not $installed) {
  Write-Host "Using npm fallback without administrator permissions ..."
  if (-not (Install-ClaudeWithUserNpm)) {
    return
  }
}
Clear-ClaudeConflictingEnv
Update-ClaudeUserSettings
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://api.anyrouters.com", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $Key, "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL", $Model, "User")
$env:ANTHROPIC_BASE_URL = "https://api.anyrouters.com"
$env:ANTHROPIC_AUTH_TOKEN = $Key
$env:ANTHROPIC_MODEL = $Model
Write-Host "Cleared old Claude provider settings that could override AnyRouters."
Write-Host ""
$claudeCommand = Find-ClaudeCommand $NpmPrefix
if ($claudeCommand) {
  Add-UserPath (Split-Path -Parent $claudeCommand) $true
}
if ($claudeCommand) {
  & $claudeCommand --version
}

if (Repair-CmdClaudePath $NpmPrefix) {
  Write-Host "Done! Open a NEW PowerShell or cmd.exe window and run:  claude"
  if ($ClaudeProxy) {
    Write-Host "Keep the proxy app connected. In rule mode, api.anyrouters.com must use the proxy."
    Write-Host "Claude-specific HTTP_PROXY and HTTPS_PROXY were saved in ~/.claude/settings.json."
  }
} else {
  Write-Host "Claude Code may be installed, but cmd.exe still cannot run the claude command yet."
  Write-Host "Close all terminal windows, open a NEW cmd.exe, then run:  where claude"
  if ($claudeCommand) {
    Write-Host "Detected claude at: $claudeCommand"
    Write-Host "If where claude is still empty, add this folder to User Path:"
    Write-Host "  $(Split-Path -Parent $claudeCommand)"
  }
  $cmdPaths = @(Get-CmdClaudePaths)
  if ($cmdPaths.Count -gt 0) {
    Write-Host "cmd.exe currently finds:"
    foreach ($path in $cmdPaths) {
      Write-Host "  $path"
    }
  }
}
