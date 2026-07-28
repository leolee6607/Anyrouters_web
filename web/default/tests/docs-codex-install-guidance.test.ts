import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/features/docs/index.tsx', import.meta.url),
  'utf8'
)
const historyScript = readFileSync(
  new URL('../../../router/install_scripts/codex-history.ps1', import.meta.url),
  'utf8'
)

test('Codex guides detect compatible installations before upgrading', () => {
  expect(source).toContain('第三步：快速接入')
  expect(source).toContain('当前版本更新于：2026年7月24日')
  expect(source).toContain('支持 ChatGPT 5.6 全系列')
  expect(source).toContain('已有兼容 Codex 自动跳过安装，能力不足时才升级')
  expect(source).toContain(
    '使用 Codex 原生模型目录，并保留子代理、工具和推理强度'
  )
  expect(source).toContain('提供经过校验的一键切回 OpenAI 官方配置')
  const notice = source.slice(
    source.indexOf('function CodexUpdateNotice()'),
    source.indexOf('function ApiTakeoverNotice')
  )
  expect(notice).toContain('子代理、工具和推理强度')
  expect(source).not.toContain('解决部分计价')
  expect(source).toContain('点击命令框下方「复制」')
  expect(source).toContain('已有兼容版本会自动跳过安装')
  expect(source).toContain('已经安装 Codex 的用户无需卸载或重装')
  expect(source).toContain("<strong className='font-semibold'>")
})

test('one-line setup explains its scope below the command', () => {
  expect(source).toContain('运行前请注意')
  expect(source).toContain('这条命令会先检测现有 Codex')
  expect(source).toContain('未安装或能力不足时才安装或升级')
  expect(source).toContain('这条命令只更新')
  expect(source).toMatch(
    /不会删除聊天记录，也不会修改(?: Windows 全局|系统)代理、AWS\s+凭据或其他工具配置/
  )
  expect(source).toMatch(/不会写入自定义模型目录，也不会关闭\s+Codex 原生子代理/)
  expect(source).toContain('检测只看 Codex 原生能力，不依赖当前版本号或服务商名称')
  expect(source).toContain('会影响 Codex 的通用 OpenAI API 路由覆盖')
  expect(source).toContain('不会创建、替换或停用网站 Key')
  expect(source).toContain('不会修改系统代理、AWS 凭据或 CODEX_HOME')
  expect(source).toContain('写入位置和分步验证见下方「开发者」')
  expect(source).toContain(
    '<CodeBlock code={command} />\n              <ApiTakeoverNotice tool={tool} />'
  )
  expect(source).not.toContain('清理会导致调用串线的同类旧环境变量/旧配置')
  expect(source).not.toContain('基础连接已经关闭')
})

test('success previews keep only the next action', () => {
  const successOutput = source.slice(
    source.indexOf('function successOutput'),
    source.indexOf('function UserFlow')
  )
  expect(successOutput).toContain('Open a NEW terminal window and run:  codex')
  expect(successOutput).toContain('Fully quit Codex desktop')
  expect(successOutput).toContain('run:  claude')
  expect(successOutput).not.toContain('Installing Codex CLI')
  expect(successOutput).not.toContain('Reading the current complete Codex model catalog')
  expect(successOutput).not.toContain('Backed up old Codex files')
  expect(successOutput).not.toContain('collaboration/subagents')
})

