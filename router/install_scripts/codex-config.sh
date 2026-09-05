#!/bin/bash
# AnyRouters one-line config writer - Codex desktop/app. Safe to run more than once.
set -eu

KEY="${1:-${ANYROUTERS_KEY:-}}"
MODEL="${ANYROUTERS_MODEL:-gpt-5.6-sol}"
CODEX_DIR="$HOME/.codex"
CONFIG="$CODEX_DIR/config.toml"
LEGACY_CATALOG="$CODEX_DIR/model-catalog-anyrouters-gpt56.json"
work_dir=""
lock_dir=""
CONFLICTING_CODEX_ENV_NAMES="
OPENAI_API_KEY
OPENAI_BASE_URL
OPENAI_API_BASE
OPENAI_API_HOST
OPENAI_ORG_ID
OPENAI_ORGANIZATION
OPENAI_PROJECT
CODEX_API_KEY
"
LEGACY_CODEX_ENV_NAMES="
OPENAI_BASE_URL
OPENAI_API_BASE
OPENAI_API_HOST
OPENAI_ORG_ID
OPENAI_ORGANIZATION
OPENAI_PROJECT
CODEX_API_KEY
"

fail() {
  printf 'X %s\n' "$1" >&2
  exit 1
}

cleanup() {
  unset KEY ORIGINAL_KEY 2>/dev/null || true
  if [ -n "${work_dir:-}" ] && [ -d "$work_dir" ]; then
    rm -rf "$work_dir"
  fi
  if [ -n "${lock_dir:-}" ] && [ -d "$lock_dir" ]; then
    rmdir "$lock_dir" 2>/dev/null || true
  fi
}
trap cleanup EXIT HUP INT TERM

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
    fail "Replace the placeholder with your real AnyRouters API key."
    ;;
esac

status="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" https://api.anyrouters.com/v1/models || true)"
if [ "$status" != "200" ]; then
  fail "API key validation failed (HTTP $status). Copy the complete key from AnyRouters API Keys."
fi

for name in $CONFLICTING_CODEX_ENV_NAMES; do
  unset "$name"
done
export OPENAI_API_KEY="$KEY"

resolve_codex_binary() {
  if [ -n "${ANYROUTERS_CODEX_BIN:-}" ] && [ -x "$ANYROUTERS_CODEX_BIN" ]; then
    printf '%s\n' "$ANYROUTERS_CODEX_BIN"
    return 0
  fi
  for candidate in \
    "/Applications/ChatGPT.app/Contents/Resources/codex" \
    "$HOME/Applications/ChatGPT.app/Contents/Resources/codex"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return 0
  fi
  return 1
}

CODEX_BIN="$(resolve_codex_binary || true)"
[ -n "$CODEX_BIN" ] || fail "Could not find Codex. Install or upgrade the desktop app (or Codex CLI), then re-run this command."
command -v python3 >/dev/null 2>&1 || fail "Python 3 is required to migrate the Codex configuration safely."

cleanup_codex_profile() {
  profile="$1"
  python3 - "$profile" "$KEY" $CONFLICTING_CODEX_ENV_NAMES <<'PY'
import os
import re
import shlex
import shutil
import stat
import sys
import tempfile

profile = os.path.abspath(os.path.expanduser(sys.argv[1]))
key = sys.argv[2]
names = tuple(sys.argv[3:])
begin = "# anyrouters-codex-managed-begin"
end = "# anyrouters-codex-managed-end"

try:
    with open(profile, encoding="utf-8") as handle:
        original = handle.read()
except FileNotFoundError:
    original = ""

has_managed_block = begin in original and end in original
assignment = re.compile(
    r"^\s*(?:export\s+)?(?:" + "|".join(map(re.escape, names)) + r")\s*="
)
kept = []
inside_managed_block = False
for line in original.splitlines(keepends=True):
    logical = line.rstrip("\r\n")
    if has_managed_block and logical == begin:
        inside_managed_block = True
        continue
    if has_managed_block and inside_managed_block and logical == end:
        inside_managed_block = False
        continue
    if inside_managed_block or assignment.match(logical):
        continue
    kept.append(line)

prefix = "".join(kept).rstrip("\r\n")
managed = "\n".join(
    [
        begin,
        f"export OPENAI_API_KEY={shlex.quote(key)}",
        *(f"unset {name}" for name in names if name != "OPENAI_API_KEY"),
        end,
    ]
)
updated = (prefix + "\n\n" if prefix else "") + managed + "\n"
if updated == original:
    raise SystemExit(0)

parent = os.path.dirname(profile)
os.makedirs(parent, exist_ok=True)
if os.path.exists(profile):
    shutil.copy2(profile, profile + ".anyrouters.bak")
    mode = stat.S_IMODE(os.stat(profile).st_mode)
else:
    mode = 0o600
fd, staged = tempfile.mkstemp(prefix=os.path.basename(profile) + ".anyrouters.", dir=parent)
try:
    os.fchmod(fd, mode)
    with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
        handle.write(updated)
    os.replace(staged, profile)
except BaseException:
    try:
        os.unlink(staged)
    except FileNotFoundError:
        pass
    raise
PY
}

