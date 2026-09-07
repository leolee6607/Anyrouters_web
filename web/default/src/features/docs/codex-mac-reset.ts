// Optional reset for the private-key Mac test package, not a CLI downgrade.
export const codexMacResetCommand = `/bin/bash <<'SH'
set -e
umask 077

mkdir -p "$HOME/.codex"
backup_dir=$(mktemp -d "$HOME/.codex/an-reset-backup.XXXXXX")
an_dir="$HOME/Library/Application Support/AnyRouters-Shared-Setup"

if [ -f "$HOME/.codex/auth.json" ]; then
  cp -p "$HOME/.codex/auth.json" "$backup_dir/auth.json"
fi

for file in \\
  "$HOME/.codex/config.toml" \\
  "$an_dir/active.json" \\
  "$an_dir/an-key"
do
  if [ -e "$file" ]; then
    mv "$file" "$backup_dir/"
  fi
done

unset OPENAI_API_KEY OPENAI_BASE_URL CODEX_API_KEY
unset CODEX_ACCESS_TOKEN CODEX_HOME

printf 'Backup: %s\\n' "$backup_dir"
codex logout
codex login
SH`
