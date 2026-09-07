# Codex GPT-6 compatibility candidate

This is a test-only candidate, not a production rollout. It does not change
channel configuration, credentials, billing settings, cloud resources, or the
backend authorization contract.

## Setup behavior

- The website's Codex quick-start commands explicitly select `gpt-6-astra`.
  Standalone installer scripts retain `gpt-5.6-sol` as their no-argument default.
- GPT-6 setup requires the installed Codex native model catalog to contain
  GPT-6 as well as the existing GPT-5.6 models. Setup does not fabricate model
  capability entries or replace native tool metadata.
- The provider uses the Responses API over HTTP/SSE. WebSockets are explicitly
  disabled for this provider configuration.
- Existing MCP configuration and unrelated settings are preserved. An existing
  root reasoning setting of `none` or `minimal` stops GPT-6 configuration before
  the config file is replaced, with instructions to choose a supported level.
- The documentation distinguishes CLI and desktop upgrades, complete official
  installations, native context limits, and actual tool execution from simply
  completing setup. Relevant text is included in all six supported locales.

## Compact requests and billing boundaries

Codex continues to request the base model name. The gateway's compact route
uses an explicit internal `-openai-compact` alias for authorization, channel
selection, and pricing. A restricted API key needs both appropriate model
permissions; adding the base model alone does not enable compact requests.

The regression tests check those existing boundaries, preservation of the
entire opaque compaction output, and reported usage fields. A pricing fixture
checks that explicitly matching base/compact policies preserve ordinary and
custom customer discounts. Its numerical rates are test inputs, not a claim
about current official prices or authorization to change production prices.

A 403 or 503 must be investigated as a permission or capacity/configuration
issue, not worked around by removing all API-key restrictions. Live compact
enablement and an actual long-running Codex task require separate verification.

## Verification

Local validation before opening the draft PR:

- 46 installer, native catalog, documentation, and CI-coverage tests passed.
- The Windows-selected PowerShell test subset passed under local PowerShell 7;
  this does not substitute for a Windows result.
- The full Go test suite and shuffled targeted compact regression tests passed.
- Frontend type checking, scoped lint/format checks, production build, shell
  syntax checks, and `git diff --check` passed.

The PR workflow runs two real Windows jobs: Windows PowerShell 5.1
(`powershell.exe`) and PowerShell 7 (`pwsh.exe`). Missing runtimes fail the job
instead of silently skipping it. Coverage includes GPT-6 native catalog
requirements, unsupported reasoning rejection, a home path containing spaces,
and switching back to GPT-5.6 while retaining unrelated configuration.

These installer tests use fake binaries, catalogs, and credentials. They do not
make paid model calls and do not prove real Codex tool execution or compaction.
Mac mini testing should use the exact PR commit in an isolated directory;
results must distinguish observed behavior from cases not yet exercised.

### Windows test safety

The PowerShell installers also manage Windows user-scope environment settings.
An isolated home directory alone does not isolate that registry state. Run the
installer fixture suite only on a disposable Windows CI runner or disposable
test VM, not on a personal Windows workstation. The workflow sets
`ANYROUTERS_DISPOSABLE_WINDOWS_TEST_HOST=1` for that purpose; setting this flag
is an assertion that the host is disposable, not an additional sandbox.

### Reproduction

From `web/default`, with Bun and PowerShell available:

```sh
PWSH_BIN=/absolute/path/to/pwsh REQUIRE_POWERSHELL_TESTS=1 bun test \
  tests/codex-gpt56-catalog-compat.test.ts \
  tests/docs-codex-install-guidance.test.ts \
  tests/codex-ci-coverage.test.ts
```

The command above is for macOS/Linux. For Windows, use the checked-in CI jobs
on a disposable runner. From the repository root:

```sh
go test ./...
go test ./middleware ./relay/helper ./relay/channel/openai -count=1 -shuffle=on
```

Do not merge or deploy this candidate solely on the basis of installer tests.
Review native client behavior, actual API permissions, usage, and separately
approved compact pricing/configuration before production rollout.
