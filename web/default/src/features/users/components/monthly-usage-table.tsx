import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { formatUsageUSD, type UserMonthlyUsage } from '../monthly-usage'

export function MonthlyUsageTable(props: { report: UserMonthlyUsage }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (month: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }
  return (
    <div className='overflow-x-auto rounded-lg border'>
      <table className='w-full text-sm'>
        <caption className='sr-only'>
          {t('Monthly website consumption')}
        </caption>
        <thead className='bg-muted/50 text-muted-foreground'>
          <tr>
            <th className='p-3 text-left'>{t('Month / channel')}</th>
            <th className='p-3 text-right'>{t('Charges (USD)')}</th>
            <th className='p-3 text-right'>{t('Refunds (USD)')}</th>
            <th className='p-3 text-right'>{t('Net consumption (USD)')}</th>
            <th className='p-3 text-right'>{t('Consumption records')}</th>
          </tr>
        </thead>
        <tbody>
          {[...props.report.months].reverse().map((month) => (
            <Fragment key={month.month}>
              <tr className='border-t'>
                <td className='min-w-44 p-2'>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => toggle(month.month)}
                    disabled={month.channels.length === 0}
                    aria-expanded={expanded.has(month.month)}
                    aria-label={t('Channel breakdown for {{month}}', {
                      month: month.month,
                    })}
                  >
                    {expanded.has(month.month) ? (
                      <ChevronDown className='size-4' />
                    ) : (
                      <ChevronRight className='size-4' />
                    )}
                    {month.month}
                    {month.in_progress && (
                      <span className='text-muted-foreground text-xs'>
                        {t('Month to date')}
                      </span>
                    )}
                  </Button>
                  {month.channels.length === 0 && (
                    <p className='text-muted-foreground px-3 text-xs'>
                      {t('No consumption records')}
                    </p>
                  )}
                </td>
                <td className='p-3 text-right font-mono whitespace-nowrap tabular-nums'>
                  {formatUsageUSD(month.consume_usd)}
                </td>
                <td className='p-3 text-right font-mono whitespace-nowrap tabular-nums'>
                  {formatUsageUSD(month.refund_usd)}
                </td>
                <td className='p-3 text-right font-mono font-medium whitespace-nowrap tabular-nums'>
                  {formatUsageUSD(month.net_usd)}
                </td>
                <td className='p-3 text-right tabular-nums'>
                  {month.consume_records.toLocaleString()}
                </td>
              </tr>
              {expanded.has(month.month) &&
                month.channels.map((channel) => (
                  <tr key={channel.channel_id} className='bg-muted/20 border-t'>
                    <td className='max-w-72 py-3 pr-3 pl-8 break-words'>
                      #{channel.channel_id} ·{' '}
                      {channel.channel_name || t('Unnamed or deleted channel')}
                    </td>
                    <td className='p-3 text-right font-mono whitespace-nowrap tabular-nums'>
                      {formatUsageUSD(channel.consume_usd)}
                    </td>
                    <td className='p-3 text-right font-mono whitespace-nowrap tabular-nums'>
                      {formatUsageUSD(channel.refund_usd)}
                    </td>
                    <td className='p-3 text-right font-mono whitespace-nowrap tabular-nums'>
                      {formatUsageUSD(channel.net_usd)}
                    </td>
                    <td className='p-3 text-right tabular-nums'>
                      {channel.consume_records.toLocaleString()}
                    </td>
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot className='bg-muted/50 border-t font-medium'>
          <tr>
            <td className='p-3'>{t('Year total')}</td>
            <td className='p-3 text-right font-mono whitespace-nowrap'>
              {formatUsageUSD(props.report.total.consume_usd)}
            </td>
            <td className='p-3 text-right font-mono whitespace-nowrap'>
              {formatUsageUSD(props.report.total.refund_usd)}
            </td>
            <td className='p-3 text-right font-mono whitespace-nowrap'>
              {formatUsageUSD(props.report.total.net_usd)}
            </td>
            <td className='p-3 text-right'>
              {props.report.total.consume_records.toLocaleString()}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
