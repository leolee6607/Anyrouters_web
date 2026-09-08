# Windows Codex setup repair — 2026-09-07

Status: user-tested v2, website release approved; publication checks in progress.

## v3: optional CLI installation/update

User requested prompting rather than forcing an installation/update. Both Windows entry points now ask only when no compatible CLI is available. Only explicit Y/Yes consents; N, empty or other responses stop before installation/config writes. Non-interactive prompt failures stop safely. Compatible CLI installations do not prompt. Desktop application installation remains manual. Windows tutorial translations reflect this distinction; macOS behavior is unchanged.

The CI discovery failures were fixture bugs: tmpdir used Windows 8.3 RUNNER~1 paths while Get-ChildItem returned runneradmin paths for the same files. The fake compatibility checker compared strings and rejected the correct fixture. Identify the compatible fixture by content instead; production discovery is unchanged by this correction. Logs: GitHub Actions run 34095920176. User acceptance of v2 does not claim acceptance of the new v3 prompt yet.

## User test result and publication request

On 2026-09-07 the user tested the v2 package and reported it usable, then requested a website update. The user also confirmed one-click return to official configuration using the existing website script, and approved publication after the release scope and CI/gray-rollout plan were presented. This is user-reported practical acceptance, not a recorded exhaustive tool/compact test. No production changes have been made yet for this branch.

## v2 follow-up

The user confirmed that the desktop now launches and exposes GPT-6 after updating CLI, and requested the shared-configuration flow without the desktop bundle scan. Removed the Assert-CodexDesktopRuntime call from the configuration writer (diagnostic helper remains unused by installation). A regression with a desktop scan that deliberately throws was red before this removal. CLI model checks, backup, generated-config validation and post-setup real desktop acceptance remain required. The macOS source is unchanged; it still has its own limited desktop runtime checks, so this is alignment of the main flow, not identical platform logic.

## Evidence

The reported desktop configuration command selected standalone CLI 0.149.0-alpha.4, which returned no gpt-6-astra entry. The previous desktop writer threw immediately without attempting an upgrade. PATH separately resolved npm shims. The installed Appx identity was OpenAI.Codex; the previous Appx lookup only matched ChatGPT. A separate desktop error reported an unavailable CLI binary; its actual filesystem cause remains unverified.

## Local changes

- Separate standalone CLI discovery from desktop runtime validation. Inspect all discovered candidates, keeping a compatible CLI without reinstalling it.
- Install/update an incompatible CLI once through its official installation channel, re-resolve and re-check before writing configuration.
- Reject unusable candidates without aborting discovery; bound CLI probes to 30 seconds.
- Run the installer as a child process with key/token/secret environment variables removed. Do not echo captured installer output.
- Recognize OpenAI.Codex Appx and require a compatible bundled runtime for detected desktop installations. Do not manufacture model metadata or set CODEX_CLI_PATH to bypass a broken app installation.
- Preserve existing config when upgrade or capability checks fail. No macOS, billing, provider channel, or production configuration changes.

## Validation

The executable PowerShell fixture for missing GPT-6 failed before the fix and passed afterwards. An additional broken-executable regression also failed before the fix and passed afterwards.

PowerShell 7.6.5 on macOS, isolated executable fixtures (not real Windows desktop):

```sh
PWSH_BIN=/private/tmp/an-pwsh-validation.rCGEpV/pwsh bun test tests/codex-windows-discovery.test.ts tests/codex-gpt56-catalog-compat.test.ts tests/codex-ci-coverage.test.ts tests/docs-codex-install-guidance.test.ts tests/install-script-conflict-cleanup.test.ts
```

Result: 66 pass, 0 fail, 749 assertions. Frontend typecheck and git diff --check pass.

Windows CI workflow includes the new regression file in both Windows PowerShell 5.1 and PowerShell 7 jobs, but has not been dispatched for this local branch.

## Remaining acceptance gates

1. Inspect the affected machine's read-only Appx/runtime inventory. Verify actual desktop bundle layout and distinguish missing files from access/discovery errors.
2. Run Windows 5.1/7 CI and test npm and standalone upgrade paths on Windows. Confirm the command used by the user's terminal is the intended installation after upgrade.
3. Repair/update the official desktop application if its runtime is missing; do not reset application data as a first step. Confirm actual launch before claiming desktop compatibility.
4. With a new limited test key, check GPT-6 model selection, reply, tool execution, and usage logging. First-request WebSocket fallback and missing node_repl path remain separate unresolved symptoms, not normal successful acceptance.
5. Only then publish the Windows update. This change is not evidence that the desktop crash, MCP tools, or network fallback have been fixed.
