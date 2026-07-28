#!/bin/bash
# AnyRouters one-line installer - Claude Code. Safe to run more than once;
# repairs a messed-up shell profile (removes stale/duplicate ANTHROPIC_* lines).
set -e
KEY="${1:-$ANYROUTERS_KEY}"
RESET="${2:---reset}"
MODEL="${ANYROUTERS_MODEL:-claude-sonnet-4-6}"
CONFLICTING_CLAUDE_ENV_NAMES="
ANTHROPIC_API_KEY
CLAUDE_CODE_OAUTH_TOKEN
ANTHROPIC_CUSTOM_HEADERS
ANTHROPIC_SMALL_FAST_MODEL
ANTHROPIC_DEFAULT_OPUS_MODEL
ANTHROPIC_DEFAULT_SONNET_MODEL
ANTHROPIC_DEFAULT_HAIKU_MODEL
ANTHROPIC_DEFAULT_FABLE_MODEL
ANTHROPIC_BEDROCK_BASE_URL
ANTHROPIC_VERTEX_BASE_URL
ANTHROPIC_VERTEX_PROJECT_ID
CLOUD_ML_REGION
CLAUDE_CODE_USE_BEDROCK
CLAUDE_CODE_USE_VERTEX
CLAUDE_CODE_USE_FOUNDRY
CLAUDE_CODE_USE_MANTLE
CLAUDE_CODE_USE_ANTHROPIC_AWS
ANTHROPIC_AWS_WORKSPACE_ID
"
if [ -z "$KEY" ]; then
  echo "X No API key. Run:  curl -fsSL https://anyrouters.com/install/claude.sh | bash -s -- YOUR_KEY"
  exit 1
fi

normalize_key() {
  k="$(printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  k="${k#Bearer }"
  k="${k#bearer }"
  k="${k%\"}"
  k="${k#\"}"
  k="${k%\'}"
  k="${k#\'}"
  case "$k" in
    sk-anyrouters-sk-*) k="sk-${k#sk-anyrouters-sk-}" ;;
    sk-anyrouters-*) k="sk-${k#sk-anyrouters-}" ;;
    anyrouters-sk-*) k="sk-${k#anyrouters-sk-}" ;;
  esac
  printf '%s' "$k"
}

ORIGINAL_KEY="$KEY"
KEY="$(normalize_key "$KEY")"
if [ "$ORIGINAL_KEY" != "$KEY" ]; then
  echo "Fixed API key prefix: removed accidental sk-anyrouters-."
fi
case "$KEY" in
  ""|*YOUR_KEY*|*YOUR_ANYROUTERS_API_KEY*|*本页顶部*|*"API 密钥"*)
    echo "X Replace the placeholder with your real AnyRouters API key."
    exit 1
    ;;
esac

normalize_http_proxy() {
  proxy="$(printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  proxy="${proxy%\"}"
  proxy="${proxy#\"}"
  proxy="${proxy%\'}"
  proxy="${proxy#\'}"
  case "$proxy" in
    ""|[Ss][Oo][Cc][Kk][Ss]*) return 1 ;;
    *://*) ;;
    *) proxy="http://$proxy" ;;
  esac
  case "$proxy" in
    http://*|https://*) ;;
    *) return 1 ;;
  esac
  authority="${proxy#*://}"
  authority="${authority%%/*}"
  [ -n "$authority" ] || return 1
  printf '%s' "${proxy%/}"
}

claude_settings_proxy_candidates() {
  settings_path="$HOME/.claude/settings.json"
  [ -f "$settings_path" ] || return 0

  if command -v plutil >/dev/null 2>&1; then
    plutil -extract env.HTTPS_PROXY raw -o - "$settings_path" 2>/dev/null || true
    printf '\n'
    plutil -extract env.HTTP_PROXY raw -o - "$settings_path" 2>/dev/null || true
    printf '\n'
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    ANYROUTERS_SETTINGS_PATH="$settings_path" node <<'NODE'
const fs = require('fs')
try {
  const value = JSON.parse(fs.readFileSync(process.env.ANYROUTERS_SETTINGS_PATH, 'utf8').replace(/^\uFEFF/, ''))
  console.log(value?.env?.HTTPS_PROXY || '')
  console.log(value?.env?.HTTP_PROXY || '')
} catch {
  // An unreadable settings file is backed up later by the normal settings update.
}
NODE
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    ANYROUTERS_SETTINGS_PATH="$settings_path" python3 <<'PY'
import json
import os

try:
    with open(os.environ["ANYROUTERS_SETTINGS_PATH"], "r", encoding="utf-8-sig") as handle:
        value = json.load(handle)
    env = value.get("env", {}) if isinstance(value, dict) else {}
    print(env.get("HTTPS_PROXY", ""))
    print(env.get("HTTP_PROXY", ""))
except (OSError, ValueError):
    pass
PY
  fi
}

