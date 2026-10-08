import { describe, expect, test } from 'bun:test'
import {
  formatUsageUSD,
  previousUsageMonth,
  monthlyUsageCSV,
  usageBreakdownCSV,
  usageBreakdownPeriod,
  type UserMonthlyUsage,
} from '../src/features/users/monthly-usage'

const september = {
  consume_usd: '1.000002', refund_usd: '2', net_usd: '-0.999998',
  consume_records: 1, refunds: 1,
}
const annual = {
  consume_usd: '4.000002', refund_usd: '2', net_usd: '2.000002',
  consume_records: 3, refunds: 1,
}
const report: UserMonthlyUsage = {
  user_id: 31, username: '=1+1', display_name: ' @SUM(1)', year: 2026,
  timezone: 'Asia/Shanghai', currency: 'USD', as_of: 1791430309,
  total: annual,
  providers: [{ provider: "azure", charge_share_percent: "100.00", ...annual }],
  channels: [{ channel_id: 3, channel_name: 'Azure', charge_share_percent: '100.00', ...annual }],
  models: [{ model_name: '=MODEL()', charge_share_percent: '100.00', ...annual }],
  months: [{
    month: '2026-09', in_progress: false, ...september,
    providers: [{ provider: 'azure', charge_share_percent: '100.00', ...september }],
    channels: [{ channel_id: 3, channel_name: 'Azure,"test"\n=2', charge_share_percent: '100.00', ...september }],
    models: [{ model_name: '=MODEL()', charge_share_percent: '100.00', ...september }],
  }],
}

describe('monthly consumption display and exports', () => {
  test('defaults to the previous completed Beijing month, including January rollover', () => {
    expect(previousUsageMonth(new Date('2026-10-08T04:00:00Z'))).toEqual({ year: 2026, period: '2026-09' })
    expect(previousUsageMonth(new Date('2026-12-31T16:00:00Z'))).toEqual({ year: 2026, period: '2026-12' })
    expect(previousUsageMonth(new Date('2026-09-30T15:59:59Z'))).toEqual({ year: 2026, period: '2026-08' })
  })
  test('preserves amounts beyond JavaScript integer precision and sub-cent charges', () => {
    expect(formatUsageUSD('9007199254740993.000002')).toBe('$9,007,199,254,740,993.000002')
    expect(formatUsageUSD('3358.249884')).toBe('$3,358.249884')
    expect(formatUsageUSD('-0.50')).toBe('$-0.50')
    expect(formatUsageUSD('0')).toBe('$0.00')
    expect(formatUsageUSD('NaN')).toBe('—')
  })
  test('exports original monthly amounts, account and timestamp without spreadsheet formulas', () => {
    const csv = monthlyUsageCSV(report)
    expect(csv).toContain('AR000031')
    expect(csv).toContain('"\'=1+1"')
    expect(csv).toContain('"\' @SUM(1)"')
    expect(csv).toContain('"Azure,""test""\n=2"')
    expect(csv).toContain('"1.000002","2","-0.999998"')
    expect(csv).not.toContain('4.000002')
    expect(csv).toContain('Asia/Shanghai')
    expect(csv).toContain('2026-10-08T03:31:49.000Z')
  })
  test('model export uses the selected month and gross charge denominator, with safe names', () => {
    const csv = usageBreakdownCSV(report, '2026-09', 'models')
    expect(csv).toContain('charge_share_percent,period_consume_usd')
    expect(csv).toContain('"2026-09","models","\'=MODEL()","",""')
    expect(csv).toContain('"1.000002","2","-0.999998","100.00","1.000002"')
    expect(csv).toContain('gross_consumption_before_refunds')
    expect(csv).toContain('2026-10-08T03:31:49.000Z')
    expect(csv).not.toContain('4.000002')
    expect(csv).not.toContain('Azure')
  })
  test('annual channel export uses annual totals, not a sum of model and channel rows', () => {
    const csv = usageBreakdownCSV(report, 'year', 'channels')
    expect(csv).toContain('"2026","channels","","3","Azure"')
    expect(csv).toContain('"4.000002","2","2.000002","100.00","4.000002"')
    expect(csv).not.toContain('MODEL()')
    expect(csv.trim().split('\r\n')).toHaveLength(2)
    expect(usageBreakdownPeriod(report, 'year')?.consume_usd).toBe('4.000002')
  })
  test('zero usage exports a traceable empty-period row instead of a header-only file', () => {
    const zero = { consume_usd: '0', refund_usd: '0', net_usd: '0', consume_records: 0, refunds: 0 }
    const empty: UserMonthlyUsage = { ...report, months: [{ month: '2026-08', in_progress: false, ...zero, models: [], channels: [], providers: [] }] }
    for (const view of ['models', 'channels', 'providers'] as const) {
      const csv = usageBreakdownCSV(empty, '2026-08', view)
      expect(csv).toContain('AR000031')
      expect(csv).toContain('2026-08')
      expect(csv).toContain('2026-10-08T03:31:49.000Z')
      expect(csv).toContain('"0","0","0","","0","0","0"')
      expect(csv).toContain('"empty_period"')
      expect(csv.trim().split('\r\n')).toHaveLength(2)
    }
  })
  test('simple source export uses exactly the same month total as the detailed export', () => {
    const csv = usageBreakdownCSV(report, '2026-09', 'providers')
    expect(csv).toContain('"2026-09","providers"')
    expect(csv).toContain('"1.000002","2","-0.999998","100.00","1.000002"')
    expect(csv).toContain('"detail","azure"')
    expect(csv).not.toContain('4.000002')
  })
  test('missing period or old API response cannot export a misleading empty report', () => {
    expect(() => usageBreakdownCSV(report, '2026-08', 'models')).toThrow('Usage breakdown unavailable')
    const olderResponse = { ...report, models: undefined } as unknown as UserMonthlyUsage
    expect(() => usageBreakdownCSV(olderResponse, 'year', 'models')).toThrow('Usage breakdown unavailable')
  })
})