persist_codex_env() {
  case "${SHELL:-}" in
    */zsh)
      cleanup_codex_profile "${ZDOTDIR:-$HOME}/.zshrc"
      if [ -f "${ZDOTDIR:-$HOME}/.zprofile" ]; then
        cleanup_codex_profile "${ZDOTDIR:-$HOME}/.zprofile"
      fi
      ;;
    */bash)
      cleanup_codex_profile "$HOME/.bashrc"
      if [ -f "$HOME/.bash_profile" ]; then
        cleanup_codex_profile "$HOME/.bash_profile"
      elif [ -f "$HOME/.bash_login" ]; then
        cleanup_codex_profile "$HOME/.bash_login"
      else
        cleanup_codex_profile "$HOME/.profile"
      fi
      ;;
    *)
      cleanup_codex_profile "$HOME/.profile"
      ;;
  esac
  if command -v launchctl >/dev/null 2>&1; then
    for legacy_name in $LEGACY_CODEX_ENV_NAMES; do
      launchctl unsetenv "$legacy_name" 2>/dev/null || true
    done
    launchctl setenv OPENAI_API_KEY "$KEY"
  fi
  echo "Configured the existing AnyRouters key and cleared known legacy Codex/OpenAI relay overrides."
}

mkdir -p "$CODEX_DIR"
chmod 700 "$CODEX_DIR" 2>/dev/null || true
lock_dir="$CODEX_DIR/.anyrouters-native.lock"
mkdir "$lock_dir" 2>/dev/null || fail "Another AnyRouters Codex configuration is running; wait for it to finish and retry."
work_dir="$(mktemp -d "$CODEX_DIR/.anyrouters-native.XXXXXX")"
mkdir -p "$work_dir/native-home" "$work_dir/validate-home"

if [ -f "$CONFIG" ] && ! CODEX_HOME="$CODEX_DIR" CODEX_NON_INTERACTIVE=1 "$CODEX_BIN" debug models >/dev/null; then
  fail "Existing config.toml is invalid; existing configuration was not changed."
fi

echo "Checking Codex native model capabilities ..."
if ! CODEX_HOME="$work_dir/native-home" CODEX_NON_INTERACTIVE=1 "$CODEX_BIN" debug models > "$work_dir/models.json"; then
  fail "Codex could not export its native model catalog; existing configuration was not changed."
fi

python3 - \
  "$work_dir/models.json" \
  "$CONFIG" \
  "$work_dir/config.toml" \
  "$MODEL" <<'PY'
import json
import os
import re
import sys

models_path, current_path, staged_path, model = sys.argv[1:]

with open(models_path, encoding="utf-8") as handle:
    payload = json.load(handle)
models = payload.get("models") if isinstance(payload, dict) else payload
if not isinstance(models, list):
    raise SystemExit("X Codex returned an invalid native model catalog; existing configuration was not changed.")

required = ("gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna")
if model == "gpt-6-astra":
    required += (model,)
for slug in required:
    entry = next(
        (item for item in models if isinstance(item, dict) and item.get("slug") == slug),
        None,
    )
    if entry is None:
        raise SystemExit(f"X Codex native model catalog is missing {slug}; existing configuration was not changed.")
    if not entry.get("multi_agent_version") or not entry.get("tool_mode"):
        raise SystemExit(
            f"X {slug} native collaboration/tool metadata is unavailable; existing configuration was not changed."
        )