macos_system_proxy_candidates() {
  command -v scutil >/dev/null 2>&1 || return 0
  proxy_state="$(scutil --proxy 2>/dev/null || true)"
  [ -n "$proxy_state" ] || return 0

  https_enabled="$(printf '%s\n' "$proxy_state" | awk '$1 == "HTTPSEnable" && $2 == ":" { print $3; exit }')"
  https_host="$(printf '%s\n' "$proxy_state" | awk '$1 == "HTTPSProxy" && $2 == ":" { print $3; exit }')"
  https_port="$(printf '%s\n' "$proxy_state" | awk '$1 == "HTTPSPort" && $2 == ":" { print $3; exit }')"
  if [ "$https_enabled" = "1" ] && [ -n "$https_host" ] && [ -n "$https_port" ]; then
    printf 'http://%s:%s\n' "$https_host" "$https_port"
  fi

  http_enabled="$(printf '%s\n' "$proxy_state" | awk '$1 == "HTTPEnable" && $2 == ":" { print $3; exit }')"
  http_host="$(printf '%s\n' "$proxy_state" | awk '$1 == "HTTPProxy" && $2 == ":" { print $3; exit }')"
  http_port="$(printf '%s\n' "$proxy_state" | awk '$1 == "HTTPPort" && $2 == ":" { print $3; exit }')"
  if [ "$http_enabled" = "1" ] && [ -n "$http_host" ] && [ -n "$http_port" ]; then
    printf 'http://%s:%s\n' "$http_host" "$http_port"
  fi
}

proxy_candidates() {
  {
    printf '%s\n' \
      "${ANYROUTERS_PROXY:-}" \
      "${HTTPS_PROXY:-}" \
      "${https_proxy:-}" \
      "${HTTP_PROXY:-}" \
      "${http_proxy:-}"
    claude_settings_proxy_candidates
    macos_system_proxy_candidates
  } | while IFS= read -r candidate; do
    normalized="$(normalize_http_proxy "$candidate" 2>/dev/null || true)"
    [ -n "$normalized" ] && printf '%s\n' "$normalized"
  done | awk '!seen[$0]++'
}

probe_api_route() {
  route_proxy="$1"
  route_mode="$2"
  probe_body="$(mktemp)"
  probe_args=(-sS --max-time 15 -o "$probe_body" -w "%{http_code}|%{content_type}")
  if [ "$route_mode" = "direct" ]; then
    probe_args+=(--noproxy "*")
  elif [ -n "$route_proxy" ]; then
    probe_args+=(--noproxy "" --proxy "$route_proxy")
  fi
  probe_args+=(https://api.anyrouters.com/v1/models)

  if probe_meta="$(curl "${probe_args[@]}" 2>/dev/null)"; then
    PROBE_AVAILABLE=1
  else
    PROBE_AVAILABLE=0
  fi
  PROBE_STATUS="${probe_meta%%|*}"
  PROBE_CONTENT_TYPE="${probe_meta#*|}"
  probe_start="$(LC_ALL=C head -c 512 "$probe_body" 2>/dev/null || true)"
  rm -f "$probe_body"
  case "$probe_start" in
    "<!doctype html"*|"<html"*|"<meta"*) PROBE_HTML=1 ;;
    *) PROBE_HTML=0 ;;
  esac
  PROBE_API_JSON=0
  if [ "$PROBE_AVAILABLE" = "1" ]; then
    case "$PROBE_STATUS" in
      200|401)
        case "$PROBE_CONTENT_TYPE:$probe_start" in
          *application/json*|*:\{*|*:\[*)
            PROBE_API_JSON=1
            ;;
        esac
        ;;
    esac
  fi
}

if ! command -v curl >/dev/null 2>&1; then
  echo "X curl is required."
  exit 1
fi

