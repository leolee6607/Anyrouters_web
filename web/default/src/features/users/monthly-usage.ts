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
export interface UsageChannel extends UsageAmounts {
  channel_id: number
  channel_name: string
}
export interface UsageMonth extends UsageAmounts {
  month: string
  in_progress: boolean
  channels: UsageChannel[]
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
export function downloadMonthlyUsage(report: UserMonthlyUsage): void {
  const url = URL.createObjectURL(
    new Blob([monthlyUsageCSV(report)], { type: 'text/csv;charset=utf-8' })
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${formatUserCode(report.user_id)}-${report.year}-site-usage.csv`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
