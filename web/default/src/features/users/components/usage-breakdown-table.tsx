import { useTranslation } from 'react-i18next'
import {
  formatUsageUSD,
  usageBreakdownPeriod,
  type UserMonthlyUsage,
  type UsageBreakdownView,
} from '../monthly-usage'

export function UsageBreakdownTable(props: {
  report: UserMonthlyUsage
  period: string
  view: UsageBreakdownView
}) {
  const { t } = useTranslation()
  const selected = usageBreakdownPeriod(props.report, props.period)
  const rows = selected?.[props.view]
  if (!selected || !rows) {
    return (
      <p role='alert'>
        {t('Usage breakdown is not available. Please refresh.')}
      </p>
    )
  }
  const simple = props.view === 'providers'
  let title = t('By channel')
  if (props.view === 'models') title = t('By model')
  if (simple) title = t('Consumption source')
  const providerNames: Record<string, string> = {
    azure: 'Azure',
    google: t('Google / Gemini'),
    aws: t('AWS / Bedrock'),
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    other: t('Other / unclassified channels'),
  }
  return (
    <div className='space-y-3'>
      <div className='bg-muted/40 grid grid-cols-1 gap-3 rounded-lg p-4 sm:grid-cols-3'>
        {[
          { label: t('Charges (USD)'), value: selected.consume_usd },
          { label: t('Refunds (USD)'), value: selected.refund_usd },
          { label: t('Net consumption (USD)'), value: selected.net_usd },
        ].map((item) => (
          <div key={item.label} className='space-y-1'>
            <p className='text-muted-foreground text-xs'>{item.label}</p>
            <p className='font-mono text-base font-semibold tabular-nums'>
              {formatUsageUSD(item.value)}
            </p>
          </div>
        ))}
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Share = charges for this group / all charges in the selected period, before refunds. Percentages are rounded separately; — means no charges.'
        )}
      </p>
      <div className='overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>
          <caption className='sr-only'>{title}</caption>
          <thead className='bg-muted/50 text-muted-foreground'>
            <tr>
              <th className='p-3 text-left'>{title}</th>
              <th className='p-3 text-right'>{t('Charges (USD)')}</th>
              <th className='p-3 text-right'>{t('Charge share')}</th>
              {!simple && (
                <>
                  <th className='p-3 text-right'>{t('Refunds (USD)')}</th>
                  <th className='p-3 text-right'>
                    {t('Net consumption (USD)')}
                  </th>
                  <th className='p-3 text-right'>{t('Consumption records')}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={simple ? 3 : 6}
                  className='text-muted-foreground p-6 text-center'
                >
                  {t('No consumption records')}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              let key: string
              let name: string
              if ('model_name' in row) {
                key = row.model_name
                name = row.model_name || t('Model not recorded')
              } else if ('channel_id' in row) {
                key = String(row.channel_id)
                name = `#${row.channel_id} · ${row.channel_name || t('Unnamed or deleted channel')}`
              } else {
                key = row.provider
                name = providerNames[row.provider] || row.provider
              }
              return (
                <tr key={key} className='border-t'>
                  <td className='max-w-72 min-w-44 p-3 break-words'>{name}</td>
                  <td className='p-3 text-right font-mono whitespace-nowrap tabular-nums'>
                    {formatUsageUSD(row.consume_usd)}
                  </td>
                  <td className='p-3 text-right font-mono whitespace-nowrap tabular-nums'>
                    {row.charge_share_percent
                      ? `${row.charge_share_percent}%`
                      : '—'}
                  </td>
                  {!simple && (
                    <>
                      <td className='p-3 text-right font-mono whitespace-nowrap tabular-nums'>
                        {formatUsageUSD(row.refund_usd)}
                      </td>
                      <td className='p-3 text-right font-mono whitespace-nowrap tabular-nums'>
                        {formatUsageUSD(row.net_usd)}
                      </td>
                      <td className='p-3 text-right tabular-nums'>
                        {row.consume_records.toLocaleString()}
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {props.view === 'models' && (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Model names come from historical logs. Consumption record counts include supplemental charges and are not API call counts.'
          )}
        </p>
      )}
      {simple && (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Sources follow current channel types. Azure channels are combined; unclassified or deleted channels stay in Other. For individual records, switch to Detailed.'
          )}
        </p>
      )}
    </div>
  )
}
