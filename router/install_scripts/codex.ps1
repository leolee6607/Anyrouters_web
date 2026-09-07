# AnyRouters one-line installer - Codex CLI. Safe to run more than once.
$ErrorActionPreference = "Stop"
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$Key = $env:ANYROUTERS_KEY
if (-not $Key) {
  throw "X No API key. Run:  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; `$env:ANYROUTERS_KEY='YOUR_KEY'; irm https://anyrouters.com/install/codex.ps1 | iex"
}
$Model = $env:ANYROUTERS_MODEL
if (-not $Model) {
  $Model = "gpt-5.6-sol"
}
$ConflictingCodexEnvNames = @(
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "OPENAI_API_HOST",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
  "CODEX_API_KEY"
)
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

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding -ArgumentList $false
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function New-CodexProcessStartInfo([string]$CodexExe, [string]$Arguments) {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $extension = [System.IO.Path]::GetExtension($CodexExe).ToLowerInvariant()
  if ($extension -eq ".cmd" -or $extension -eq ".bat") {
    $info.FileName = $env:ComSpec
    $escaped = $CodexExe.Replace('"', '""')
    $info.Arguments = '/d /s /c ""' + $escaped + '" ' + $Arguments + '"'
  } elseif ($extension -eq ".ps1") {
    $hostExe = Join-Path $PSHOME "powershell.exe"
    if (-not (Test-Path $hostExe)) {
      $hostExe = (Get-Process -Id $PID).Path
    }
    $info.FileName = $hostExe
    $escaped = $CodexExe.Replace('"', '`"')
    $info.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $escaped + '" ' + $Arguments
  } else {
    $info.FileName = $CodexExe
    $info.Arguments = $Arguments
  }
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
  if ($info.PSObject.Properties.Name -contains "StandardOutputEncoding") {
    $info.StandardOutputEncoding = $utf8
    $info.StandardErrorEncoding = $utf8
  }
  return $info
}

