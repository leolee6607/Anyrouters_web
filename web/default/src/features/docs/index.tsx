/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { createContext, useContext, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  AppWindow,
  Check,
  Copy,
  ExternalLink,
  History,
  MessageSquareCode,
  MonitorSmartphone,
  SquareTerminal,
  TriangleAlert,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { getStatus, getUserGroups } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createApiKey, fetchTokenKey, searchApiKeys } from '../keys/api'
import type { ApiResponse, CreatedApiKey } from '../keys/types'

const ANTHROPIC_BASE = 'https://api.anyrouters.com'
const CODEX_OFFICIAL_URL =
  'https://developers.openai.com/codex/quickstart?setup=app'
const CODEX_CLI_OFFICIAL_URL =
  'https://developers.openai.com/codex/quickstart?setup=cli'
const CLAUDE_OFFICIAL_URL = 'https://code.claude.com/docs/en/setup'
const CC_SWITCH_OFFICIAL_URL =
  'https://github.com/farion1231/cc-switch/releases/latest'
const CHERRY_STUDIO_OFFICIAL_URL =
  'https://github.com/CherryHQ/cherry-studio/releases/latest'
const CODEX_PROVIDER_SYNC_URL =
  'https://github.com/Dailin521/codex-provider-sync/tree/v0.3.1'
const KEY = 'YOUR_ANYROUTERS_API_KEY'
const CODEX_DEFAULT_MODEL = 'gpt-5.6-sol'
const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-6'
const ANYROUTERS_IMAGE_SKILL_URL = '/install/anyrouters-image.zip'

type GuideProps = {
  apiKey: string
  onApiKeyChange: (v: string) => void
}

type OS = 'mac' | 'windows' | 'linux'

const OS_LABELS: Record<OS, string> = {
  mac: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
}

const KeyContext = createContext('')
const useApiKey = () => useContext(KeyContext)

const OsChoiceContext = createContext<{
  os: OS
  setOs: (o: OS) => void
  withLinux: boolean
} | null>(null)

function withKey(code: string, key: string): string {
  const trimmed = key.trim()
  return trimmed ? code.split(KEY).join(trimmed) : code
}

function normalizeApiKey(key: string) {
  const trimmed = key.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('sk-') ? trimmed : `sk-${trimmed}`
}

function apiKeyName(toolName: string) {
  return `${toolName} 请勿轻易删除`.slice(0, 50)
}

async function fetchFullApiKey(tokenId: number, message: string) {
  const full = await fetchTokenKey(tokenId)
  const key = normalizeApiKey(full.data?.key || '')
  if (!full.success || !key) {
    throw new Error(full.message || message)
  }
  return key
}

async function fetchExistingKeyByTool(toolName: string) {
  const generatedName = apiKeyName(toolName)
  const candidates = [generatedName, toolName]
  for (const keyword of candidates) {
    const found = await searchApiKeys({ keyword, p: 1, size: 20 })
    if (!found.success) {
      throw new Error(found.message || 'API Key 查询失败')
    }

    const token = found.data?.items?.find(
      (item) =>
        item.status === 1 &&
        (item.name === generatedName || item.name === toolName)
    )
    if (token) {
      return fetchFullApiKey(token.id, '已找到 API Key，但读取完整 key 失败')
    }
  }

  return ''
}

async function readCreatedApiKey(created: ApiResponse<CreatedApiKey>) {
  const key = normalizeApiKey(created.data?.key || '')
  if (key) return key

  if (created.data?.id) {
    return fetchFullApiKey(
      created.data.id,
      'API Key 已创建，但读取完整 key 失败'
    )
  }

  return ''
}

async function getDefaultApiKeyGroup() {
  try {
    const [status, groups] = await Promise.all([getStatus(), getUserGroups()])
    const groupMap = groups.success ? (groups.data ?? {}) : {}
    if (status?.default_use_auto_group === true && groupMap.auto) {
      return { group: 'auto', crossGroupRetry: true }
    }
    if (groupMap.default) {
      return { group: 'default', crossGroupRetry: false }
    }
  } catch {
    // Keep the tutorial usable even if optional status/group lookups fail.
  }

  return { group: 'default', crossGroupRetry: false }
}

async function getOrCreateApiKey(toolName: string) {
  const existing = await fetchExistingKeyByTool(toolName)
  if (existing) return { key: existing, reused: true }

  const name = apiKeyName(toolName)
  const { group, crossGroupRetry } = await getDefaultApiKeyGroup()
  const created = await createApiKey({
    name,
    remain_quota: 0,
    expired_time: -1,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    group,
    cross_group_retry: crossGroupRetry,
  })
  if (!created.success) {
    throw new Error(created.message || 'API Key 创建失败')
  }

  const createdKey = await readCreatedApiKey(created)
  if (createdKey) return { key: createdKey, reused: false }

  const key = await fetchExistingKeyByTool(toolName)
  if (!key) {
    throw new Error('API Key 已创建，但创建接口未返回完整 key，且回读失败')
  }
  return { key, reused: false }
}

function OsProvider({
  withLinux = false,
  children,
}: {
  withLinux?: boolean
  children: ReactNode
}) {
  const [os, setOs] = useState<OS>(() => {
    if (typeof navigator === 'undefined') return 'mac'
    const platform =
      `${navigator.userAgent} ${navigator.platform}`.toLowerCase()
    if (platform.includes('win')) return 'windows'
    if (withLinux && platform.includes('linux')) return 'linux'
    return 'mac'
  })

  return (
    <OsChoiceContext.Provider value={{ os, setOs, withLinux }}>
      {children}
    </OsChoiceContext.Provider>
  )
}

function useOsChoice() {
  return (
    useContext(OsChoiceContext) ?? {
      os: 'mac' as OS,
      setOs: () => {},
      withLinux: false,
    }
  )
}

