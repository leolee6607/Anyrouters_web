import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

function installer(name: string) {
  return readFileSync(
    new URL(`../../../router/install_scripts/${name}`, import.meta.url),
    'utf8'
  )
}

test('Codex installers clear only known legacy routing and authentication overrides', () => {
  for (const name of ['codex.sh', 'codex-config.sh']) {
    const source = installer(name)
    for (const variable of [
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_API_BASE',
      'OPENAI_API_HOST',
      'OPENAI_ORG_ID',
      'OPENAI_ORGANIZATION',
      'OPENAI_PROJECT',
      'CODEX_API_KEY',
    ]) {
      expect(source).toContain(variable)
    }
    expect(source).not.toMatch(/unset\s+(HTTP_PROXY|HTTPS_PROXY|CODEX_HOME|AWS_)/)
    expect(source).not.toMatch(
      /SetEnvironmentVariable\("(HTTP_PROXY|HTTPS_PROXY|CODEX_HOME|AWS_)/
    )
    expect(source).toContain('launchctl setenv OPENAI_API_KEY "$KEY"')
    expect(source).not.toContain('launchctl unsetenv "$name"')
    expect(source).toContain('export OPENAI_API_KEY=')
    expect(source).toContain('anyrouters-api-key')
    expect(source).toContain('env_key = "OPENAI_API_KEY"')
    expect(source).not.toContain('model_providers.anyrouters.auth')
  }

  for (const name of ['codex.ps1', 'codex-config.ps1']) {
    const source = installer(name)
    for (const variable of [
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'OPENAI_API_BASE',
      'OPENAI_API_HOST',
      'OPENAI_ORG_ID',
      'OPENAI_ORGANIZATION',
      'OPENAI_PROJECT',
      'CODEX_API_KEY',
    ]) {
      expect(source).toContain(variable)
    }
    expect(source).toContain('env_key = "OPENAI_API_KEY"')
    expect(source).not.toContain('model_providers.anyrouters.auth')
    expect(source).toContain(
      '[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", $ApiKey, "User")'
    )
    expect(source).not.toMatch(
      /SetEnvironmentVariable\("(HTTP_PROXY|HTTPS_PROXY|CODEX_HOME|AWS_)/
    )
  }
})

test('Claude installers clear stale provider selection without deleting AWS credentials', () => {
  for (const name of ['claude.sh', 'claude.ps1']) {
    const source = installer(name)
    for (const variable of [
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'ANTHROPIC_CUSTOM_HEADERS',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_FABLE_MODEL',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ]) {
      expect(source).toContain(variable)
    }
    expect(source).toContain('apiKeyHelper')
    expect(source).not.toMatch(
      /unset\s+(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_PROFILE)/
    )
    expect(source).not.toMatch(
      /SetEnvironmentVariable\("(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_PROFILE)"/
    )
    expect(source).toContain('CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY')
  }

  const shellSource = installer('claude.sh')
  expect(shellSource).toContain(
    "settings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'"
  )
  expect(shellSource).toContain(
    'export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1'
  )
  expect(shellSource).toContain(
    'launchctl setenv CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY 1'
  )

  const powershellSource = installer('claude.ps1')
  expect(powershellSource).toContain(
    '$envBlock["CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"] = "1"'
  )
  expect(powershellSource).toContain(
    '[Environment]::SetEnvironmentVariable("CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY", "1", "User")'
  )
})

test('Windows Claude installer detects a working HTTP proxy without changing the system proxy', () => {
  const source = installer('claude.ps1')

  expect(source).toContain('Get-WindowsProxyCandidates')
  expect(source).toContain('Test-AnyRoutersApiRoute')
  expect(source).toContain('--noproxy')
  expect(source).toContain('--proxy')
  expect(source).toContain('ANYROUTERS_PROXY')
  expect(source).toContain('api.anyrouters.com must go through the proxy')
  expect(source).toContain('@("HTTP_PROXY", "HTTPS_PROXY")')
  expect(source).toContain('$envBlock[$proxyName] = $ClaudeProxy')
  expect(source).not.toMatch(
    /SetEnvironmentVariable\("(HTTP_PROXY|HTTPS_PROXY)",\s*\$ClaudeProxy,\s*"(User|Machine)"\)/
  )
  expect(source).not.toMatch(/127\.0\.0\.1:\d{2,5}/)
  expect(source).not.toMatch(/789[0-9]/)
})

test('macOS Claude installer reuses only a verified HTTP proxy without changing the system proxy', () => {
  const source = installer('claude.sh')

  expect(source).toContain('macos_system_proxy_candidates')
  expect(source).toContain('scutil --proxy')
  expect(source).toContain('ANYROUTERS_PROXY')
  expect(source).toContain('--noproxy "*"')
  expect(source).toContain('--noproxy "" --proxy')
  expect(source).toContain('export NO_PROXY=""')
  expect(source).toContain('ANYROUTERS_CLAUDE_PROXY')
  expect(source).toContain("settings.env.HTTP_PROXY = proxy")
  expect(source).toContain("settings.env.HTTPS_PROXY = proxy")
  expect(source).not.toContain('networksetup -set')
  expect(source).not.toMatch(/127\.0\.0\.1:\d{2,5}/)
  expect(source).not.toMatch(/789[0-9]/)
})

test('one-line installers keep their official install and fallback paths', () => {
  expect(installer('codex.sh')).toContain(
    'https://chatgpt.com/codex/install.sh'
  )
  expect(installer('codex.sh')).toContain('npm install -g @openai/codex')
  expect(installer('claude.sh')).toContain('https://claude.ai/install.sh')
  expect(installer('claude.sh')).toContain(
    'npm install -g --prefix "$NPM_PREFIX" @anthropic-ai/claude-code'
  )
})