test('Claude Code guide explains how to recover from a local context limit', () => {
  const faq = source.slice(
    source.indexOf('function ClaudeContextLimitFaq'),
    source.indexOf('function CodexSetupCommands')
  )

  expect(faq).toContain('Context limit reached')
  expect(faq).toContain('/compact')
  expect(faq).toContain('/clear')
  expect(faq).toMatch(/不要使用\s+--continue 或 --resume/)
  expect(faq).toContain('第三方 skill')
  expect(faq).toContain('通常不是 AnyRouters Key、余额或模型故障')
  expect(faq).toContain('不会自动删除 ~/.claude、skills 或聊天记录')
  expect(source).toMatch(
    /\{tool === 'claude' && \(\s*<>\s*<ClaudeWindowsProxyFaq \/>\s*<ClaudeContextLimitFaq \/>/
  )
})

test('developer guides explain where commands run and where configuration is written', () => {
  expect(source).toContain('这些命令在哪里运行？')
  expect(source).toContain('每个命令框都要点击“复制”')
  expect(source).toContain('不要粘贴到浏览器地址栏、工具聊天输入框或文件编辑器')
  expect(source).toContain('写入 AnyRouters 配置')
  expect(source).toContain('auth.json')
  expect(source).toContain('~/.codex/config.toml')
  expect(source).not.toContain('~/.codex/anyrouters-api-key')
  expect(source).toContain('当前 shell 启动文件中的 OPENAI_API_KEY')
  expect(source).toContain('macOS launchctl 中的 OPENAI_API_KEY')
  expect(source).not.toContain('~/.codex/model-catalog-anyrouters-gpt56.json')
  expect(source).toContain("tool: 'codex-config'")
  expect(source).toContain('~/.codex/anyrouters-native-backup-时间戳')
  expect(source).toContain('model_catalog_json')
  expect(source).toContain('OPENAI_API_KEY')
  expect(source).toContain('OPENAI_BASE_URL')
  expect(source).toContain('CODEX_API_KEY')
  expect(source).toContain('Windows 用户环境')
  expect(source).toContain('Windows 用户环境变量 OPENAI_API_KEY')
  expect(source).toMatch(/OPENAI_API_KEY[\s\S]*设置为你刚粘贴的现有 AnyRouters Key/)
  expect(source).toContain('macOS launchctl')
  expect(source).toContain('如果其他工具仍依赖这些变量，请为它们单独配置')
  expect(source).toMatch(/Codex 升级通常会保留这份配置/)
  expect(source).toContain('codex --version')
  expect(source).toContain('只能证明已经安装，不能证明模型、工具和子代理能力兼容')
  expect(source).toContain('在终端输入区键入')
})

test('Codex guides provide a validated, non-destructive return to official login', () => {
  const restore = source.slice(
    source.indexOf('function CodexOfficialRestoreGuide'),
    source.indexOf('function ClaudeContextLimitFaq')
  )
  expect(source).toContain('https://anyrouters.com/install/codex-official')
  expect(restore).toContain('切回 OpenAI 官方订阅')
  expect(restore).toContain('不需要卸载或重装 Codex')
  expect(restore).toContain('其他第三方服务商定义会保留但不再启用')
  expect(restore).toContain('无论当前使用哪家服务商都可以恢复')
  expect(restore).toContain('auth.json')
  expect(restore).toContain('校验失败不会覆盖现有文件')
  expect(restore).toContain('codex login status')
  expect(restore).toContain('脚本不会主动退出你原来的官方账号')
  expect(source).toContain(
    "{tool !== 'claude' && <CodexOfficialRestoreGuide />}"
  )
})

test('Codex history migration is optional, local, reversible, and transport-neutral', () => {
  const guide = source.slice(
    source.indexOf('function CodexHistoryGuide'),
    source.indexOf('function ClaudeContextLimitFaq')
  )

  expect(source).toContain('Codex-聊天迁移')
  expect(source).toContain('https://anyrouters.com/install/codex-history.ps1')
  expect(guide).toContain('Windows 本地一次性迁移')
  expect(guide).toContain('不是把 OpenAI 云端聊天上传到 AnyRouters')
  expect(guide).toMatch(
    /不修改消息正文、标题、登录账号、API Key\s+或更新时间/
  )
  expect(guide).toContain('不会随每次一键接入自动执行')
  expect(guide).toContain('不要开启 watch')
  expect(guide).toContain('Node.js 22.5+')
  expect(guide).toContain('backups_state/provider-sync')
  expect(guide).toContain('encrypted_content')
  expect(guide).toContain('invalid_encrypted_content')
  expect(guide).toContain('正在重新连接 1/5…5/5')
  expect(guide).toContain('不会造成该重连')

  expect(historyScript).toContain(
    '$AllowedProviders = @("anyrouters", "openai", "openai_http")'
  )
  expect(historyScript).toContain(
    '$SessionProvider = if ($Provider -eq "openai_http") { "openai" }'
  )
  expect(historyScript).toContain('codex-provider-sync-lite-v0.3.1.zip')
  expect(historyScript).toContain('6b6682b93772f81bf7e308a8a486a3748530fca62be6dca1ec38d65ac51dc36e')
  expect(historyScript).toContain("import('node:sqlite')")
  expect(historyScript).toContain('sync --provider $SessionProvider --keep 5')
  expect(historyScript).toContain('Read-Host')
  expect(historyScript).not.toContain('Stop-Process')
  expect(historyScript).not.toContain('npm install')
})

test('every secondary guide states the UI location, final action, and success check', () => {
  const ccSwitch = source.slice(
    source.indexOf('function CcSwitchGuide'),
    source.indexOf('function CherryStudioGuide')
  )
  expect(ccSwitch).toContain('顶部选择 <strong>Claude Code</strong>')
  expect(ccSwitch).toContain('右上角')
  expect(ccSwitch).toMatch(/把整段 JSON 粘贴到 cc-switch 的 JSON\s+编辑框/)
  expect(ccSwitch).toContain('保存并启用 AnyRouters')
  expect(ccSwitch).toContain('收到回复就表示切换成功')
  expect(ccSwitch).toContain('遇到旧配置冲突？')
  expect(ccSwitch).toContain('旧服务商配置或系统环境变量')
  expect(ccSwitch).toMatch(/旧\s+API 地址/)
  expect(ccSwitch).toContain('不要删除当前')
  expect(ccSwitch).toContain('/model')
  expect(ccSwitch).toContain('不能关闭旧服务商配置或清除环境变量覆盖')
  expect(ccSwitch).not.toContain('<DeveloperFlow')

  const cherry = source.slice(
    source.indexOf('function CherryStudioGuide'),
    source.indexOf('function codexImageInstallCommand')
  )
  expect(cherry).toContain('「设置」→「模型服务」')
  expect(cherry).toContain('下面不是一条命令')
  expect(cherry).toContain("value: ANTHROPIC_BASE")
  expect(cherry).toContain('「检查」')
  expect(cherry).toContain('收到回复就表示配置完成')
  expect(cherry).not.toContain('from openai import OpenAI')
  const addProvider = cherry.indexOf('然后点击「添加」')
  const addModel = cherry.indexOf('添加模型')
  const checkConnection = cherry.indexOf('输入框右侧的「检查」')
  expect(addProvider).toBeGreaterThan(-1)
  expect(addModel).toBeGreaterThan(addProvider)
  expect(checkConnection).toBeGreaterThan(addModel)

  const image = source.slice(
    source.indexOf('function CodexImageGuide'),
    source.indexOf('type GuideEntry')
  )
  expect(image).toContain('~/Downloads/anyrouters-image.zip')
  expect(image).toContain('~/.codex/skills/anyrouters-image')
  expect(image).toContain('等 Codex 明确回复“安装完成”')
  expect(image).toContain('Command-Q 完全退出 Codex')
  expect(image).toContain('桌面「AnyRouters图片」文件夹并自动打开')
})

test('Cline guide keeps the provider, endpoint, key, and model on AnyRouters', () => {
  const cline = source.slice(
    source.indexOf('function ClineGuide'),
    source.indexOf('function codexImageInstallCommand')
  )

  expect(source).toContain("id: 'cline'")
  expect(source).toContain("label: 'Cline-VS Code'")
  expect(cline).toContain('OpenAI Compatible')
  expect(cline).toContain('OPENAI_COMPATIBLE_BASE')
  expect(cline).toContain("toolName='Cline'")
  expect(cline).toContain('CLAUDE_DEFAULT_MODEL')
  expect(cline).toContain('不要添加')
  expect(cline).toContain('openai/')
  expect(cline).toContain('anyrouter.dev')
  expect(cline).toContain('Missing Authorization header')
  expect(cline).toContain("to='/marketplace'")
  expect(cline).toContain('收到回复就表示配置完成')
})