function OsToggle() {
  const { os, setOs, withLinux } = useOsChoice()
  const items: OS[] = withLinux
    ? ['mac', 'windows', 'linux']
    : ['mac', 'windows']

  return (
    <div className='flex flex-wrap gap-2'>
      {items.map((item) => (
        <button
          key={item}
          type='button'
          onClick={() => setOs(item)}
          className={cn(
            'rounded-md border px-4 py-2 text-sm font-medium transition-colors',
            os === item
              ? 'border-neutral-300 bg-neutral-200 text-neutral-950 shadow-sm hover:bg-neutral-200 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-50'
              : 'border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          {OS_LABELS[item]}
        </button>
      ))}
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className='text-lg font-semibold tracking-tight'>{children}</h2>
}

function StepTitle({ children }: { children: ReactNode }) {
  return <h3 className='text-sm font-semibold tracking-tight'>{children}</h3>
}

function CodexUpdateNotice() {
  return (
    <div className='rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100'>
      <p className='font-semibold'>当前版本更新于：2026年7月24日</p>
      <ol className='mt-1 list-decimal pl-5'>
        <li>支持 ChatGPT 5.6 全系列</li>
        <li>已有兼容 Codex 自动跳过安装，能力不足时才升级</li>
        <li>使用 Codex 原生模型目录，并保留子代理、工具和推理强度</li>
        <li>提供经过校验的一键切回 OpenAI 官方配置</li>
      </ol>
    </div>
  )
}

function ClaudeWindowsProxyNotice() {
  return (
    <div className='rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100'>
      <p className='font-semibold'>Windows 运行前：请先连接代理软件</p>
      <ul className='mt-1 list-disc space-y-1 pl-5'>
        <li>
          脚本会分别验证直连和 Windows 已配置的 HTTP/Mixed
          代理；仅在直连异常、代理链路正常时写入 Claude 专属代理配置。
        </li>
        <li>
          不要求开启全局模式；使用规则模式时，请确保{' '}
          <code>api.anyrouters.com</code> 经过代理。
        </li>
        <li>
          安装及后续使用期间都要保持代理软件连接。脚本不会修改 Windows
          全局代理，也不会扫描或猜测本地端口。
        </li>
        <li>
          Claude Code 不支持 SOCKS-only 或 PAC 地址；代理软件需要提供 HTTP 或
          Mixed 端口。
        </li>
      </ul>
    </div>
  )
}

function ApiTakeoverNotice({
  tool,
}: {
  tool: 'codex' | 'codex-config' | 'claude'
}) {
  const toolName = tool === 'claude' ? 'Claude Code' : 'Codex'
  let action = `这条命令会安装或升级 ${toolName}，并写入 AnyRouters 配置`
  if (tool === 'codex-config') {
    action = `这条命令只更新 ${toolName} 的 AnyRouters 配置`
  } else if (tool === 'codex') {
    action =
      '这条命令会先检测现有 Codex；能力兼容时跳过安装并只更新 AnyRouters 配置，未安装或能力不足时才安装或升级'
  }
  const safety =
    tool === 'claude'
      ? '修改前会自动备份；不会删除聊天记录，也不会修改 Windows 全局代理、AWS 凭据或其他工具配置。Windows 直连受限时，只会把已验证可用的 HTTP/Mixed 代理写入 Claude 自己的 settings.json。'
      : '修改前会自动备份；不会写入自定义模型目录，也不会关闭 Codex 原生子代理、工具能力或修改已有推理强度。检测只看 Codex 原生能力，不依赖当前版本号或服务商名称；命令会清理会影响 Codex 的通用 OpenAI API 路由覆盖，但只使用你粘贴的现有 AnyRouters Key，不会创建、替换或停用网站 Key，也不会修改系统代理、AWS 凭据或 CODEX_HOME。'

  return (
    <div className='mt-3 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100'>
      <TriangleAlert className='mt-0.5 size-4 shrink-0' />
      <div className='min-w-0 text-sm leading-6'>
        <p className='font-semibold'>运行前请注意</p>
        <p className='mt-1 text-amber-900/85 dark:text-amber-100/80'>
          {action}。{safety}写入位置和分步验证见下方「开发者」。
        </p>
      </div>
    </div>
  )
}

function ManualStep({
  index,
  title,
  children,
}: {
  index: number
  title: string
  children: ReactNode
}) {
  return (
    <div className='space-y-3'>
      <StepTitle>
        {index}. {title}
      </StepTitle>
      {children}
    </div>
  )
}

function codexEnvironmentTarget(os: OS): string {
  if (os === 'windows') return '当前 PowerShell 会话和 Windows 用户环境'
  if (os === 'mac') return '当前 shell 启动文件和 macOS launchctl'
  return '当前 shell 启动文件'
}

function codexConfigTargets(os: OS): string[] {
  if (os === 'windows') {
    return [
      '$HOME\\.codex\\config.toml',
      'Windows 用户环境变量 OPENAI_API_KEY（使用你粘贴的现有 AnyRouters Key）',
    ]
  }
  if (os === 'mac') {
    return [
      '~/.codex/config.toml',
      '当前 shell 启动文件中的 OPENAI_API_KEY（使用你粘贴的现有 AnyRouters Key）',
      'macOS launchctl 中的 OPENAI_API_KEY（供 Codex 桌面版使用）',
    ]
  }
  return [
    '~/.codex/config.toml',
    '当前 shell 启动文件中的 OPENAI_API_KEY（使用你粘贴的现有 AnyRouters Key）',
  ]
}

function CodeBlock({ code }: { code: string }) {
  const apiKey = useApiKey()
  const { copyToClipboard } = useCopyToClipboard()
  const [copied, setCopied] = useState(false)
  const resolved = withKey(code, apiKey)
  const highlight = apiKey.trim() || KEY
  const parts = resolved.split(highlight)

  const copy = () => {
    copyToClipboard(resolved)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className='mt-3 min-w-0 rounded-lg border'>
      <pre className='max-w-full overflow-x-auto px-4 py-3 text-[13px] leading-6'>
        <code className='font-mono'>
          {parts.map((part, index) => (
            <span key={index}>
              {part}
              {index < parts.length - 1 && (
                <span className='rounded bg-red-500/10 px-1 font-semibold text-red-600'>
                  {highlight}
                </span>
              )}
            </span>
          ))}
        </code>
      </pre>
      <div className='border-t px-3 py-2'>
        <Button size='sm' variant='outline' onClick={copy}>
          {copied ? <Check className='size-4' /> : <Copy className='size-4' />}
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
    </div>
  )
}

function ConfigValues({
  fields,
}: {
  fields: Array<{ label: string; value: string }>
}) {
  const apiKey = useApiKey()
  const { copyToClipboard } = useCopyToClipboard()
  const [copied, setCopied] = useState<string | null>(null)

  const copy = (label: string, value: string) => {
    copyToClipboard(withKey(value, apiKey))
    setCopied(label)
    setTimeout(() => setCopied(null), 1200)
  }

  return (
    <div className='mt-3 overflow-hidden rounded-lg border'>
      {fields.map((field, index) => {
        const value = withKey(field.value, apiKey)
        return (
          <div
            key={field.label}
            className={cn(
              'flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
              index > 0 && 'border-t'
            )}
          >
            <div className='min-w-0'>
              <p className='text-muted-foreground text-xs'>{field.label}</p>
              <code className='mt-1 block overflow-x-auto font-mono text-sm'>
                {value}
              </code>
            </div>
            <Button
              size='sm'
              variant='outline'
              className='shrink-0 self-start sm:self-auto'
              onClick={() => copy(field.label, field.value)}
            >
              {copied === field.label ? (
                <Check className='size-4' />
              ) : (
                <Copy className='size-4' />
              )}
              {copied === field.label ? '已复制' : '复制'}
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function TerminalResult({ output }: { output: string }) {
  return (
    <div className='mt-3 overflow-hidden rounded-lg border bg-neutral-950 text-neutral-100'>
      <div className='flex items-center gap-1 border-b border-white/10 px-3 py-2'>
        <span className='size-2.5 rounded-full bg-red-400' />
        <span className='size-2.5 rounded-full bg-yellow-400' />
        <span className='size-2.5 rounded-full bg-green-400' />
      </div>
      <pre className='max-w-full overflow-x-auto px-4 py-3 text-[13px] leading-6'>
        <code className='font-mono whitespace-pre-wrap'>{output}</code>
      </pre>
    </div>
  )
}

function ApiKeyStep({
  apiKey,
  onApiKeyChange,
  toolName,
}: {
  apiKey: string
  onApiKeyChange: (v: string) => void
  toolName: string
}) {
  const [creating, setCreating] = useState(false)

  const createKey = async () => {
    setCreating(true)
    try {
      const { key, reused } = await getOrCreateApiKey(toolName)
      onApiKeyChange(key)
      toast.success(reused ? '已填入已有 API Key' : 'API Key 已创建')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'API Key 创建失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className='space-y-3'>
      <StepTitle>第一步：创建 API Key</StepTitle>
      <div className='flex flex-col gap-2 lg:flex-row lg:items-center'>
        <Button
          onClick={createKey}
          disabled={creating}
          className='border-0 bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 text-white shadow-sm hover:brightness-105'
        >
          {creating ? '创建中' : '自动创建'}
          <WandSparkles className='size-4' />
        </Button>
        <Button variant='outline' render={<Link to='/keys' />}>
          手动创建 API Key
          <ExternalLink className='size-3.5' />
        </Button>
        <Input
          type='text'
          spellCheck={false}
          autoComplete='off'
          placeholder='粘贴 API Key'
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          className='h-10 min-w-0 flex-1 font-mono text-sm'
        />
      </div>
      <p className='text-muted-foreground text-sm'>
        手动创建后，复制完整 API Key，回到这里粘贴到右侧输入框。
      </p>
      {apiKey.trim().toLowerCase().startsWith('sk-anyrouters-') && (
        <p className='text-sm text-red-600'>
          不要额外加 sk-anyrouters-，请粘贴完整 API Key
        </p>
      )}
      {!apiKey.trim() && (
        <p className='text-sm font-medium text-red-600'>
          请先自动创建，或粘贴完整 API Key。
        </p>
      )}
    </div>
  )
}

function installCommand({
  os,
  tool,
  key,
}: {
  os: OS
  tool: 'codex' | 'codex-config' | 'claude'
  key: string
}) {
  const endpoint = `https://anyrouters.com/install/${tool}`
  if (os === 'windows') {
    return `[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; $env:ANYROUTERS_KEY="${key}"; irm ${endpoint}.ps1 | iex`
  }
  return `curl -fsSL ${endpoint}.sh | bash -s -- "${key}"`
}

function codexOfficialRestoreCommand(os: OS) {
  const endpoint = 'https://anyrouters.com/install/codex-official'
  if (os === 'windows') {
    return `[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; irm ${endpoint}.ps1 | iex`
  }
  return `curl -fsSL ${endpoint}.sh | bash`
}

function codexHistoryCommand() {
  return '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; irm https://anyrouters.com/install/codex-history.ps1 | iex'
}

function successOutput({
  os,
  tool,
}: {
  os: OS
  tool: 'codex' | 'codex-config' | 'claude'
}) {
  if (tool === 'codex-config') {
    return os === 'windows'
      ? 'Done! Fully quit Codex desktop, reopen it, and start a NEW task.'
      : 'OK Done! Command-Q to fully quit Codex desktop, reopen it, and start a NEW task.'
  }
  if (tool === 'codex') {
    return `${os === 'windows' ? 'Done' : 'OK Done'}! Open a NEW terminal window and run:  codex`
  }
  return `${os === 'windows' ? 'Done' : 'OK Done'}! Open a NEW ${os === 'windows' ? 'PowerShell or cmd.exe' : 'terminal'} window and run:  claude`
}

function UserFlow({
  apiKey,
  onApiKeyChange,
  tool,
  toolName,
  desktopDownload = false,
}: {
  apiKey: string
  onApiKeyChange: (v: string) => void
  tool: 'codex' | 'codex-config' | 'claude'
  toolName: string
  desktopDownload?: boolean
}) {
  const { os } = useOsChoice()
  const key = apiKey.trim() || KEY
  const command = installCommand({ os, tool, key })
  const shellName = os === 'windows' ? 'PowerShell' : '终端'
  const openShellText =
    os === 'windows'
      ? desktopDownload
        ? '完全退出 Codex 桌面版，再按 Win 键搜索 PowerShell 打开'
        : '按 Win 键搜索 PowerShell 打开'
      : desktopDownload
        ? '完全退出 Codex 桌面版，再打开终端'
        : '打开终端'

  return (
    <section className='border-b pb-10'>
      <SectionTitle>普通用户</SectionTitle>
      <div className='mt-6 space-y-8'>
        <ApiKeyStep
          apiKey={apiKey}
          onApiKeyChange={onApiKeyChange}
          toolName={toolName}
        />

        <div className='space-y-3'>
          <StepTitle>第二步：选择电脑型号</StepTitle>
          <OsToggle />
        </div>

        <div className='space-y-3'>
          <StepTitle>第三步：快速接入</StepTitle>
          {(tool === 'codex' || tool === 'codex-config') && (
            <CodexUpdateNotice />
          )}
          {tool === 'claude' && os === 'windows' && (
            <ClaudeWindowsProxyNotice />
          )}
          {tool === 'codex' && (
            <p className='text-sm font-medium'>
              已经安装 Codex 的用户无需卸载或重装；脚本会自动检测兼容性。
            </p>
          )}
          {desktopDownload && (
            <p className='text-sm'>
              前提条件：
              <a
                href={CODEX_OFFICIAL_URL}
                target='_blank'
                rel='noopener noreferrer'
                className='inline-flex items-center gap-1 font-medium underline underline-offset-4'
              >
                安装 Codex 桌面版
                <ExternalLink className='size-3.5' />
              </a>
            </p>
          )}
          <ol className='text-muted-foreground list-decimal space-y-3 pl-5 text-sm'>
            <li>{openShellText}</li>
            <li>
              <span>
                点击命令框下方「复制」，把整行命令粘贴到
                {shellName}，按回车运行。
                {(tool === 'codex' || tool === 'codex-config') && (
                  <strong className='font-semibold'>
                    已有兼容版本会自动跳过安装。
                  </strong>
                )}
              </span>
              <CodeBlock code={command} />
              <ApiTakeoverNotice tool={tool} />
            </li>
            <li>
              <span>安装完成后，最后会看到：</span>
              <TerminalResult output={successOutput({ os, tool })} />
            </li>
          </ol>
          <p className='text-muted-foreground text-sm'>如有问题，请联系客服</p>
        </div>
      </div>
    </section>
  )
}

function CodexOfficialRestoreGuide() {
  const { os } = useOsChoice()
  const shellName = os === 'windows' ? 'PowerShell' : '终端'

  return (
    <section className='border-t pt-10'>
      <SectionTitle>切回 OpenAI 官方订阅</SectionTitle>
      <div className='mt-6 space-y-4 rounded-lg border px-4 py-4 text-sm leading-6'>
        <p>
          不需要卸载或重装 Codex。下面的命令会先生成备份，再移除当前生效的自定义
          模型、服务商、模型目录、API 地址和常见环境覆盖，恢复 Codex 内置 OpenAI
          服务商。
        </p>
        <p className='text-muted-foreground'>
          无论当前使用哪家服务商都可以恢复：脚本会移除当前激活的通用路由选择；
          AnyRouters/AllRouters
          配置段会被清理，其他第三方服务商定义会保留但不再启用。原有{' '}
          <code className='text-foreground'>auth.json</code>
          、MCP、插件、工具、权限、聊天记录均保留。新配置会先通过 Codex
          校验，校验失败不会覆盖现有文件。
        </p>
        <p>完全退出 Codex，打开{shellName}，复制并运行：</p>
        <CodeBlock code={codexOfficialRestoreCommand(os)} />
        <p className='text-muted-foreground'>
          完成后重新打开{shellName}并运行{' '}
          <code className='text-foreground'>codex login status</code>
          。如果显示的不是 ChatGPT 登录，再依次执行{' '}
          <code className='text-foreground'>codex logout</code> 和{' '}
          <code className='text-foreground'>codex login</code>
          ；脚本不会主动退出你原来的官方账号。
        </p>
        <p className='text-muted-foreground'>
          如果你曾使用「Codex-聊天迁移」同步过会话，切回官方配置后还要到该独立教程
          再运行一次迁移命令。它会根据当前官方配置把本地会话索引同步回{' '}
          <code className='text-foreground'>openai</code>
          ；聊天正文不会因此删除。
        </p>
        <p className='text-amber-700 dark:text-amber-300'>
          此操作会清理用户环境中的常见 OPENAI/Codex API
          覆盖；如果其他工具也依赖这些变量，请为其他工具使用独立配置。
        </p>
      </div>
    </section>
  )
}

function CodexHistoryGuide() {
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Codex-聊天迁移</h1>
      <p className='text-muted-foreground mt-2 text-sm'>
        Windows 本地一次性迁移：让切换服务商后暂时不显示的旧任务重新出现在 Codex
        列表中。
      </p>

      <div className='mt-8 space-y-10'>
        <section>
          <SectionTitle>先了解它会做什么</SectionTitle>
          <div className='mt-6 space-y-4 rounded-lg border px-4 py-4 text-sm leading-6'>
            <p>
              这不是把 OpenAI 云端聊天上传到 AnyRouters，也不是从网站下载聊天。
              工具只在你的电脑上同步 Codex rollout、SQLite 和项目可见性中的
              Provider 元数据，不修改消息正文、标题、登录账号、API Key
              或更新时间。
            </p>
            <p className='text-muted-foreground'>
              当前教程使用开源{' '}
              <a
                href={CODEX_PROVIDER_SYNC_URL}
                target='_blank'
                rel='noreferrer'
                className='inline-flex items-center gap-1 font-medium underline underline-offset-4'
              >
                codex-provider-sync v0.3.1
                <ExternalLink className='size-3.5' />
              </a>
              。本站托管经 SHA-256 固定校验的约 48 KB 原始源码包，运行时不访问
              GitHub、npm、Git 或 SSH，也不会全局安装启动器。
            </p>
            <p className='font-medium'>
              这是可选的一次性操作，不会随每次一键接入自动执行，也不要开启 watch
              或持续同步。
            </p>
          </div>
        </section>

        <section>
          <SectionTitle>迁移到当前配置</SectionTitle>
          <div className='mt-6 space-y-8'>
            <ManualStep index={1} title='先切换到目标配置'>
              <p className='text-muted-foreground text-sm'>
                要在 AnyRouters 中显示旧任务，先完成本站 Codex
                一键接入；要恢复官方列表，先在 Codex 教程中运行「切回 OpenAI
                官方订阅」。迁移脚本只接受{' '}
                <code className='text-foreground'>anyrouters</code>、{' '}
                <code className='text-foreground'>openai</code>，以及已经存在的
                官方登录 HTTPS 兼容配置{' '}
                <code className='text-foreground'>openai_http</code>
                （会话仍标记为 openai），不会误改其他第三方服务商。
              </p>
            </ManualStep>

            <ManualStep index={2} title='完全退出 Codex'>
              <p className='text-muted-foreground text-sm'>
                关闭 Codex 桌面版、Codex CLI 和 app-server 相关终端。脚本发现
                Codex 仍在运行会直接停止，不会强制结束进程。
              </p>
            </ManualStep>

            <ManualStep index={3} title='在 PowerShell 运行'>
              <p className='text-muted-foreground text-sm'>
                Windows 需要 Node.js 22.5+ 自带的 node:sqlite；无需安装 npm
                包。复制整行命令到 PowerShell 运行，查看检测结果后输入大写{' '}
                <code className='text-foreground'>YES</code> 确认。
              </p>
              <CodeBlock code={codexHistoryCommand()} />
            </ManualStep>

            <ManualStep index={4} title='重新打开并检查'>
              <p className='text-muted-foreground text-sm'>
                同步成功后重新打开 Codex。工具会先把备份保存到{' '}
                <code className='text-foreground'>
                  ~/.codex/backups_state/provider-sync
                </code>
                ，不要手动删除最近备份。官方与 AnyRouters
                之间再次切换时，先切配置，再按本页重新同步到当前 Provider。
              </p>
            </ManualStep>
          </div>
        </section>

        <section className='border-t pt-10'>
          <SectionTitle>加密会话与重连说明</SectionTitle>
          <div className='mt-6 space-y-4 rounded-lg border px-4 py-4 text-sm leading-6'>
            <p>
              原聊天文件不会被删除，但包含{' '}
              <code className='text-foreground'>encrypted_content</code>{' '}
              的会话与原账号/Provider
              绑定。跨账号或服务商后可能能看到，却无法继续或压缩，并提示{' '}
              <code className='text-foreground'>invalid_encrypted_content</code>
              。遇到这种情况请回原账号继续，或先在原会话生成交接文档，再新建任务导入。
            </p>
            <p className='text-muted-foreground'>
              Windows 中「正在重新连接 1/5…5/5」是 Codex 官方 WebSocket
              连接超时后回退 HTTPS
              的客户端/网络现象。本工具不改系统代理、WebSocket、认证、API
              地址或传输设置；即使已经使用官方登录的 HTTPS
              兼容配置，也只同步会话 Provider
              元数据。因此聊天迁移和本教程更新不会造成该重连。
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

function ClaudeContextLimitFaq() {
  return (
    <section className='border-b py-10'>
      <SectionTitle>常见问题</SectionTitle>
      <div className='mt-6 rounded-lg border px-4 py-4 text-sm leading-6'>
        <StepTitle>出现 Context limit reached，为什么无法继续？</StepTitle>
        <p className='text-muted-foreground mt-2'>
          这是 Claude Code 当前会话的本地上下文已满，通常发生在请求发送前，
          通常不是 AnyRouters Key、余额或模型故障。
        </p>
        <ol className='text-muted-foreground mt-3 list-decimal space-y-2 pl-5'>
          <li>
            先输入 <code className='text-foreground'>/compact</code>
            ，让 Claude Code 压缩当前会话后继续。
          </li>
          <li>
            仍无法继续时，输入 <code className='text-foreground'>/clear</code>
            ，清空当前会话上下文并开始新会话。
          </li>
          <li>
            如果新会话仍立即报错，完全退出 Claude Code 后重新打开；不要使用
            --continue 或 --resume 恢复刚才的旧会话。
          </li>
          <li>
            如果画面显示某个第三方 skill 加载后立即报错，先停用该 skill
            再试；仍未恢复时，再升级或重装 Claude Code。
          </li>
        </ol>
        <p className='mt-3 font-medium'>
          AnyRouters 安装脚本不会自动删除 ~/.claude、skills 或聊天记录；
          这些内容可能包含用户自己的配置，不应为排障整目录清除。
        </p>
      </div>
    </section>
  )
}

function ClaudeWindowsProxyFaq() {
  const { os } = useOsChoice()
  if (os !== 'windows') return null

  return (
    <section className='border-b py-10'>
      <SectionTitle>Windows 403 与代理排障</SectionTitle>
      <div className='mt-6 rounded-lg border px-4 py-4 text-sm leading-6'>
        <StepTitle>
          提示 Please run /login，并返回 HTML 403，应该怎么办？
        </StepTitle>
        <p className='text-muted-foreground mt-2'>
          如果错误内容带有{' '}
          <code className='text-foreground'>&lt;!doctype html&gt;</code>、
          <code className='text-foreground'>
            &lt;title&gt;403&lt;/title&gt;
          </code>{' '}
          或 <code className='text-foreground'>403 Forbidden</code>
          ，通常是 Windows 终端中的 Claude 没有走到代理，并不是 Key
          失效，也不需要反复执行 <code className='text-foreground'>/login</code>
          。浏览器能打开网站也不能证明 Claude
          已经走代理，因为两者读取代理设置的方式不同。
        </p>
        <ol className='text-muted-foreground mt-3 list-decimal space-y-2 pl-5'>
          <li>确认代理软件已连接，并提供 HTTP 或 Mixed 端口。</li>
          <li>
            规则模式下确认{' '}
            <code className='text-foreground'>api.anyrouters.com</code>{' '}
            经过代理；全局模式不是必需条件。
          </li>
          <li>
            回到上方“快速接入”，重新复制并运行最新的一键命令。脚本会自动检测
            Windows 代理、验证 API 链路，并仅更新{' '}
            <code className='text-foreground'>~/.claude/settings.json</code>。
          </li>
          <li>
            看到完成提示后，完全退出 Claude Code，关闭原终端，再打开新的
            PowerShell 运行 <code className='text-foreground'>claude</code>。
          </li>
          <li>
            使用期间不要断开代理。若自动检测不到 PAC
            或自定义代理，可按脚本提示设置{' '}
            <code className='text-foreground'>ANYROUTERS_PROXY</code>
            后重跑；不要把 SOCKS 端口当作 HTTP 端口。
          </li>
        </ol>
        <p className='mt-3 font-medium'>
          正常判断标准：直连可能返回 HTML 403，但通过代理访问接口应返回 JSON；
          未携带 Key 的检查返回 JSON 401 也表示网络链路已经正常。
        </p>
      </div>
    </section>
  )
}

function CodexSetupCommands() {
  const { os } = useOsChoice()
  return (
    <CodeBlock code={installCommand({ os, tool: 'codex-config', key: KEY })} />
  )
}

function ClaudeEnvCommands() {
  const { os } = useOsChoice()
  if (os === 'windows') {
    return (
      <CodeBlock
        code={`$Key = "${KEY}"
$Conflicting = @(
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
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
foreach ($Name in $Conflicting) {
  [Environment]::SetEnvironmentVariable($Name, $null, "User")
  Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
}
$SettingsDir = Join-Path $env:USERPROFILE ".claude"
$SettingsPath = Join-Path $SettingsDir "settings.json"
New-Item -ItemType Directory -Force -Path $SettingsDir | Out-Null
$Settings = if (Test-Path $SettingsPath) {
  try { Get-Content -Raw $SettingsPath | ConvertFrom-Json } catch { [pscustomobject]@{} }
} else { [pscustomobject]@{} }
if (-not $Settings.PSObject.Properties["env"]) {
  $Settings | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{})
}
foreach ($Name in ($Conflicting + @("ANTHROPIC_AUTH_TOKEN"))) {
  if ($Settings.env.PSObject.Properties[$Name]) {
    $Settings.env.PSObject.Properties.Remove($Name)
  }
}
$Settings.env | Add-Member -Force -NotePropertyName ANTHROPIC_BASE_URL -NotePropertyValue "${ANTHROPIC_BASE}"
$Settings.env | Add-Member -Force -NotePropertyName ANTHROPIC_MODEL -NotePropertyValue "${CLAUDE_DEFAULT_MODEL}"
if (Test-Path $SettingsPath) { Copy-Item $SettingsPath "$SettingsPath.anyrouters.bak" -Force }
$Settings | ConvertTo-Json -Depth 32 | Set-Content -Path $SettingsPath -Encoding UTF8
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "${ANTHROPIC_BASE}", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $Key, "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL", "${CLAUDE_DEFAULT_MODEL}", "User")`}
      />
    )
  }

  if (os === 'mac') {
    return (
      <CodeBlock
        code={`KEY="${KEY}"
PROFILE="\${ZDOTDIR:-$HOME}/.zshrc"
touch "$PROFILE"
cp "$PROFILE" "$PROFILE.anyrouters.bak" 2>/dev/null || true
sed -i.bak '/# anyrouters-managed-begin/,/# anyrouters-managed-end/d' "$PROFILE" 2>/dev/null || true
sed -i.bak '/^export ANTHROPIC_BASE_URL=/d;/^export ANTHROPIC_AUTH_TOKEN=/d;/^export ANTHROPIC_MODEL=/d' "$PROFILE" 2>/dev/null || true
cat >> "$PROFILE" <<EOF
# anyrouters-managed-begin
export ANTHROPIC_BASE_URL=${ANTHROPIC_BASE}
export ANTHROPIC_AUTH_TOKEN=$KEY
export ANTHROPIC_MODEL=${CLAUDE_DEFAULT_MODEL}
# anyrouters-managed-end
EOF
source "$PROFILE"`}
      />
    )
  }

  return (
    <CodeBlock
      code={`KEY="${KEY}"
PROFILE="$HOME/.bashrc"
touch "$PROFILE"
cp "$PROFILE" "$PROFILE.anyrouters.bak" 2>/dev/null || true
sed -i.bak '/# anyrouters-managed-begin/,/# anyrouters-managed-end/d' "$PROFILE" 2>/dev/null || true
sed -i.bak '/^export ANTHROPIC_BASE_URL=/d;/^export ANTHROPIC_AUTH_TOKEN=/d;/^export ANTHROPIC_MODEL=/d' "$PROFILE" 2>/dev/null || true
cat >> "$PROFILE" <<EOF
# anyrouters-managed-begin
export ANTHROPIC_BASE_URL=${ANTHROPIC_BASE}
export ANTHROPIC_AUTH_TOKEN=$KEY
export ANTHROPIC_MODEL=${CLAUDE_DEFAULT_MODEL}
# anyrouters-managed-end
EOF
source "$PROFILE"`}
    />
  )
}

function CodexCliInstallCommands() {
  const { os } = useOsChoice()
  if (os === 'windows') {
    return (
      <CodeBlock code='powershell -ExecutionPolicy ByPass -c "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; irm https://chatgpt.com/codex/install.ps1 | iex"' />
    )
  }
  return (
    <CodeBlock code='curl -fsSL https://chatgpt.com/codex/install.sh | sh' />
  )
}

function ClaudeInstallCommands() {
  const { os } = useOsChoice()
  if (os === 'windows') {
    return (
      <CodeBlock
        code={`[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$NpmPrefix = if ($env:ANYROUTERS_NPM_PREFIX) { $env:ANYROUTERS_NPM_PREFIX } else { Join-Path $env:LOCALAPPDATA "AnyRouters\\npm" }
function Add-UserPath([string]$PathToAdd, [bool]$Prefer = $false) {
  if (-not $PathToAdd -or -not (Test-Path $PathToAdd)) { return }
  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $current) { $current = [Environment]::GetEnvironmentVariable("PATH", "User") }
  $parts = if ($current) { $current -split ';' | Where-Object { $_ -and ($_ -ine $PathToAdd) } } else { @() }
  $parts = if ($Prefer) { @($PathToAdd) + $parts } else { $parts + @($PathToAdd) }
  [Environment]::SetEnvironmentVariable("Path", ($parts -join ';'), "User")
  $envParts = if ($env:PATH) { $env:PATH -split ';' | Where-Object { $_ -and ($_ -ine $PathToAdd) } } else { @() }
  $env:PATH = (@($PathToAdd) + $envParts) -join ';'
}
function Test-ClaudeCommandWorks([string]$CommandPath) {
  if (-not $CommandPath -or -not (Test-Path $CommandPath)) { return $false }
  try {
    & $CommandPath --version *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}
function Get-AnyRoutersClaudeDirs {
  @(
    $NpmPrefix,
    (Join-Path $NpmPrefix "bin"),
    (Join-Path $NpmPrefix "node_modules\\.bin")
  ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
}
function Add-AnyRoutersClaudePaths {
  $dirs = @(Get-AnyRoutersClaudeDirs)
  [Array]::Reverse($dirs)
  foreach ($dir in $dirs) { Add-UserPath $dir $true }
}
function Get-LegacyClaudeLaunchers {
  @(
    (Join-Path $env:USERPROFILE ".local\\cmd-shims\\claude.cmd"),
    (Join-Path $env:USERPROFILE ".local\\bin\\claude.cmd"),
    (Join-Path $env:USERPROFILE ".local\\bin\\claude.exe"),
    (Join-Path $env:APPDATA "npm\\claude.cmd"),
    (Join-Path $env:APPDATA "npm\\claude.ps1"),
    (Join-Path $env:APPDATA "npm\\claude")
  ) | Where-Object { $_ } | Select-Object -Unique
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
  if (-not $PathValue) { return $false }
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
  if ($LASTEXITCODE -ne 0) { return @() }
  return $output | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() }
}
function Test-CmdClaudeWorks {
  cmd.exe /d /c "claude --version >nul 2>nul"
  return $LASTEXITCODE -eq 0
}
function Remove-BrokenCmdClaudeLaunchers {
  foreach ($launcher in (Get-CmdClaudePaths)) {
    if (-not (Test-Path $launcher)) { continue }
    if (-not (Test-IsUserPath $launcher)) { continue }
    if (Test-ClaudeCommandWorks $launcher) { continue }
    Remove-Item -Path $launcher -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $launcher)) {
      Write-Host "Removed broken Claude launcher from cmd PATH: $launcher"
    }
  }
}
function Get-ClaudeCandidateDirs {
  @(
    $NpmPrefix,
    (Join-Path $NpmPrefix "bin"),
    (Join-Path $NpmPrefix "node_modules\\.bin"),
    (Join-Path $env:APPDATA "npm"),
    (Join-Path $env:LOCALAPPDATA "Programs\\Claude"),
    (Join-Path $env:USERPROFILE ".claude\\local"),
    (Join-Path $env:USERPROFILE ".claude\\local\\bin"),
    (Join-Path $env:USERPROFILE ".local\\bin")
  ) | Where-Object { $_ } | Select-Object -Unique
}
function Add-ClaudeCandidatePaths {
  Add-AnyRoutersClaudePaths
}
function Repair-CmdClaudePath {
  Add-ClaudeCandidatePaths
  if (Test-CmdClaudeWorks) { return $true }
  Remove-BrokenCmdClaudeLaunchers
  Add-ClaudeCandidatePaths
  if (Test-CmdClaudeWorks) { return $true }
  $anyRoutersCommand = $null
  foreach ($dir in (Get-AnyRoutersClaudeDirs)) {
    foreach ($file in @("claude.cmd", "claude.exe", "claude.ps1", "claude")) {
      $candidate = Join-Path $dir $file
      if (Test-ClaudeCommandWorks $candidate) {
        $anyRoutersCommand = $candidate
        break
      }
    }
    if ($anyRoutersCommand) { break }
  }
  if ($anyRoutersCommand) {
    Remove-LegacyClaudeLaunchers
    Add-ClaudeCandidatePaths
  }
  return (Test-CmdClaudeWorks)
}
function Find-ClaudeCommand {
  foreach ($dir in (Get-ClaudeCandidateDirs)) {
    foreach ($file in @("claude.cmd", "claude.exe", "claude.ps1", "claude")) {
      $candidate = Join-Path $dir $file
      if (Test-ClaudeCommandWorks $candidate) { return $candidate }
    }
  }
  foreach ($cmd in @(Get-Command claude -All -ErrorAction SilentlyContinue)) {
    if ($cmd -and $cmd.Source -and (Test-ClaudeCommandWorks $cmd.Source)) {
      return $cmd.Source
    }
  }
  return $null
}
$installed = $false
try {
  $installer = Invoke-RestMethod -Uri "https://claude.ai/install.ps1" -ErrorAction Stop
  if ($installer.Substring(0, [Math]::Min(512, $installer.Length)) -match "(?is)<!doctype html|<html|</html") {
    throw "Official installer returned HTML"
  }
  Invoke-Expression $installer
  $claudePath = Find-ClaudeCommand
  if ($claudePath) {
    Add-UserPath (Split-Path -Parent $claudePath) $true
    $installed = $true
  } else {
    Write-Host "Official installer finished, but claude is not on PATH. Falling back to npm install."
  }
} catch {
  Write-Host "Official installer failed or returned HTML. Using the official npm package in a user-writable directory ..."
}
if (-not $installed) {
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Install Node.js from https://nodejs.org first, then re-run this command."
  }
  New-Item -ItemType Directory -Force -Path $NpmPrefix | Out-Null
  npm install -g --prefix "$NpmPrefix" @anthropic-ai/claude-code
  Add-ClaudeCandidatePaths
  Remove-LegacyClaudeLaunchers
}
$claudePath = Find-ClaudeCommand
if ($claudePath) {
  Add-UserPath (Split-Path -Parent $claudePath) $true
  & $claudePath --version
}
if (Repair-CmdClaudePath) {
  Write-Host "Done. Open a NEW PowerShell or cmd.exe, then run: claude"
} else {
  Write-Host "cmd.exe still cannot run claude. Close all terminals and open a NEW cmd.exe, then run: where claude"
  if ($claudePath) {
    Write-Host "Detected claude at: $claudePath"
    Write-Host "Add this folder to User Path if needed: $(Split-Path -Parent $claudePath)"
  }
  $cmdPaths = @(Get-CmdClaudePaths)
  if ($cmdPaths.Count -gt 0) {
    Write-Host "cmd.exe currently finds:"
    foreach ($path in $cmdPaths) { Write-Host "  $path" }
  }
}`}
      />
    )
  }
  return (
    <CodeBlock
      code={`NPM_PREFIX="\${ANYROUTERS_NPM_PREFIX:-$HOME/.anyrouters/npm}"
install_claude_with_user_npm() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      brew install node
    else
      echo "Install Node.js from https://nodejs.org first, then re-run this command."
      return 1
    fi
  fi
  mkdir -p "$NPM_PREFIX"
  npm install -g --prefix "$NPM_PREFIX" @anthropic-ai/claude-code
  export PATH="$NPM_PREFIX/bin:$PATH"
}
tmp_installer="$(mktemp)"
official_installed=0
if curl -fsSL https://claude.ai/install.sh -o "$tmp_installer"; then
  if LC_ALL=C head -c 512 "$tmp_installer" | grep -Eiq '<!doctype html|<html|</html'; then
    echo "Official installer returned HTML. Skipping it."
  elif bash "$tmp_installer"; then
    official_installed=1
  fi
fi
rm -f "$tmp_installer"
if [ "$official_installed" -ne 1 ]; then
  echo "Official installer failed or returned HTML. Using the official npm package in a user-writable directory ..."
  install_claude_with_user_npm
fi
if command -v claude >/dev/null 2>&1; then
  claude --version
else
  echo "Claude Code is installed, but the claude command may require opening a new terminal."
fi`}
    />
  )
}

function OfficialInstallLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <p className='mt-2 text-sm'>
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='inline-flex items-center gap-1 font-medium underline underline-offset-4'
      >
        {children}
        <ExternalLink className='size-3.5' />
      </a>
    </p>
  )
}

function DeveloperFlow({
  kind,
}: {
  kind: 'codex-desktop' | 'codex-cli' | 'claude'
}) {
  const { os } = useOsChoice()
  const isCodex = kind !== 'claude'
  const isDesktop = kind === 'codex-desktop'
  const needsInstallCheck = !isDesktop
  const shellName =
    os === 'windows' ? 'PowerShell' : os === 'linux' ? 'Bash 终端' : '终端'
  const startStep = isDesktop ? 4 : 5
  const verifyStep = isDesktop ? 5 : 6
  const codexFiles = codexConfigTargets(os)
  const claudeConfigTargets =
    os === 'windows'
      ? ['$HOME\\.claude\\settings.json', 'Windows 用户环境变量']
      : [os === 'mac' ? '~/.zshrc' : '~/.bashrc']
  const backupDir =
    os === 'windows'
      ? '$HOME\\.codex\\anyrouters-native-backup-时间戳'
      : '~/.codex/anyrouters-native-backup-时间戳'
  const codexEnvTarget = codexEnvironmentTarget(os)

  return (
    <section className='pt-10'>
      <SectionTitle>开发者</SectionTitle>
      <div className='mt-6 space-y-8'>
        <div className='bg-muted/40 rounded-lg border px-4 py-3 text-sm leading-6'>
          <p className='font-semibold'>这些命令在哪里运行？</p>
          <p className='text-muted-foreground mt-1'>
            当前选择 {OS_LABELS[os]}：打开{shellName}运行下面的命令。
            电脑型号不对时，先回到上方切换。
          </p>
          <p className='mt-1 font-medium'>
            每个命令框都要点击“复制”，整段粘贴到{shellName}，然后按回车；
            不要粘贴到浏览器地址栏、工具聊天输入框或文件编辑器。
          </p>
        </div>

        <ManualStep
          index={1}
          title={
            kind === 'claude'
              ? '安装 Claude Code'
              : isDesktop
                ? '安装 Codex 桌面版'
                : '安装 Codex 终端版'
          }
        >
          {isDesktop ? (
            <OfficialInstallLink href={CODEX_OFFICIAL_URL}>
              打开 Codex 下载页
            </OfficialInstallLink>
          ) : kind === 'codex-cli' ? (
            <>
              <OfficialInstallLink href={CODEX_CLI_OFFICIAL_URL}>
                查看 Codex CLI 官方安装页
              </OfficialInstallLink>
              <p className='text-muted-foreground text-sm'>
                <code className='text-foreground'>codex --version</code>{' '}
                只能证明已经安装，不能证明模型、工具和子代理能力兼容。已有用户无需自行重装，
                请优先使用上方“快速接入”，由脚本按原生能力自动决定跳过还是升级；只有已经确认兼容时，
                才直接进行第 3 步。
              </p>
              <p className='text-muted-foreground text-sm'>
                在{shellName}中复制并执行下面整行命令：
              </p>
              <CodexCliInstallCommands />
            </>
          ) : (
            <>
              <OfficialInstallLink href={CLAUDE_OFFICIAL_URL}>
                查看 Claude Code 官方安装页
              </OfficialInstallLink>
              <p className='text-muted-foreground text-sm'>
                在{shellName}中复制并执行下面整段命令：
              </p>
              <ClaudeInstallCommands />
            </>
          )}
        </ManualStep>

        {needsInstallCheck && (
          <ManualStep
            index={2}
            title={
              kind === 'codex-cli' ? '确认 Codex 可用' : '确认 Claude Code 可用'
            }
          >
            <p className='text-muted-foreground text-sm'>
              安装完成后，仍在同一个{shellName}中执行：
            </p>
            <CodeBlock
              code={
                kind === 'codex-cli' ? 'codex --version' : 'claude --version'
              }
            />
          </ManualStep>
        )}

        {isDesktop && (
          <ManualStep index={2} title='完全退出 Codex 桌面版'>
            <p className='text-muted-foreground text-sm'>
              {os === 'mac'
                ? '按 Command-Q 完全退出 Codex；只关闭窗口不算退出。'
                : '从任务栏托盘或任务管理器完全退出 Codex；只关闭窗口不算退出。'}
            </p>
          </ManualStep>
        )}

        {isCodex ? (
          <ManualStep index={3} title='写入 AnyRouters 配置'>
            <p className='text-muted-foreground text-sm'>
              先在上方 API Key 输入框粘贴完整 Key，再把下面整行命令复制到
              {shellName}运行。命令会自动备份旧配置，并写入以下位置：
            </p>
            <ul className='text-muted-foreground list-disc space-y-1 pl-5 text-sm'>
              {codexFiles.map((file) => (
                <li key={file}>
                  <code className='text-foreground'>{file}</code>
                </li>
              ))}
            </ul>
            <CodexSetupCommands />
            <p className='text-muted-foreground text-sm'>
              原有 <code className='text-foreground'>auth.json</code>
              、MCP、插件、项目权限和推理强度保持不变；旧配置中的{' '}
              <code className='text-foreground'>model_catalog_json</code>{' '}
              覆盖会被移除，恢复使用 Codex 原生模型目录。旧文件备份在{' '}
              <code className='text-foreground'>{backupDir}</code>
              ，命令完成时会显示确切路径。
            </p>
            {os === 'windows' ? (
              <p className='text-muted-foreground text-sm'>
                Windows 会清理旧{' '}
                <code className='text-foreground'>OPENAI_BASE_URL</code>、
                <code className='text-foreground'>CODEX_API_KEY</code>{' '}
                等中转覆盖，并把{' '}
                <code className='text-foreground'>OPENAI_API_KEY</code>{' '}
                设置为你刚粘贴的现有 AnyRouters Key；不会创建、替换或停用网站
                Key，也不会清理系统代理、AWS 凭据或{' '}
                <code className='text-foreground'>CODEX_HOME</code>。
              </p>
            ) : (
              <p className='text-muted-foreground text-sm'>
                同时会在{codexEnvTarget}中把{' '}
                <code className='text-foreground'>OPENAI_API_KEY</code>{' '}
                设置为你刚粘贴的现有 AnyRouters Key，并清理旧{' '}
                <code className='text-foreground'>OPENAI_BASE_URL</code>、
                <code className='text-foreground'>CODEX_API_KEY</code>{' '}
                等中转覆盖；不会创建、替换或停用网站
                Key，也不会清理系统代理、AWS 凭据或{' '}
                <code className='text-foreground'>CODEX_HOME</code>
                。如果其他工具仍依赖这些变量，请为它们单独配置。
              </p>
            )}
            <p className='text-muted-foreground text-sm'>
              Codex 升级通常会保留这份配置；需要切换 Key
              或复核原生模型能力时，可再次执行这一行。
            </p>
          </ManualStep>
        ) : (
          <ManualStep index={3} title='写入 AnyRouters 环境配置'>
            <p className='text-muted-foreground text-sm'>
              先在上方 API Key 输入框粘贴完整 Key，再把下面整段命令复制到
              {shellName}运行。配置会写入：
            </p>
            <ul className='text-muted-foreground list-disc space-y-1 pl-5 text-sm'>
              {claudeConfigTargets.map((target) => (
                <li key={target}>
                  <code className='text-foreground'>{target}</code>
                </li>
              ))}
            </ul>
            {os === 'windows' ? (
              <>
                <p className='text-muted-foreground text-sm'>
                  Windows 复用与“快速接入”相同的正式脚本，以确保直连/代理检测、
                  API 验证、配置备份和回滚逻辑保持一致；脚本可以安全重复运行。
                </p>
                <CodeBlock
                  code={installCommand({ os, tool: 'claude', key: KEY })}
                />
              </>
            ) : (
              <ClaudeEnvCommands />
            )}
          </ManualStep>
        )}

        {!isDesktop && (
          <ManualStep index={4} title={`重新打开${shellName}`}>
            <p className='text-muted-foreground text-sm'>
              关闭当前{shellName}窗口，再打开一个新的{shellName}
              窗口，让配置生效。
            </p>
          </ManualStep>
        )}

        <ManualStep
          index={startStep}
          title={isDesktop ? '重新打开 Codex 桌面版' : '启动'}
        >
          {isDesktop ? (
            <p className='text-muted-foreground text-sm'>
              打开 Codex 桌面版，并新建一个任务；不要继续使用配置前的旧任务。
            </p>
          ) : (
            <>
              <p className='text-muted-foreground text-sm'>
                在新的{shellName}窗口中执行：
              </p>
              <CodeBlock code={kind === 'codex-cli' ? 'codex' : 'claude'} />
            </>
          )}
        </ManualStep>

        <ManualStep index={verifyStep} title='验证'>
          <p className='text-muted-foreground text-sm'>
            {isDesktop
              ? '在新建任务的输入框输入'
              : '工具启动后，在终端输入区键入'}{' '}
            <code className='text-foreground'>hello</code>
            {isDesktop ? '并发送' : '，然后按回车'}；收到回复就表示配置完成。
          </p>
        </ManualStep>
      </div>
    </section>
  )
}

function ToolGuide({
  title,
  description,
  tool,
  toolName,
  desktopDownload,
  developerKind,
  withLinux = false,
  apiKey,
  onApiKeyChange,
}: GuideProps & {
  title: string
  description: string
  tool: 'codex' | 'codex-config' | 'claude'
  toolName: string
  desktopDownload?: boolean
  developerKind: 'codex-desktop' | 'codex-cli' | 'claude'
  withLinux?: boolean
}) {
  return (
    <OsProvider withLinux={withLinux}>
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>{title}</h1>
        {description && (
          <p className='text-muted-foreground mt-2 text-sm'>{description}</p>
        )}
        <div className='mt-8'>
          <UserFlow
            apiKey={apiKey}
            onApiKeyChange={onApiKeyChange}
            tool={tool}
            toolName={toolName}
            desktopDownload={desktopDownload}
          />
          {tool === 'claude' && (
            <>
              <ClaudeWindowsProxyFaq />
              <ClaudeContextLimitFaq />
            </>
          )}
          <DeveloperFlow kind={developerKind} />
          {tool !== 'claude' && <CodexOfficialRestoreGuide />}
        </div>
      </div>
    </OsProvider>
  )
}

function CcSwitchGuide({ apiKey, onApiKeyChange }: GuideProps) {
  const { os } = useOsChoice()
  const shellName = os === 'windows' ? 'PowerShell' : '终端'

  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>cc-switch</h1>
      <p className='text-muted-foreground mt-2 text-sm'>
        在 cc-switch 里添加 AnyRouters，然后一键切换 Claude Code 的服务商。
      </p>
      <div className='mt-8'>
        <section>
          <SectionTitle>配置步骤</SectionTitle>
          <div className='mt-6 space-y-8'>
            <ApiKeyStep
              apiKey={apiKey}
              onApiKeyChange={onApiKeyChange}
              toolName='cc-switch'
            />

            <ManualStep index={2} title='选择电脑型号'>
              <OsToggle />
            </ManualStep>

            <ManualStep index={3} title='打开 cc-switch 的新建服务商页面'>
              <OfficialInstallLink href={CC_SWITCH_OFFICIAL_URL}>
                未安装？打开 cc-switch 官方下载页
              </OfficialInstallLink>
              <p className='text-muted-foreground text-sm'>
                打开 cc-switch，顶部选择 <strong>Claude Code</strong>，点右上角
                <strong> + </strong>，选择「应用专属服务商 / App-specific
                Provider」，再选「自定义 / Custom」。
              </p>
            </ManualStep>

            <ManualStep index={4} title='粘贴 AnyRouters 配置'>
              <p className='text-muted-foreground text-sm'>
                名称填写 <code className='text-foreground'>AnyRouters</code>。
                点击下面「复制」，把整段 JSON 粘贴到 cc-switch 的 JSON
                编辑框；不要粘贴到
                {shellName}。
              </p>
              <CodeBlock
                code={`{
  "env": {
    "ANTHROPIC_BASE_URL": "${ANTHROPIC_BASE}",
    "ANTHROPIC_AUTH_TOKEN": "${KEY}",
    "ANTHROPIC_MODEL": "${CLAUDE_DEFAULT_MODEL}"
  }
}`}
              />
            </ManualStep>

            <ManualStep index={5} title='保存并启用 AnyRouters'>
              <p className='text-muted-foreground text-sm'>
                点「添加 / Add」保存，回到 Claude Code 服务商列表，找到
                AnyRouters 卡片并点「启用 / Enable」。如果 Claude Code
                正在运行，先退出当前会话。
              </p>
            </ManualStep>

            <ManualStep index={6} title='验证'>
              <p className='text-muted-foreground text-sm'>
                打开一个新的{shellName}窗口，运行{' '}
                <code className='text-foreground'>claude</code>。启动后输入{' '}
                <code className='text-foreground'>hello</code>{' '}
                并按回车；收到回复就表示切换成功。
              </p>
            </ManualStep>
          </div>
        </section>

        <section className='mt-10'>
          <SectionTitle>遇到旧配置冲突？</SectionTitle>
          <details className='border-border bg-muted/20 mt-4 rounded-lg border px-4 py-3'>
            <summary className='cursor-pointer text-sm font-semibold'>
              仍显示旧服务商、鉴权失败或提示模型无效
            </summary>
            <div className='text-muted-foreground mt-4 space-y-3 text-sm leading-6'>
              <p>
                这通常表示旧服务商配置或系统环境变量仍在覆盖当前选择，并不代表
                AnyRouters 配置内容有误。请按下面顺序处理：
              </p>
              <ol className='list-decimal space-y-2 pl-5'>
                <li>完全退出 Claude Code，并关闭正在使用的终端窗口。</li>
                <li>
                  打开 cc-switch 的「通用配置 /
                  General」或环境变量设置，删除已经不再使用的旧服务商开关、旧
                  API 地址、旧鉴权信息以及旧区域、项目或代理配置；不要删除当前
                  AnyRouters 服务商卡片中的配置。
                </li>
                <li>
                  检查系统环境变量和终端启动文件是否还保存着同类旧值；只删除已经确认不再使用的旧配置。
                </li>
                <li>
                  回到 cc-switch，重新启用 AnyRouters，然后彻底关闭并重新打开
                  {shellName}。
                </li>
                <li>
                  重新运行 <code className='text-foreground'>claude</code>
                  ，确认界面不再显示旧服务商名称，再发送{' '}
                  <code className='text-foreground'>hello</code> 验证。
                </li>
              </ol>
              <p>
                <code className='text-foreground'>/model</code>{' '}
                只能切换当前服务商内的模型，不能关闭旧服务商配置或清除环境变量覆盖。
              </p>
            </div>
          </details>
        </section>
      </div>
    </div>
  )
}

function CherryStudioGuide({ apiKey, onApiKeyChange }: GuideProps) {
  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Cherry Studio</h1>
      <p className='text-muted-foreground mt-2 text-sm'>
        在 Cherry Studio 中添加 AnyRouters 模型服务，保存后即可新建聊天。
      </p>
      <div className='mt-8'>
        <section>
          <SectionTitle>配置步骤</SectionTitle>
          <div className='mt-6 space-y-8'>
            <ApiKeyStep
              apiKey={apiKey}
              onApiKeyChange={onApiKeyChange}
              toolName='Cherry Studio'
            />

            <ManualStep index={2} title='安装并打开 Cherry Studio'>
              <OfficialInstallLink href={CHERRY_STUDIO_OFFICIAL_URL}>
                打开 Cherry Studio 官方下载页
              </OfficialInstallLink>
            </ManualStep>

            <ManualStep index={3} title='新建 OpenAI 类型的服务商'>
              <p className='text-muted-foreground text-sm'>
                在 Cherry Studio 左侧点齿轮「设置」→「模型服务」→列表下方「+
                添加」。名称填{' '}
                <code className='text-foreground'>AnyRouters</code>，
                服务商类型选 <strong>OpenAI</strong>，然后点击「添加」。
              </p>
            </ManualStep>

            <ManualStep index={4} title='填写 API Key 和 API 地址'>
              <p className='text-muted-foreground text-sm'>
                在服务商列表里点刚刚新建的 AnyRouters。下面不是一条命令；
                在对应输入框里逐项填写，每项可单独复制。
              </p>
              <ConfigValues
                fields={[
                  { label: 'API Key', value: KEY },
                  { label: 'API 地址 / API Host', value: ANTHROPIC_BASE },
                ]}
              />
            </ManualStep>

            <ManualStep index={5} title='添加模型、启用并检查连接'>
              <p className='text-muted-foreground text-sm'>
                先点左下角「管理」，添加模型{' '}
                <code className='text-foreground'>{CODEX_DEFAULT_MODEL}</code>{' '}
                并打开服务商右上角的启用开关。再点 API Key
                输入框右侧的「检查」；看到连接成功提示后，再进行下一步。
              </p>
            </ManualStep>

            <ManualStep index={6} title='验证'>
              <p className='text-muted-foreground text-sm'>
                回到聊天页新建对话，选择 AnyRouters 的{' '}
                <code className='text-foreground'>{CODEX_DEFAULT_MODEL}</code>
                ，输入 <code className='text-foreground'>hello</code>{' '}
                并发送；收到回复就表示配置完成。
              </p>
            </ManualStep>
          </div>
        </section>
      </div>
    </div>
  )
}

function codexImageInstallCommand(os: OS) {
  if (os === 'windows') {
    return `$SkillRoot = Join-Path $HOME ".codex\\skills"
New-Item -ItemType Directory -Force -Path $SkillRoot | Out-Null
Expand-Archive -Force "$HOME\\Downloads\\anyrouters-image.zip" $SkillRoot
python -m pip install --upgrade openai`
  }

  return `mkdir -p ~/.codex/skills
unzip -o ~/Downloads/anyrouters-image.zip -d ~/.codex/skills
python3 -m pip install --upgrade openai`
}

function CodexImageGuide() {
  const { os } = useOsChoice()
  const shellName = os === 'windows' ? 'PowerShell' : '终端'
  const downloadPath =
    os === 'windows'
      ? '$HOME\\Downloads\\anyrouters-image.zip'
      : '~/Downloads/anyrouters-image.zip'
  const skillPath =
    os === 'windows'
      ? '$HOME\\.codex\\skills\\anyrouters-image'
      : '~/.codex/skills/anyrouters-image'
  const quitText =
    os === 'windows'
      ? '从任务栏托盘或任务管理器完全退出 Codex，只关闭窗口不算退出。'
      : '按 Command-Q 完全退出 Codex，只关闭窗口不算退出。'

  return (
    <div>
      <h1 className='text-2xl font-semibold tracking-tight'>Codex-生图</h1>
      <p className='text-muted-foreground mt-2 text-sm'>
        给 Codex 安装 AnyRouters 生图技能后，可以用同一把 API Key 调用
        gpt-image-2 生成真实图片，也支持参考图改风格、透明背景和局部重绘。
      </p>
      <div className='mt-8 space-y-8'>
        <section className='border-b pb-10'>
          <SectionTitle>快速安装</SectionTitle>
          <div className='mt-6 space-y-8'>
            <ManualStep index={1} title='先完成 Codex 桌面版配置'>
              <p className='text-muted-foreground text-sm'>
                先切换到「Codex-桌面版」教程完成配置，确认可以正常发送 hello
                后，再安装生图技能。
              </p>
            </ManualStep>

            <ManualStep index={2} title='选择电脑型号并下载技能包'>
              <OsToggle />
              <p className='text-muted-foreground text-sm'>
                点击下方按钮。浏览器默认会下载到{' '}
                <code className='text-foreground'>{downloadPath}</code>。
              </p>
              <Button
                variant='outline'
                render={
                  <a
                    href={ANYROUTERS_IMAGE_SKILL_URL}
                    download='anyrouters-image.zip'
                  />
                }
              >
                下载 anyrouters-image 技能包
                <WandSparkles className='size-4' />
              </Button>
            </ManualStep>

            <ManualStep index={3} title='交给 Codex 安装'>
              <p className='text-muted-foreground text-sm'>
                新建一个 Codex 任务，把下载好的 zip 文件拖进对话输入框。
                再点击下面「复制」，把这句话粘贴到同一输入框并发送：
              </p>
              <CodeBlock
                code={`帮我安装这个 anyrouters-image 技能。请把它解压到 Codex skills 目录，安装 Python openai SDK。装好后提醒我完全退出并重启 Codex。`}
              />
              <p className='text-muted-foreground text-sm'>
                等 Codex 明确回复“安装完成”后，再进行下一步。
              </p>
            </ManualStep>

            <ManualStep index={4} title='重启 Codex'>
              <p className='text-muted-foreground text-sm'>
                {quitText}然后重新打开 Codex，并新建一个任务。
              </p>
            </ManualStep>

            <ManualStep index={5} title='验证'>
              <p className='text-muted-foreground text-sm'>
                在重启后的新任务里发送：
              </p>
              <CodeBlock code='生成一张图：一只极简风格的 AnyRouters 机器人头像' />
              <p className='text-muted-foreground text-sm'>
                图片生成后会保存到桌面「AnyRouters图片」文件夹并自动打开；看到图片就表示安装成功。
              </p>
            </ManualStep>
          </div>
        </section>

        <section className='pt-10'>
          <SectionTitle>自动安装失败？使用手动安装</SectionTitle>
          <div className='mt-6 space-y-8'>
            <ManualStep index={1} title='确认下载文件'>
              <OsToggle />
              <p className='text-muted-foreground text-sm'>
                确认技能包位于{' '}
                <code className='text-foreground'>{downloadPath}</code>。
                如果你改过浏览器的下载位置，先把文件移到 Downloads 文件夹。
              </p>
            </ManualStep>

            <ManualStep index={2} title={`在${shellName}运行安装命令`}>
              <p className='text-muted-foreground text-sm'>
                打开{shellName}，点击下面「复制」，把整段粘贴进去并按回车。
                技能会安装到{' '}
                <code className='text-foreground'>{skillPath}</code>。
              </p>
              <CodeBlock code={codexImageInstallCommand(os)} />
              {os === 'windows' && (
                <p className='text-muted-foreground text-sm'>
                  如果提示没有 python，请先安装 Python，然后重新执行上面命令。
                </p>
              )}
            </ManualStep>

            <ManualStep index={3} title='重启并验证'>
              <p className='text-muted-foreground text-sm'>
                {quitText}重新打开 Codex 并新建任务，再使用上方第 5
                步的提示词验证。
              </p>
            </ManualStep>
          </div>
        </section>
      </div>
    </div>
  )
}

type GuideEntry = {
  id: string
  label: string
  icon: LucideIcon
  render: (props: GuideProps) => ReactNode
}

const GUIDES: GuideEntry[] = [
  {
    id: 'claude-code',
    label: 'Claude Code-终端版',
    icon: SquareTerminal,
    render: (props) => (
      <ToolGuide
        {...props}
        title='Claude Code-终端版'
        description=''
        tool='claude'
        toolName='Claude Code'
        developerKind='claude'
        withLinux
      />
    ),
  },
  {
    id: 'codex-desktop',
    label: 'Codex-桌面版',
    icon: AppWindow,
    render: (props) => (
      <ToolGuide
        {...props}
        title='Codex-桌面版'
        description=''
        tool='codex-config'
        toolName='Codex Desktop'
        developerKind='codex-desktop'
        desktopDownload
      />
    ),
  },
  {
    id: 'codex-cli',
    label: 'Codex-终端版',
    icon: MessageSquareCode,
    render: (props) => (
      <ToolGuide
        {...props}
        title='Codex-终端版'
        description=''
        tool='codex'
        toolName='Codex CLI'
        developerKind='codex-cli'
        withLinux
      />
    ),
  },
  {
    id: 'codex-history',
    label: 'Codex-聊天迁移',
    icon: History,
    render: () => <CodexHistoryGuide />,
  },
  {
    id: 'codex-image',
    label: 'Codex-生图',
    icon: WandSparkles,
    render: () => (
      <OsProvider>
        <CodexImageGuide />
      </OsProvider>
    ),
  },
  {
    id: 'cc-switch',
    label: 'cc-switch切换器',
    icon: SquareTerminal,
    render: (props) => (
      <OsProvider withLinux>
        <CcSwitchGuide {...props} />
      </OsProvider>
    ),
  },
  {
    id: 'cherry-studio',
    label: 'Cherry Studio聊天',
    icon: MonitorSmartphone,
    render: (props) => <CherryStudioGuide {...props} />,
  },
]

export function Docs() {
  const [active, setActive] = useState('codex-desktop')
  const [apiKey, setApiKey] = useState('')
  const activeGuide = GUIDES.find((guide) => guide.id === active) ?? GUIDES[0]

  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto flex w-full max-w-6xl gap-8 px-6 py-10'>
        <nav className='hidden w-52 shrink-0 sm:block'>
          <p className='text-muted-foreground px-2 text-xs font-medium'>
            快速接入：
          </p>
          <div className='mt-3 space-y-1'>
            {GUIDES.map((guide) => {
              const Icon = guide.icon
              return (
                <button
                  key={guide.id}
                  type='button'
                  onClick={() => setActive(guide.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    active === guide.id
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className='size-4 shrink-0' />
                  <span className='truncate'>{guide.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        <main className='min-w-0 flex-1'>
          <div className='mb-6 flex flex-wrap gap-2 sm:hidden'>
            {GUIDES.map((guide) => (
              <button
                key={guide.id}
                type='button'
                onClick={() => setActive(guide.id)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs transition-colors',
                  active === guide.id
                    ? 'border-foreground bg-foreground text-background'
                    : 'text-muted-foreground'
                )}
              >
                {guide.label}
              </button>
            ))}
          </div>
          <KeyContext.Provider value={apiKey}>
            {activeGuide.render({
              apiKey,
              onApiKeyChange: setApiKey,
            })}
          </KeyContext.Provider>
        </main>
      </div>
    </div>
  )
}
