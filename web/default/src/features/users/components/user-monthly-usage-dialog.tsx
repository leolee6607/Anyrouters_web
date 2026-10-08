import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatUserCode } from '@/lib/user-code'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/dialog'
import {
  currentUsageYear,
  previousUsageMonth,
  downloadMonthlyUsage,
  downloadUsageBreakdown,
  usageBreakdownPeriod,
  type UsageIdentity,
  type UsageView,
  getUserMonthlyUsage,
} from '../monthly-usage'
import { MonthlyUsageTable } from './monthly-usage-table'
import { UsageBreakdownTable } from './usage-breakdown-table'

export function UserMonthlyUsageDialog(props: {
  user: UsageIdentity
  initialView?: UsageView
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const currentYear = currentUsageYear()
  const defaultPeriod = previousUsageMonth()
  const [year, setYear] = useState(defaultPeriod.year)
  const [view, setView] = useState<UsageView>(props.initialView ?? 'monthly')
  const [period, setPeriod] = useState(defaultPeriod.period)
  const query = useQuery({
    queryKey: ['user-monthly-usage', props.user.id, year],
    queryFn: () => getUserMonthlyUsage(props.user.id, year),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  const data = query.data
  const selected = data ? usageBreakdownPeriod(data, period) : undefined
  const canExport =
    !!data &&
    !query.isFetching &&
    !query.isError &&
    (view === 'monthly' || (!!selected?.models && !!selected.channels))
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('User consumption statistics')}
      description={`${formatUserCode(props.user.id)} · ${props.user.display_name || props.user.username} · ${props.user.username}`}
      contentClassName='sm:max-w-5xl'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <Button variant='outline' onClick={props.onClose}>
          {t('Close')}
        </Button>
      }
    >
      <div className='flex flex-wrap items-center gap-3'>
        <Label htmlFor='usage-year'>{t('Billing year')}</Label>
        <select
          id='usage-year'
          className='bg-background rounded-md border px-3 py-2 text-sm'
          value={year}
          onChange={(event) => {
            setYear(Number(event.target.value))
            setPeriod('year')
          }}
        >
          {Array.from(
            { length: currentYear - 1999 },
            (_, index) => currentYear - index
          ).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Button
          variant='outline'
          size='sm'
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch()
          }}
        >
          {t('Refresh')}
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={!canExport}
          onClick={() => {
            if (!data) return
            if (view === 'monthly') downloadMonthlyUsage(data)
            else downloadUsageBreakdown(data, period, view)
          }}
        >
          {t('Export CSV')}
        </Button>
      </div>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Actual website charges after discounts, less recorded refunds. Includes all API keys for this user; not recharge payments or cloud provider costs.'
        )}
      </p>
      {query.isPending && <p role='status'>{t('Loading...')}</p>}
      {query.isError && (
        <p role='alert' className='text-destructive'>
          {t('Unable to load monthly usage. Please retry.')}
        </p>
      )}
      {data && !query.isError && (
        <>
          <p className='text-muted-foreground text-xs'>
            {t('As of {{time}} · Beijing time (UTC+8)', {
              time: new Date(data.as_of * 1000).toLocaleString(i18n.language, {
                timeZone: 'Asia/Shanghai',
                hour12: false,
              }),
            })}
          </p>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Totals follow the selected year and period, not lifetime usage.'
            )}
          </p>
          <div className='flex flex-wrap items-center gap-3'>
            <Label htmlFor='usage-view'>{t('Report view')}</Label>
            <select
              id='usage-view'
              className='bg-background rounded-md border px-3 py-2 text-sm'
              value={view}
              onChange={(event) => setView(event.target.value as UsageView)}
            >
              <option value='monthly'>{t('Monthly statement')}</option>
              <option value='models'>{t('By model')}</option>
              <option value='channels'>{t('By channel')}</option>
            </select>
            {view !== 'monthly' && (
              <>
                <Label htmlFor='usage-period'>{t('Report period')}</Label>
                <select
                  id='usage-period'
                  className='bg-background rounded-md border px-3 py-2 text-sm'
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                >
                  <option value='year'>{t('Selected year total')}</option>
                  {[...data.months].reverse().map((month) => (
                    <option key={month.month} value={month.month}>
                      {month.month}
                      {month.in_progress ? ` · ${t('Month to date')}` : ''}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          {view === 'monthly' ? (
            <MonthlyUsageTable key={year} report={data} />
          ) : (
            <UsageBreakdownTable report={data} period={period} view={view} />
          )}
        </>
      )}
      <p className='text-muted-foreground text-xs'>
        {t(
          'Based on retained consumption and refund logs. Deleted or unrecorded usage is not included; channel names reflect current settings.'
        )}
      </p>
    </Dialog>
  )
}