current = ""
if os.path.isfile(current_path):
    with open(current_path, encoding="utf-8") as handle:
        current = handle.read()

# Replace only the selected model/provider and retire the legacy catalog override.
# Reasoning effort, MCP, plugins, features, projects, trust, and login state stay intact.
managed_root_keys = {"model", "model_provider", "model_catalog_json"}
kept = []
at_root = True
skip_provider = False
header_pattern = re.compile(r"^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$")

for line in current.splitlines(keepends=True):
    stripped = line.strip()
    header = header_pattern.match(stripped)
    if header:
        section = header.group(1).strip()
        skip_provider = section == "model_providers.anyrouters" or section.startswith(
            "model_providers.anyrouters."
        )
        at_root = False
        if skip_provider:
            continue
    elif skip_provider:
        continue

    if at_root:
        if model == "gpt-6-astra" and re.match(r"""^model_reasoning_effort\s*=\s*["'](?:none|minimal)["']""", stripped):
            raise SystemExit("X gpt-6-astra does not support this model_reasoning_effort. Choose low, medium, high, xhigh or max, then re-run; existing configuration was not changed.")
        assignment = re.match(r"^([A-Za-z0-9_-]+)\s*=", stripped)
        if assignment and assignment.group(1) in managed_root_keys:
            continue
    kept.append(line)

parts = [f"model = {json.dumps(model)}\nmodel_provider = \"anyrouters\""]
preserved = "".join(kept).strip()
if preserved:
    parts.append(preserved)
parts.append(
    "\n".join(
        [
            "[model_providers.anyrouters]",
            'name = "AnyRouters"',
            'base_url = "https://api.anyrouters.com/v1"',
            'wire_api = "responses"',
            'supports_websockets = false',
            'env_key = "OPENAI_API_KEY"',
        ]
    )
)

with open(staged_path, "w", encoding="utf-8") as handle:
    handle.write("\n\n".join(parts) + "\n")
PY

cp "$work_dir/config.toml" "$work_dir/validate-home/config.toml"
if ! CODEX_HOME="$work_dir/validate-home" CODEX_NON_INTERACTIVE=1 "$CODEX_BIN" debug models >/dev/null; then
  fail "Generated config.toml is invalid; existing configuration was not changed."
fi

umask 077
chmod 600 "$work_dir/config.toml"

if [ -f "$CONFIG" ] && cmp -s "$work_dir/config.toml" "$CONFIG"; then
  chmod 600 "$CONFIG"
  persist_codex_env
  unset KEY ORIGINAL_KEY
  echo ""
  echo "OK AnyRouters native Codex configuration is already up to date."
  echo "Native model catalog, collaboration, tools, plugins, MCP, trust, login, and reasoning effort were preserved."
  echo "Command-Q to fully quit Codex desktop, reopen it, and start a NEW task."
  exit 0
fi

stamp="$(date +%Y%m%d-%H%M%S)-$$"
backup_dir="$CODEX_DIR/anyrouters-native-backup-$stamp"
mkdir -p "$backup_dir"
for file in config.toml auth.json anyrouters-api-key model-catalog-anyrouters-gpt56.json; do
  if [ -f "$CODEX_DIR/$file" ]; then
    cp -p "$CODEX_DIR/$file" "$backup_dir/$file"
  fi
done

if ! mv "$work_dir/config.toml" "$CONFIG"; then
  fail "Could not activate config.toml; the previous configuration was preserved."
fi
chmod 600 "$CONFIG"
persist_codex_env
unset KEY ORIGINAL_KEY

echo ""
echo "OK Native Codex configuration completed."
echo "Backup: $backup_dir"
if [ -f "$LEGACY_CATALOG" ]; then
  echo "The legacy custom catalog was kept as an unused rollback file."
fi
echo "Native model catalog, collaboration, tools, plugins, MCP, trust, login, and reasoning effort were preserved."
echo "Command-Q to fully quit Codex desktop, reopen it, and start a NEW task."
echo "Configuration is ready; verify the active provider, a real tool call, and site usage before relying on it."
echo "If Code Mode is unavailable, update or repair the complete official Codex desktop installation."