CLAUDE_PROXY=""
probe_api_route "" direct
DIRECT_API_JSON="$PROBE_API_JSON"
DIRECT_STATUS="$PROBE_STATUS"
DIRECT_HTML="$PROBE_HTML"
if [ "$DIRECT_API_JSON" != "1" ]; then
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    probe_api_route "$candidate" proxy
    if [ "$PROBE_API_JSON" = "1" ]; then
      CLAUDE_PROXY="$candidate"
      break
    fi
  done <<EOF
$(proxy_candidates)
EOF
fi

if [ "$DIRECT_API_JSON" != "1" ] && [ -z "$CLAUDE_PROXY" ]; then
  echo "X AnyRouters API is not reachable through the current macOS terminal route."
  if [ "$DIRECT_STATUS" = "403" ] || [ "$DIRECT_HTML" = "1" ]; then
    echo "  Direct access returned an HTML 403 page. This is a proxy-routing issue, not an API key error."
  fi
  echo "  Keep your proxy app connected and enable an HTTP or Mixed proxy, then re-run this command."
  echo "  TUN/Fake-IP mode is supported. SOCKS-only and PAC-only settings cannot be written to Claude Code."
  echo "  If automatic detection is unavailable, set ANYROUTERS_PROXY first, for example:"
  echo '  export ANYROUTERS_PROXY="http://127.0.0.1:YOUR_HTTP_PORT"'
  exit 1
fi

if [ -n "$CLAUDE_PROXY" ]; then
  echo "Detected a working HTTP proxy for Claude Code: $CLAUDE_PROXY"
  echo "The proxy will be saved only in Claude settings; macOS system proxy settings will not be changed."
  export HTTP_PROXY="$CLAUDE_PROXY"
  export HTTPS_PROXY="$CLAUDE_PROXY"
  export http_proxy="$CLAUDE_PROXY"
  export https_proxy="$CLAUDE_PROXY"
  export NO_PROXY=""
  export no_proxy=""
fi

validation_args=(-sS --max-time 20 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $KEY")
if [ -n "$CLAUDE_PROXY" ]; then
  validation_args+=(--noproxy "" --proxy "$CLAUDE_PROXY")
else
  validation_args+=(--noproxy "*")
fi
validation_args+=(https://api.anyrouters.com/v1/models)
status="$(curl "${validation_args[@]}" 2>/dev/null || true)"
if [ "$status" != "200" ]; then
  echo "X API key validation failed (HTTP $status)."
  echo "  Copy the complete key from AnyRouters API Keys. Do not add sk-anyrouters- before it."
  exit 1
fi

if [ "$RESET" = "--reset" ] || [ "${ANYROUTERS_RESET:-}" = "1" ]; then
  echo "Resetting AnyRouters Claude Code environment ..."
fi
NPM_PREFIX="${ANYROUTERS_NPM_PREFIX:-$HOME/.anyrouters/npm}"

ensure_node_and_npm() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Node.js via Homebrew ..."
    brew install node
    return 0
  fi
  echo "X Node.js and npm are required. Install Node.js from https://nodejs.org then re-run."
  exit 1
}

install_claude_with_user_npm() {
  ensure_node_and_npm
  mkdir -p "$NPM_PREFIX"
  echo "Installing Claude Code with npm into: $NPM_PREFIX"
  npm install -g --prefix "$NPM_PREFIX" @anthropic-ai/claude-code
  export PATH="$NPM_PREFIX/bin:$PATH"
}

installer_is_html() {
  LC_ALL=C head -c 512 "$1" | grep -Eiq '<!doctype html|<html|</html'
}

update_claude_user_settings() {
  settings_dir="$HOME/.claude"
  settings_path="$settings_dir/settings.json"
  mkdir -p "$settings_dir"

  if command -v node >/dev/null 2>&1; then
    ANYROUTERS_SETTINGS_PATH="$settings_path" ANYROUTERS_MODEL="$MODEL" ANYROUTERS_CLAUDE_PROXY="$CLAUDE_PROXY" node <<'NODE'
const fs = require('fs')

const settingsPath = process.env.ANYROUTERS_SETTINGS_PATH
const model = process.env.ANYROUTERS_MODEL
const proxy = process.env.ANYROUTERS_CLAUDE_PROXY || ''
const conflicting = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_BASE_URL',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'ANTHROPIC_AWS_WORKSPACE_ID',
  'ANTHROPIC_AUTH_TOKEN',
]

let settings = {}
if (fs.existsSync(settingsPath)) {
  const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '')
  if (raw.trim()) {
    try {
      settings = JSON.parse(raw)
    } catch {
      const invalidBackup = `${settingsPath}.anyrouters-invalid-${Date.now()}.bak`
      fs.copyFileSync(settingsPath, invalidBackup)
      console.log(`Backed up unreadable Claude settings to: ${invalidBackup}`)
      settings = {}
    }
  }
}
if (!settings || Array.isArray(settings) || typeof settings !== 'object') {
  settings = {}
}
if (!settings.env || Array.isArray(settings.env) || typeof settings.env !== 'object') {
  settings.env = {}
}
for (const name of conflicting) {
  delete settings.env[name]
}
delete settings.apiKeyHelper
settings.env.ANTHROPIC_BASE_URL = 'https://api.anyrouters.com'
settings.env.ANTHROPIC_MODEL = model
if (proxy) {
  settings.env.HTTP_PROXY = proxy
  settings.env.HTTPS_PROXY = proxy
}
if (fs.existsSync(settingsPath)) {
  fs.copyFileSync(settingsPath, `${settingsPath}.anyrouters.bak`)
}
fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
console.log(`Updated Claude Code settings: ${settingsPath}`)
NODE
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    ANYROUTERS_SETTINGS_PATH="$settings_path" ANYROUTERS_MODEL="$MODEL" ANYROUTERS_CLAUDE_PROXY="$CLAUDE_PROXY" python3 <<'PY'
import json
import os
import shutil
import time