function Invoke-CodexCaptured([string]$CodexExe, [string]$Arguments) {
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = New-CodexProcessStartInfo $CodexExe $Arguments
  try {
    if (-not $process.Start()) {
      throw "Codex process did not start."
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    return [pscustomobject]@{
      ExitCode = $process.ExitCode
      Stdout = $stdoutTask.Result
      Stderr = $stderrTask.Result
    }
  } finally {
    $process.Dispose()
  }
}

function Remove-TerminalSequences([string]$Text) {
  if ($null -eq $Text) { return "" }
  $escape = [string][char]27
  $clean = $Text.TrimStart([char]0xFEFF)
  $clean = [regex]::Replace($clean, [regex]::Escape($escape) + '\[[0-?]*[ -/]*[@-~]', "")
  $clean = [regex]::Replace($clean, [regex]::Escape($escape) + '\][^\x07]*(?:\x07|' + [regex]::Escape($escape) + '\\)', "")
  return $clean.Trim()
}

function Get-BalancedJsonAt([string]$Text, [int]$Start) {
  $stack = New-Object 'System.Collections.Generic.Stack[char]'
  $inString = $false
  $escaped = $false
  for ($index = $Start; $index -lt $Text.Length; $index++) {
    $character = $Text[$index]
    if ($inString) {
      if ($escaped) {
        $escaped = $false
      } elseif ($character -eq '\') {
        $escaped = $true
      } elseif ($character -eq '"') {
        $inString = $false
      }
      continue
    }
    if ($character -eq '"') {
      $inString = $true
    } elseif ($character -eq '{' -or $character -eq '[') {
      $stack.Push($character)
    } elseif ($character -eq '}' -or $character -eq ']') {
      if ($stack.Count -eq 0) { return $null }
      $opening = $stack.Pop()
      if (($opening -eq '{' -and $character -ne '}') -or ($opening -eq '[' -and $character -ne ']')) {
        return $null
      }
      if ($stack.Count -eq 0) {
        return $Text.Substring($Start, $index - $Start + 1)
      }
    }
  }
  return $null
}

function Try-ParseJsonText([string]$Text) {
  try {
    $value = ConvertFrom-Json -InputObject $Text -ErrorAction Stop
    return [pscustomobject]@{ Success = $true; Value = $value }
  } catch {}
  try {
    Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = [int]::MaxValue
    $serializer.RecursionLimit = 256
    $value = $serializer.DeserializeObject($Text)
    return [pscustomobject]@{ Success = $true; Value = $value }
  } catch {
    return [pscustomobject]@{ Success = $false; Value = $null }
  }
}

function Resolve-CatalogRoot($Root) {
  $entries = $null
  if ($Root -is [System.Collections.IDictionary]) {
    if ($Root.Contains("models")) { $entries = @($Root["models"]) }
  } elseif ($Root -and $Root.PSObject.Properties.Name -contains "models") {
    $entries = @($Root.models)
  } elseif ($Root -is [System.Collections.IEnumerable] -and -not ($Root -is [string])) {
    $entries = @($Root)
  }
  if ($null -eq $entries -or $entries.Count -eq 0) { return $null }
  return [pscustomobject]@{ Root = $Root; Entries = $entries }
}

function Convert-CodexCatalogJson([string]$RawText) {
  $clean = Remove-TerminalSequences $RawText
  $candidates = New-Object 'System.Collections.Generic.List[string]'
  if ($clean) { $candidates.Add($clean) }
  $starts = New-Object 'System.Collections.Generic.HashSet[int]'
  foreach ($match in [regex]::Matches($clean, '\{\s*"models"\s*:')) {
    [void]$starts.Add($match.Index)
  }
  foreach ($match in [regex]::Matches($clean, '\[\s*\{')) {
    [void]$starts.Add($match.Index)
  }
  foreach ($start in $starts) {
    $candidate = Get-BalancedJsonAt $clean $start
    if ($candidate) { $candidates.Add($candidate) }
  }
  foreach ($candidate in @($candidates | Sort-Object Length -Descending -Unique)) {
    $parsed = Try-ParseJsonText $candidate
    if ($parsed.Success) {
      $resolved = Resolve-CatalogRoot $parsed.Value
      if ($resolved) { return $resolved }
    }
  }
  throw "Codex stdout did not contain a valid complete model catalog."
}

function Get-JsonField($Object, [string]$Name) {
  if ($Object -is [System.Collections.IDictionary]) {
    if ($Object.Contains($Name)) { return $Object[$Name] }
    return $null
  }
  $property = $Object.PSObject.Properties[$Name]
  if ($property) { return $property.Value }
  return $null
}

function Resolve-CodexExecutable([bool]$PreferDesktop) {
  if ($env:ANYROUTERS_CODEX_BIN -and (Test-Path $env:ANYROUTERS_CODEX_BIN)) {
    return $env:ANYROUTERS_CODEX_BIN
  }
  $desktopRoots = @(
    "$env:LOCALAPPDATA\Programs\ChatGPT",
    "$env:LOCALAPPDATA\OpenAI",
    "$env:ProgramFiles\ChatGPT",
    "$env:ProgramFiles\OpenAI"
  ) | Where-Object { $_ -and (Test-Path $_) }
  try {
    $desktopRoots += Get-AppxPackage -Name "*ChatGPT*" -ErrorAction SilentlyContinue |
      ForEach-Object { $_.InstallLocation } |
      Where-Object { $_ -and (Test-Path $_) }
  } catch {}

  if ($PreferDesktop) {
    foreach ($root in $desktopRoots) {
      $match = Get-ChildItem -Path $root -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($match) { return $match.FullName }
    }
  }

  $nativeCommand = Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue
  if ($nativeCommand) { return $nativeCommand.Source }
  $command = Get-Command codex -ErrorAction SilentlyContinue
  if ($command) {
    if ([System.IO.Path]::GetExtension($command.Source) -eq ".exe") { return $command.Source }
    $commandRoot = Split-Path $command.Source -Parent
    $nativeRoots = @(
      (Join-Path $commandRoot "node_modules\@openai\codex"),
      (Join-Path $env:APPDATA "npm\node_modules\@openai\codex")
    ) | Where-Object { $_ -and (Test-Path $_) }
    foreach ($nativeRoot in $nativeRoots) {
      $native = Get-ChildItem -Path $nativeRoot -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($native) { return $native.FullName }
    }
    return $command.Source
  }
  $localCodex = "$HOME\.local\bin\codex.exe"
  if (Test-Path $localCodex) { return $localCodex }

  if (-not $PreferDesktop) {
    foreach ($root in $desktopRoots) {
      $match = Get-ChildItem -Path $root -Filter "codex.exe" -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($match) { return $match.FullName }
    }
  }
  return $null
}

function Test-CodexNativeCompatibility([string]$CodexExe) {
  $probeDir = Join-Path ([System.IO.Path]::GetTempPath()) ("anyrouters-codex-probe-" + [guid]::NewGuid().ToString("N"))
  $hadCodexHome = Test-Path Env:CODEX_HOME
  $oldCodexHome = $env:CODEX_HOME
  $hadCodexNonInteractive = Test-Path Env:CODEX_NON_INTERACTIVE
  $oldCodexNonInteractive = $env:CODEX_NON_INTERACTIVE
  $oldConflictingCodexEnv = @{}
  foreach ($name in $ConflictingCodexEnvNames) {
    $existing = Get-Item "Env:$name" -ErrorAction SilentlyContinue
    if ($existing) { $oldConflictingCodexEnv[$name] = $existing.Value }
  }

  try {
    New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
    foreach ($name in $ConflictingCodexEnvNames) {
      [Environment]::SetEnvironmentVariable($name, $null, "Process")
    }
    $env:CODEX_HOME = $probeDir
    $env:CODEX_NON_INTERACTIVE = "1"
    $catalogResult = Invoke-CodexCaptured $CodexExe "debug models"
    if ($catalogResult.ExitCode -ne 0 -or -not $catalogResult.Stdout) {
      return $false
    }
    try {
      $resolvedCatalog = Convert-CodexCatalogJson $catalogResult.Stdout
    } catch {
      return $false
    }
    $catalogEntries = @($resolvedCatalog.Entries)
    $wanted = @("gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna")
    if ($Model -eq "gpt-6-astra") { $wanted += $Model }
    foreach ($slug in $wanted) {
      $entry = $catalogEntries | Where-Object { (Get-JsonField $_ "slug") -eq $slug } | Select-Object -First 1
      if (
        -not $entry -or
        -not (Get-JsonField $entry "multi_agent_version") -or
        -not (Get-JsonField $entry "tool_mode")
      ) {
        return $false
      }
    }
    return $true
  } finally {
    if ($hadCodexHome) { $env:CODEX_HOME = $oldCodexHome } else { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue }
    if ($hadCodexNonInteractive) { $env:CODEX_NON_INTERACTIVE = $oldCodexNonInteractive } else { Remove-Item Env:CODEX_NON_INTERACTIVE -ErrorAction SilentlyContinue }
    foreach ($name in $ConflictingCodexEnvNames) {
      if ($oldConflictingCodexEnv.ContainsKey($name)) {
        [Environment]::SetEnvironmentVariable($name, $oldConflictingCodexEnv[$name], "Process")
      } else {
        [Environment]::SetEnvironmentVariable($name, $null, "Process")
      }
    }
    Remove-Item $probeDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Move-AtomicFile([string]$Source, [string]$Destination) {
  if (Test-Path $Destination) {
    $replaceBackup = $Destination + ".replace-" + [guid]::NewGuid().ToString("N") + ".bak"
    try {
      [System.IO.File]::Replace($Source, $Destination, $replaceBackup)
    } finally {
      Remove-Item $replaceBackup -Force -ErrorAction SilentlyContinue
    }
  } else {
    [System.IO.File]::Move($Source, $Destination)
  }
}

function Protect-PrivatePath([string]$Path) {
  if ($env:OS -ne "Windows_NT") { return }
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($item.PSIsContainer) {
    $userGrant = "*${sid}:(OI)(CI)F"
    $systemGrant = "*S-1-5-18:(OI)(CI)F"
  } else {
    $userGrant = "*${sid}:F"
    $systemGrant = "*S-1-5-18:F"
  }
  & icacls.exe $item.FullName /inheritance:r /grant:r $userGrant $systemGrant | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not restrict access to $($item.FullName)."
  }
}

function Test-FileContentEqual([string]$First, [string]$Second) {
  if (-not (Test-Path $First) -or -not (Test-Path $Second)) { return $false }
  $firstBytes = [System.IO.File]::ReadAllBytes($First)
  $secondBytes = [System.IO.File]::ReadAllBytes($Second)
  if ($firstBytes.Length -ne $secondBytes.Length) { return $false }
  return [Convert]::ToBase64String($firstBytes) -eq [Convert]::ToBase64String($secondBytes)
}

function Clear-CodexConflictingEnv([string]$ApiKey) {
  foreach ($name in $ConflictingCodexEnvNames) {
    if ($name -eq "OPENAI_API_KEY") { continue }
    if ($env:OS -eq "Windows_NT") {
      [Environment]::SetEnvironmentVariable($name, $null, "User")
    }
    [Environment]::SetEnvironmentVariable($name, $null, "Process")
  }
  if ($env:OS -eq "Windows_NT") {
    [Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $ApiKey, "User")
  }
  [Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $ApiKey, "Process")
  Write-Host "Cleared known legacy Codex/OpenAI relay overrides and configured the existing AnyRouters key."
}

function Preserve-McpAndUnrelatedCodexConfig([string]$Path) {
  if (-not (Test-Path $Path)) { return "" }

  $current = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  $managedRootKeys = @{
    model = $true
    model_provider = $true
    model_catalog_json = $true
  }
  $kept = New-Object System.Collections.Generic.List[string]
  $atRoot = $true
  $skipAnyRoutersProvider = $false
  $lines = [System.Text.RegularExpressions.Regex]::Split($current, "(?<=`n)")

  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    $header = [System.Text.RegularExpressions.Regex]::Match(
      $trimmed,
      '^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$'
    )
    if ($header.Success) {
      $section = $header.Groups[1].Value.Trim()
      $skipAnyRoutersProvider = (
        $section -eq "model_providers.anyrouters" -or
        $section.StartsWith("model_providers.anyrouters.")
      )
      $atRoot = $false
      if ($skipAnyRoutersProvider) { continue }
    } elseif ($skipAnyRoutersProvider) {
      continue
    }

    if ($atRoot) {
      $assignment = [System.Text.RegularExpressions.Regex]::Match($trimmed, '^([A-Za-z0-9_-]+)\s*=')
      if ($assignment.Success -and $managedRootKeys.ContainsKey($assignment.Groups[1].Value)) {
        continue
      }
    }
    $kept.Add($line)
  }

  return ([string]::Concat($kept.ToArray())).Trim()
}

function Install-NativeCodexConfiguration(
  [string]$Dir,
  [string]$CodexExe,
  [string]$SelectedModel,
  [string]$ApiKey
) {
  $configPath = Join-Path $Dir "config.toml"
  $legacyCatalogPath = Join-Path $Dir "model-catalog-anyrouters-gpt56.json"
  $lockPath = Join-Path $Dir ".anyrouters-native.lock"
  $lockStream = $null
  try {
    $lockStream = [System.IO.File]::Open(
      $lockPath,
      [System.IO.FileMode]::OpenOrCreate,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    )
  } catch {
    throw "X Another AnyRouters Codex configuration is running; wait for it to finish and retry."
  }

  $workDir = Join-Path $Dir (".anyrouters-native-" + [guid]::NewGuid().ToString("N"))
  $nativeHome = Join-Path $workDir "native-home"
  $validateHome = Join-Path $workDir "validate-home"
  $hadCodexHome = Test-Path Env:CODEX_HOME
  $oldCodexHome = $env:CODEX_HOME
  $hadCodexNonInteractive = Test-Path Env:CODEX_NON_INTERACTIVE
  $oldCodexNonInteractive = $env:CODEX_NON_INTERACTIVE
  $oldConflictingCodexEnv = @{}
  foreach ($name in $ConflictingCodexEnvNames) {
    $existing = Get-Item "Env:$name" -ErrorAction SilentlyContinue
    if ($existing) { $oldConflictingCodexEnv[$name] = $existing.Value }
  }

  try {
    New-Item -ItemType Directory -Force -Path $workDir | Out-Null
    Protect-PrivatePath $workDir
    New-Item -ItemType Directory -Force -Path $nativeHome | Out-Null
    New-Item -ItemType Directory -Force -Path $validateHome | Out-Null
    foreach ($name in $ConflictingCodexEnvNames) {
      [Environment]::SetEnvironmentVariable($name, $null, "Process")
    }
    $env:CODEX_NON_INTERACTIVE = "1"
    if (Test-Path $configPath) {
      $env:CODEX_HOME = $Dir
      $currentResult = Invoke-CodexCaptured $CodexExe "debug models"
      if ($currentResult.ExitCode -ne 0) {
        throw "X Existing config.toml is invalid; existing configuration was not changed."
      }
    }

    Write-Host "Checking Codex native model capabilities ..."
    $env:CODEX_HOME = $nativeHome
    $versionResult = Invoke-CodexCaptured $CodexExe "--version"
    $version = (Remove-TerminalSequences $versionResult.Stdout).Trim()
    if (-not $version) { $version = "unknown" }
    Write-Host "Using Codex: $CodexExe"
    Write-Host "Codex version: $version"
    $catalogResult = Invoke-CodexCaptured $CodexExe "debug models"
    if ($catalogResult.ExitCode -ne 0 -or -not $catalogResult.Stdout) {
      throw "X Codex could not export its native model catalog (path: $CodexExe; version: $version). Existing configuration was not changed."
    }
    try {
      $resolvedCatalog = Convert-CodexCatalogJson $catalogResult.Stdout
    } catch {
      throw "X Codex returned an invalid native model catalog (path: $CodexExe; version: $version). Existing configuration was not changed."
    }
    $catalogEntries = @($resolvedCatalog.Entries)

    $wanted = @("gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna")
    if ($SelectedModel -eq "gpt-6-astra") { $wanted += $SelectedModel }
    foreach ($slug in $wanted) {
      $entry = $catalogEntries | Where-Object { (Get-JsonField $_ "slug") -eq $slug } | Select-Object -First 1
      if (-not $entry) {
        throw "X Codex native model catalog is missing $slug; existing configuration was not changed."
      }
      if (-not (Get-JsonField $entry "multi_agent_version") -or -not (Get-JsonField $entry "tool_mode")) {
        throw "X $slug native collaboration/tool metadata is unavailable; existing configuration was not changed."
      }
    }

    $configStage = Join-Path $workDir "config.toml"
    $modelLiteral = $SelectedModel | ConvertTo-Json -Compress
    $anyRoutersProvider = @"
[model_providers.anyrouters]
name = "AnyRouters"
base_url = "https://api.anyrouters.com/v1"
wire_api = "responses"
supports_websockets = false
env_key = "OPENAI_API_KEY"
"@
    $preservedConfig = Preserve-McpAndUnrelatedCodexConfig $configPath
    if ($SelectedModel -eq "gpt-6-astra") {
      $rootConfig = [regex]::Split($preservedConfig, '(?m)^\s*\[')[0]
      if ($rootConfig -match '(?m)^\s*model_reasoning_effort\s*=\s*["''](?:none|minimal)["'']') {
        throw "X gpt-6-astra does not support this model_reasoning_effort. Choose low, medium, high, xhigh or max, then re-run; existing configuration was not changed."
      }
    }
    $configParts = @("model = $modelLiteral`nmodel_provider = `"anyrouters`"")
    if ($preservedConfig) { $configParts += $preservedConfig }
    $configParts += $anyRoutersProvider.Trim()
    $configToml = ($configParts -join ([Environment]::NewLine + [Environment]::NewLine))
    Write-Utf8NoBom $configStage ($configToml + [Environment]::NewLine)
    Protect-PrivatePath $configStage

    Copy-Item $configStage (Join-Path $validateHome "config.toml") -Force
    [Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $ApiKey, "Process")
    $env:CODEX_HOME = $validateHome
    $validateResult = Invoke-CodexCaptured $CodexExe "debug models"
    if ($validateResult.ExitCode -ne 0) {
      throw "X Generated config.toml is invalid; existing configuration was not changed."
    }

    if (Test-FileContentEqual $configStage $configPath) {
      Protect-PrivatePath $configPath
      Write-Host "AnyRouters native Codex configuration is already up to date."
      Write-Host "Native model catalog, collaboration, tools, plugins, MCP, trust, login, and reasoning effort were preserved."
      return
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
    $backupDir = Join-Path $Dir "anyrouters-native-backup-$stamp"
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Protect-PrivatePath $backupDir
    foreach ($file in @("config.toml", "auth.json", "anyrouters-api-key", "model-catalog-anyrouters-gpt56.json")) {
      $path = Join-Path $Dir $file
      if (Test-Path $path) {
        $backupPath = Join-Path $backupDir $file
        Copy-Item $path $backupPath -Force
        Protect-PrivatePath $backupPath
      }
    }
    Write-Host "Backed up old Codex files to: $backupDir"
    Write-Host "Restore files from this directory if you need to roll back."

    try {
      Move-AtomicFile $configStage $configPath
      Protect-PrivatePath $configPath
    } catch {
      $activationError = $_.Exception.Message
      try {
        foreach ($file in @("config.toml")) {
          $destination = Join-Path $Dir $file
          $oldFile = Join-Path $backupDir $file
          if (Test-Path $oldFile) {
            $restoreStage = Join-Path $workDir ("restore-" + $file)
            Copy-Item $oldFile $restoreStage -Force
            Protect-PrivatePath $restoreStage
            Move-AtomicFile $restoreStage $destination
            Protect-PrivatePath $destination
          } elseif (Test-Path $destination) {
            Remove-Item $destination -Force
          }
        }
      } catch {
        throw "X Activation failed ($activationError), and automatic rollback also failed: $($_.Exception.Message)"
      }
      throw "X Could not activate config.toml; the previous configuration was restored."
    }
    Write-Host "Native model catalog, collaboration, tools, plugins, MCP, trust, login, and reasoning effort were preserved."
    if (Test-Path $legacyCatalogPath) {
      Write-Host "The legacy custom catalog was kept as an unused rollback file."
    }
  } finally {
    if ($hadCodexHome) { $env:CODEX_HOME = $oldCodexHome } else { Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue }
    if ($hadCodexNonInteractive) { $env:CODEX_NON_INTERACTIVE = $oldCodexNonInteractive } else { Remove-Item Env:CODEX_NON_INTERACTIVE -ErrorAction SilentlyContinue }
    foreach ($name in $ConflictingCodexEnvNames) {
      if ($oldConflictingCodexEnv.ContainsKey($name)) {
        [Environment]::SetEnvironmentVariable($name, $oldConflictingCodexEnv[$name], "Process")
      } else {
        [Environment]::SetEnvironmentVariable($name, $null, "Process")
      }
    }
    Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue
    if ($lockStream) { $lockStream.Dispose() }
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
  }
}

$OriginalKey = $Key
$Key = Normalize-AnyRoutersKey $Key
if ($OriginalKey -ne $Key) {
  Write-Host "Fixed API key prefix: removed accidental sk-anyrouters-."
}
if (-not $Key -or $Key -match "YOUR_KEY|YOUR_ANYROUTERS_API_KEY|本页顶部|API 密钥") {
  throw "X Replace the placeholder with your real AnyRouters API key."
}

try {
  Invoke-RestMethod -Method Get -Uri "https://api.anyrouters.com/v1/models" -Headers @{ Authorization = "Bearer $Key" } -TimeoutSec 20 | Out-Null
} catch {
  $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "network error" }
  Write-Host "X API key validation failed ($status)."
  Write-Host "  Copy the complete key from AnyRouters API Keys. Do not add sk-anyrouters- before it."
  throw "API key validation failed."
}

$codexExe = Resolve-CodexExecutable $false
$needsInstallOrUpgrade = $true
if ($codexExe -and (Test-CodexNativeCompatibility $codexExe)) {
  Write-Host "Existing compatible Codex detected; skipping installation."
  $needsInstallOrUpgrade = $false
} elseif ($codexExe) {
  Write-Host "Existing Codex lacks the required native GPT-5.6 capabilities or selected model $Model; upgrading it ..."
} else {
  Write-Host "Codex CLI was not found; installing it ..."
}

if ($needsInstallOrUpgrade) {
  $installed = $false
  $hadCodexNonInteractive = Test-Path Env:CODEX_NON_INTERACTIVE
  $oldCodexNonInteractive = $env:CODEX_NON_INTERACTIVE
  try {
    $env:CODEX_NON_INTERACTIVE = "1"
    $installer = Invoke-RestMethod -Uri "https://chatgpt.com/codex/install.ps1" -ErrorAction Stop
    Invoke-Expression $installer
    $installed = $true
  } catch {
    Write-Host "Official installer failed. Trying npm ..."
  } finally {
    if ($hadCodexNonInteractive) {
      $env:CODEX_NON_INTERACTIVE = $oldCodexNonInteractive
    } else {
      Remove-Item Env:CODEX_NON_INTERACTIVE -ErrorAction SilentlyContinue
    }
  }
  if (-not $installed) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
      throw "X Node.js is required. Install it from https://nodejs.org then re-run."
    }
    npm install -g @openai/codex
  }
  $codexExe = Resolve-CodexExecutable $false
  if (-not $codexExe) {
    throw "X Codex was installed or upgraded but its executable is not available yet. Open a new PowerShell window and re-run this command."
  }
}

$dir = "$HOME\.codex"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
if (-not $codexExe) {
  throw "X Could not find Codex. Install Codex CLI, then re-run this command."
}
Install-NativeCodexConfiguration $dir $codexExe $Model $Key
Clear-CodexConflictingEnv $Key
$Key = $null
Write-Host ""
Write-Host "Done! Open a NEW terminal window and run:  codex"
Write-Host "Configuration is ready; verify /status, a real tool call, and site usage before relying on it."
Write-Host "If Code Mode is unavailable, repair the complete official Codex installation, including codex-code-mode-host."
Write-Host "Compatible existing versions are kept; installation or upgrade only runs when required native capabilities are missing."
