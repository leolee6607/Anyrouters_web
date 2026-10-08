import { api } from '@/lib/api'
import { formatUserCode } from '@/lib/user-code'
import type { ApiResponse } from './types'

export interface UsageAmounts {
  consume_usd: string
  refund_usd: string
  net_usd: string
  consume_records: number
  refunds: number
}
export interface UsageBreakdownAmounts extends UsageAmounts {
  charge_share_percent: string
}
export interface UsageProvider extends UsageBreakdownAmounts {
  provider: string
}
export interface UsageModel extends UsageBreakdownAmounts {
  model_name: string
}
export interface UsageChannel extends UsageBreakdownAmounts {
  channel_id: number
  channel_name: string
}
export interface UsageMonth extends UsageAmounts {
  month: string
  in_progress: boolean
  channels: UsageChannel[]
  models: UsageModel[]
  providers: UsageProvider[]
}
export interface UserMonthlyUsage {
  user_id: number
  username: string
  display_name: string
  year: number
  timezone: string
  currency: 'USD'
  as_of: number
  months: UsageMonth[]
  total: UsageAmounts
  channels: UsageChannel[]
  models: UsageModel[]
  providers: UsageProvider[]
}
export type UsageView = 'monthly' | 'models' | 'channels'
export type UsageBreakdownView = 'models' | 'channels' | 'providers'
export type UsageIdentity = {
  id: number
  username: string
  display_name?: string
}
export async function getUserMonthlyUsage(
  userId: number,
  year: number
): Promise<UserMonthlyUsage> {
  const response = await api.get<ApiResponse<UserMonthlyUsage>>(
    `/api/user/${userId}/monthly-usage`,
    { params: { year } }
  )
  if (!response.data.success || !response.data.data)
    throw new Error(response.data.message || 'Unable to load monthly usage')
  return response.data.data
}
export function currentUsageYear(): number {
  return Number(
    new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
    }).format(new Date())
  )
}
export function previousUsageMonth(now = new Date()): {
  year: number
  period: string
} {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now)
  let year = Number(parts.find((part) => part.type === 'year')?.value)
  let month = Number(parts.find((part) => part.type === 'month')?.value) - 1
  if (month === 0) {
    year -= 1
    month = 12
  }
  return { year, period: `${year}-${String(month).padStart(2, '0')}` }
}
export function formatUsageUSD(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return '—'
  const [whole, rawFraction = ''] = value.split('.')
  const fraction = rawFraction.replace(/0+$/, '').padEnd(2, '0')
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`
}
function csvCell(value: string, numeric = false): string {
  const safeNumeric = numeric && /^-?\d+(\.\d+)?$/.test(value)
  // Reject spreadsheet formulas even after leading control/whitespace characters.
  // eslint-disable-next-line no-control-regex
  const formulaPrefix = /^[\s\u0000-\u001f]*[=+@\-\t\r\n]/.test(value)
  const safe = !safeNumeric && formulaPrefix ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}
export function monthlyUsageCSV(report: UserMonthlyUsage): string {
  const header = [
    'user_code',
    'display_name',
    'username',
    'month',
    'channel_id',
    'channel_name',
    'consume_usd',
    'refund_usd',
    'net_usd',
    'consume_records',
    'refunds',
    'timezone',
    'as_of_utc',
    'basis',
  ]
  const rows = report.months.flatMap((month) =>
    month.channels.map((channel) => {
      const cells = [
        formatUserCode(report.user_id),
        report.display_name,
        report.username,
        month.month,
        String(channel.channel_id),
        channel.channel_name,
        channel.consume_usd,
        channel.refund_usd,
        channel.net_usd,
        String(channel.consume_records),
        String(channel.refunds),
        report.timezone,
        new Date(report.as_of * 1000).toISOString(),
        'retained_site_consume_and_refund_logs',
      ]
      return cells
        .map((value, index) => csvCell(value, index >= 6 && index <= 10))
        .join(',')
    })
  )
  return '\uFEFF' + [header.join(','), ...rows].join('\r\n') + '\r\n'
}
export function usageBreakdownPeriod(report: UserMonthlyUsage, period: string) {
  if (period === 'year')
    return {
      ...report.total,
      channels: report.channels,
      models: report.models,
      providers: report.providers,
    }
  return report.months.find((month) => month.month === period)
}
export function usageBreakdownCSV(
  report: UserMonthlyUsage,
  period: string,
  view: UsageBreakdownView
): string {
  const selected = usageBreakdownPeriod(report, period)
  const groups = selected?.[view]
  if (!selected || !groups) throw new Error('Usage breakdown unavailable')
  const header = [
    'user_code',
    'display_name',
    'username',
    'period',
    'dimension',
    'model_name',
    'channel_id',
    'channel_name',
    'consume_usd',
    'refund_usd',
    'net_usd',
    'charge_share_percent',
    'period_consume_usd',
    'consume_records',
    'refunds',
    'timezone',
    'as_of_utc',
    'basis',
    'share_basis',
    'row_kind',
    'provider',
  ]
  // Keep account/period/as-of metadata even for a verified zero-usage period.
  const rows = (groups.length ? groups : [null]).map((group) => {
    const amounts = group ?? selected
    const cells = [
      formatUserCode(report.user_id),
      report.display_name,
      report.username,
      period === 'year' ? String(report.year) : period,
      view,
      group && 'model_name' in group ? group.model_name : '',
      group && 'channel_id' in group ? String(group.channel_id) : '',
      group && 'channel_name' in group ? group.channel_name : '',
      amounts.consume_usd,
      amounts.refund_usd,
      amounts.net_usd,
      group?.charge_share_percent ?? '',
      selected.consume_usd,
      String(amounts.consume_records),
      String(amounts.refunds),
      report.timezone,
      new Date(report.as_of * 1000).toISOString(),
      'retained_site_consume_and_refund_logs',
      'gross_consumption_before_refunds',
      group ? 'detail' : 'empty_period',
      group && 'provider' in group ? group.provider : '',
    ]
    return cells
      .map((value, index) => csvCell(value, index >= 8 && index <= 14))
      .join(',')
  })
  return '\uFEFF' + [header.join(','), ...rows].join('\r\n') + '\r\n'
}
function downloadCSV(csv: string, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8' })
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function downloadMonthlyUsage(report: UserMonthlyUsage): void {
  downloadCSV(
    monthlyUsageCSV(report),
    `${formatUserCode(report.user_id)}-${report.year}-site-usage.csv`
  )
}
export function downloadUsageBreakdown(
  report: UserMonthlyUsage,
  period: string,
  view: UsageBreakdownView
): void {
  downloadCSV(
    usageBreakdownCSV(report, period, view),
    `${formatUserCode(report.user_id)}-${period === 'year' ? report.year : period}-${view}.csv`
  )
}