settings_path = os.environ["ANYROUTERS_SETTINGS_PATH"]
model = os.environ["ANYROUTERS_MODEL"]
proxy = os.environ.get("ANYROUTERS_CLAUDE_PROXY", "")
conflicting = {
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
    "ANTHROPIC_AWS_WORKSPACE_ID",
    "ANTHROPIC_AUTH_TOKEN",
}

settings = {}
if os.path.exists(settings_path):
    try:
        with open(settings_path, "r", encoding="utf-8-sig") as handle:
            settings = json.load(handle)
    except (json.JSONDecodeError, OSError):
        backup = f"{settings_path}.anyrouters-invalid-{int(time.time())}.bak"
        shutil.copy2(settings_path, backup)
        print(f"Backed up unreadable Claude settings to: {backup}")
        settings = {}
if not isinstance(settings, dict):
    settings = {}
env = settings.get("env")
if not isinstance(env, dict):
    env = {}
settings["env"] = env
for name in conflicting:
    env.pop(name, None)
settings.pop("apiKeyHelper", None)
env["ANTHROPIC_BASE_URL"] = "https://api.anyrouters.com"
env["ANTHROPIC_MODEL"] = model
if proxy:
    env["HTTP_PROXY"] = proxy
    env["HTTPS_PROXY"] = proxy
if os.path.exists(settings_path):
    shutil.copy2(settings_path, f"{settings_path}.anyrouters.bak")
with open(settings_path, "w", encoding="utf-8") as handle:
    json.dump(settings, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
os.chmod(settings_path, 0o600)
print(f"Updated Claude Code settings: {settings_path}")
PY
    return
  fi

  echo "Could not safely update $settings_path because Node.js/Python 3 is unavailable."
}

clear_current_claude_env() {
  for name in $CONFLICTING_CLAUDE_ENV_NAMES; do
    unset "$name"
  done
}

