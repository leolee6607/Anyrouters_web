import { describe, expect, test } from 'bun:test'
import { formatUsageUSD, monthlyUsageCSV, type UserMonthlyUsage } from '../src/features/users/monthly-usage'

describe('monthly consumption display and exports', () => {
  test('preserves amounts beyond JavaScript integer precision and sub-cent charges', () => {
    expect(formatUsageUSD('9007199254740993.000002')).toBe('$9,007,199,254,740,993.000002')
    expect(formatUsageUSD('3358.249884')).toBe('$3,358.249884')
    expect(formatUsageUSD('-0.50')).toBe('$-0.50')
    expect(formatUsageUSD('0')).toBe('$0.00')
    expect(formatUsageUSD('NaN')).toBe('—')
  })
  test('exports original amounts, account and timestamp without spreadsheet formulas', () => {
    const amounts = { consume_usd: '1.000002', refund_usd: '2', net_usd: '-0.999998', requests: 1, refunds: 1 }
    const report: UserMonthlyUsage = { user_id: 31, username: '=1+1', display_name: ' @SUM(1)', year: 2026, timezone: 'Asia/Shanghai', currency: 'USD', as_of: 1791430309, total: amounts, months: [{ month: '2026-09', in_progress: false, ...amounts, channels: [{ channel_id: 3, channel_name: 'Azure,"test"\n=2', ...amounts }] }] }
    const csv = monthlyUsageCSV(report)
    expect(csv).toContain('AR000031')
    expect(csv).toContain('"\'=1+1"')
    expect(csv).toContain('"\' @SUM(1)"')
    expect(csv).toContain('"Azure,""test""\n=2"')
    expect(csv).toContain('"1.000002","2","-0.999998"')
    expect(csv).toContain('Asia/Shanghai')
    expect(csv).toContain('2026-10-08T03:31:49.000Z')
  })
})
