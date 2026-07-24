# AnyRouters one-time Codex history metadata migration for Windows.
# Uses the unmodified MIT-licensed codex-provider-sync v0.3.1 source:
# https://github.com/Dailin521/codex-provider-sync/tree/v0.3.1
# The pinned source archive is served by AnyRouters so this command does not
# depend on GitHub, npm, Git, SSH configuration, or a global installation.

$ErrorActionPreference = "Stop"
$ArchiveUrl = "https://anyrouters.com/install/codex-provider-sync-lite-v0.3.1.zip"
$ArchiveSha256 = "6b6682b93772f81bf7e308a8a486a3748530fca62be6dca1ec38d65ac51dc36e"
$AllowedProviders = @("anyrouters", "openai", "openai_http")

try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

function Get-RootProvider([string]$ConfigPath) {
  $provider = "openai"
  foreach ($line in [System.IO.File]::ReadAllLines($ConfigPath)) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }
    if ($trimmed.StartsWith("[")) {
      break
    }
    if ($trimmed -match '^model_provider\s*=\s*"([^"]+)"\s*$') {
      return $Matches[1]
    }
  }
  return $provider
}

$CodexHome = if ($env:CODEX_HOME) {
  [System.IO.Path]::GetFullPath($env:CODEX_HOME)
} else {
  Join-Path $HOME ".codex"
}
$ConfigPath = Join-Path $CodexHome "config.toml"

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
  throw "未找到 $ConfigPath。请先完成 AnyRouters 配置，或先恢复并登录 OpenAI 官方账号。"
}

$runningCodex = @(
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -match '^(codex|codex-cli|codex-app-server)$' }
)
if ($runningCodex.Count -gt 0) {
  $names = ($runningCodex | Select-Object -ExpandProperty ProcessName -Unique) -join ", "
  throw "检测到 Codex 仍在运行（$names）。请完全退出 Codex 桌面版、CLI 和相关终端后重试；脚本不会强制结束进程。"
}

$Provider = Get-RootProvider $ConfigPath
if ($AllowedProviders -notcontains $Provider) {
  throw "当前 Provider 是 '$Provider'。为避免改写其他服务商的会话，本教程只允许 anyrouters、openai 或官方登录的 openai_http 兼容配置。"
}
$SessionProvider = if ($Provider -eq "openai_http") { "openai" } else { $Provider }

$nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $nodeCommand) {
  throw "未找到 Node.js。请安装或更新 Node.js 22.5+ 后重试；无需安装 npm 包、Git 或第三方启动器。"
}
$NodePath = $nodeCommand.Source
& $NodePath --no-warnings -e "import('node:sqlite').then(()=>process.exit(0)).catch(()=>process.exit(1))"
if ($LASTEXITCODE -ne 0) {
  throw "当前 Node.js 不含 node:sqlite。请更新到 Node.js 22.5+ 后重试；不要改用 npm/GitHub 在线安装。"
}

$WorkDir = Join-Path ([System.IO.Path]::GetTempPath()) ("anyrouters-codex-history-" + [guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $WorkDir "codex-provider-sync-lite-v0.3.1.zip"

try {
  New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
  Write-Host "正在下载本站固定版本的聊天迁移工具（约 48 KB）..."
  Invoke-WebRequest -UseBasicParsing -Uri $ArchiveUrl -OutFile $ArchivePath

  $actualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $ArchiveSha256) {
    throw "下载文件校验失败，已停止操作。"
  }

  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $WorkDir -Force
  $CliPath = Join-Path $WorkDir "codex-provider-sync-lite\src\cli.js"
  if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) {
    throw "迁移工具内容不完整，已停止操作。"
  }

  Write-Host ""
  Write-Host "当前配置 Provider：$Provider" -ForegroundColor Cyan
  Write-Host "会话目标 Provider：$SessionProvider" -ForegroundColor Cyan
  Write-Host "这会把本机 Codex 会话的 Provider、SQLite 和项目可见性元数据同步为 '$SessionProvider'。"
  Write-Host "不会上传聊天、修改消息正文、登录账号、API Key、系统代理或网络设置。"
  if ($Provider -eq "openai_http") {
    Write-Host "检测到官方登录的 HTTPS 兼容配置；脚本只把会话标记为 openai，不会改写该配置或 WebSocket/HTTPS 设置。"
  }
  Write-Host "工具会先在 $CodexHome\backups_state\provider-sync 创建本地备份。"
  Write-Host ""
  & $NodePath --no-warnings $CliPath status --codex-home $CodexHome
  if ($LASTEXITCODE -ne 0) {
    throw "读取 Codex 会话状态失败，未进行修改。"
  }

  Write-Host ""
  $confirmation = Read-Host "确认 Codex 已完全退出，并同步到 '$SessionProvider'？请输入 YES"
  if ($confirmation -cne "YES") {
    Write-Host "已取消，未修改聊天记录元数据。"
    return
  }

  & $NodePath --no-warnings $CliPath sync --provider $SessionProvider --keep 5 --codex-home $CodexHome
  if ($LASTEXITCODE -ne 0) {
    throw "聊天迁移未完成。请保留输出和自动备份并联系客服。"
  }

  Write-Host ""
  Write-Host "完成：请重新打开 Codex，检查聊天列表。" -ForegroundColor Green
  if ($SessionProvider -eq "openai") {
    Write-Host "当前已恢复官方聊天列表元数据；官方登录状态由 Codex 自己管理，本脚本未改动 auth.json。"
  } else {
    Write-Host "当前已同步到 AnyRouters；现有 AnyRouters API Key 和配置均未改动。"
  }
  Write-Host "包含 encrypted_content 的会话跨账号/Provider 后可能只能显示，继续或压缩仍可能失败。"
} finally {
  if (Test-Path -LiteralPath $WorkDir) {
    Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