write_claude_env() {
  profile="$1"
  [ -n "$profile" ] || return 0
  touch "$profile"
  cp "$profile" "$profile.anyrouters.bak" 2>/dev/null || true
  tmp_profile="$profile.anyrouters.tmp"
  strip_managed=0
  if grep -qF "# anyrouters-managed-begin" "$profile" &&
    grep -qF "# anyrouters-managed-end" "$profile"; then
    strip_managed=1
  fi
  awk -v strip_managed="$strip_managed" '
    strip_managed && $0 == "# anyrouters-managed-begin" { managed = 1; next }
    strip_managed && managed && $0 == "# anyrouters-managed-end" { managed = 0; next }
    strip_managed && managed { next }
    !strip_managed && ($0 == "# anyrouters-managed-begin" || $0 == "# anyrouters-managed-end") { next }
    $0 ~ /^[[:space:]]*(export[[:space:]]+)?(ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_MODEL|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_CUSTOM_HEADERS|ANTHROPIC_SMALL_FAST_MODEL|ANTHROPIC_DEFAULT_OPUS_MODEL|ANTHROPIC_DEFAULT_SONNET_MODEL|ANTHROPIC_DEFAULT_HAIKU_MODEL|ANTHROPIC_DEFAULT_FABLE_MODEL|ANTHROPIC_BEDROCK_BASE_URL|ANTHROPIC_VERTEX_BASE_URL|ANTHROPIC_VERTEX_PROJECT_ID|CLOUD_ML_REGION|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|CLAUDE_CODE_USE_MANTLE|CLAUDE_CODE_USE_ANTHROPIC_AWS|ANTHROPIC_AWS_WORKSPACE_ID)[[:space:]]*=/ { next }
    { print }
  ' "$profile" > "$tmp_profile"
  mv "$tmp_profile" "$profile"
  {
    printf '\n# anyrouters-managed-begin\n'
    echo "export PATH=\"$NPM_PREFIX/bin:\$PATH\""
    for name in $CONFLICTING_CLAUDE_ENV_NAMES; do
      printf 'unset %s\n' "$name"
    done
    echo "export ANTHROPIC_BASE_URL=https://api.anyrouters.com"
    printf 'export ANTHROPIC_AUTH_TOKEN=%s\n' "$(printf '%s' "$KEY" | sed "s/'/'\\\\''/g; s/.*/'&'/")"
    printf 'export ANTHROPIC_MODEL=%s\n' "$(printf '%s' "$MODEL" | sed "s/'/'\\\\''/g; s/.*/'&'/")"
    printf '# anyrouters-managed-end\n'
  } >> "$profile"
  echo "Saved AnyRouters Claude environment to: $profile"
}

echo "Installing Claude Code ..."
tmp_installer="$(mktemp)"
official_installed=0
if curl -fsSL https://claude.ai/install.sh -o "$tmp_installer"; then
  if installer_is_html "$tmp_installer"; then
    echo "Official installer returned an HTML page. Skipping it."
  elif bash "$tmp_installer"; then
    official_installed=1
  else
    echo "Official installer failed."
  fi
else
  echo "Official installer download failed."
fi
rm -f "$tmp_installer"
if [ "$official_installed" -ne 1 ]; then
  echo "Using npm fallback without administrator permissions ..."
  install_claude_with_user_npm
fi

update_claude_user_settings
clear_current_claude_env
export ANTHROPIC_BASE_URL="https://api.anyrouters.com"
export ANTHROPIC_AUTH_TOKEN="$KEY"
export ANTHROPIC_MODEL="$MODEL"
case "${SHELL:-}" in
  */zsh)
    write_claude_env "${ZDOTDIR:-$HOME}/.zshrc"
    write_claude_env "${ZDOTDIR:-$HOME}/.zprofile"
    ;;
  */bash)
    write_claude_env "$HOME/.bashrc"
    write_claude_env "$HOME/.bash_profile"
    ;;
  *)
    write_claude_env "$HOME/.profile"
    ;;
esac
if command -v launchctl >/dev/null 2>&1; then
  for name in $CONFLICTING_CLAUDE_ENV_NAMES; do
    launchctl unsetenv "$name" 2>/dev/null || true
  done
  launchctl setenv ANTHROPIC_BASE_URL "https://api.anyrouters.com" 2>/dev/null || true
  launchctl setenv ANTHROPIC_AUTH_TOKEN "$KEY" 2>/dev/null || true
  launchctl setenv ANTHROPIC_MODEL "$MODEL" 2>/dev/null || true
fi
echo "Cleared old Claude provider settings that could override AnyRouters."
if [ -n "$CLAUDE_PROXY" ]; then
  echo "Keep the proxy app connected. In rule mode, api.anyrouters.com must use the proxy."
  echo "Claude-specific HTTP_PROXY and HTTPS_PROXY were saved in ~/.claude/settings.json."
fi
echo ""
if command -v claude >/dev/null 2>&1; then
  claude --version || true
else
  echo "Claude Code is installed, but the claude command is not on this terminal's PATH yet."
fi
echo "OK Done! Open a NEW terminal window and run:  claude"
