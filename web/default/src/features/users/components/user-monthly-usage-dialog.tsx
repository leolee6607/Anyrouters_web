import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatUserCode } from '@/lib/user-code'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/dialog'
import {
  currentUsageYear,
  downloadMonthlyUsage,
  getUserMonthlyUsage,
} from '../monthly-usage'
import type { User } from '../types'
import { MonthlyUsageTable } from './monthly-usage-table'

export function UserMonthlyUsageDialog(props: {
  user: User
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const currentYear = currentUsageYear()
  const [year, setYear] = useState(currentYear)
  const query = useQuery({
    queryKey: ['user-monthly-usage', props.user.id, year],
    queryFn: () => getUserMonthlyUsage(props.user.id, year),
    staleTime: 0,
    retry: false,
  })
  const data = query.data
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Monthly website consumption')}
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
        <Label htmlFor='usage-year'>{t('Year')}</Label>
        <select
          id='usage-year'
          className='bg-background rounded-md border px-3 py-2 text-sm'
          value={year}
          onChange={(event) => setYear(Number(event.target.value))}
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
          disabled={!data || query.isFetching || query.isError}
          onClick={() => {
            if (data) downloadMonthlyUsage(data)
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
          <MonthlyUsageTable report={data} />
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
