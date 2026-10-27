/*
Copyright (C) 2023-2026 QuantumNous
SPDX-License-Identifier: AGPL-3.0-or-later
*/
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatUserCode } from '@/lib/user-code'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  getB2BBalanceAlerts,
  saveB2BBalanceAlert,
  testB2BBalanceAlert,
  type B2BBalanceAlert,
  type B2BBalanceAlertInput,
  type B2BAlertTestResult,
  type B2BCustomer,
} from '../api'
import {
  balanceAlertFormSchema,
  parseReminderRecipients,
  type BalanceAlertFormValues,
} from '../lib/balance-alert-form'

export function B2BBalanceAlertPanel(props: {
  group: string
  customers: B2BCustomer[]
}) {
  const { t } = useTranslation()
  const [userID, setUserID] = useState(props.customers[0]?.id ?? 0)
  const query = useQuery({
    queryKey: ['btob-balance-alerts', props.group],
    queryFn: () => getB2BBalanceAlerts(props.group),
  })
  const customer = props.customers.find((item) => item.id === userID)
  const rule = query.data?.data.find((item) => item.user_id === userID)

  return (
    <div className='space-y-5'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Monitor the selected customer’s account balance across all API keys. Each customer has separate reminder settings.'
        )}
      </p>
      <div className='space-y-2'>
        <Label htmlFor='balance-alert-customer'>
          {t('Customer to monitor')}
        </Label>
        <Select
          value={String(userID)}
          onValueChange={(value) => value && setUserID(Number(value))}
          items={props.customers.map((item) => ({
            value: String(item.id),
            label: `${formatUserCode(item.id)} · ${item.display_name || item.username}`,
          }))}
        >
          <SelectTrigger id='balance-alert-customer' className='w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {props.customers.map((item) => (
              <SelectItem key={item.id} value={String(item.id)}>
                {formatUserCode(item.id)} · {item.display_name || item.username}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {query.isPending && <Spinner />}
      {query.isError && (
        <Button variant='outline' onClick={() => query.refetch()}>
          {t('Retry')}
        </Button>
      )}
      {query.isSuccess && customer && (
        <BalanceAlertForm
          key={`${userID}:${rule?.revision ?? 0}`}
          group={props.group}
          customer={customer}
          rule={rule}
        />
      )}
    </div>
  )
}

function BalanceAlertForm(props: {
  group: string
  customer: B2BCustomer
  rule?: B2BBalanceAlert
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const saved = props.rule?.group === props.group ? props.rule : undefined
  const form = useForm<BalanceAlertFormValues>({
    resolver: zodResolver(balanceAlertFormSchema(t)),
    defaultValues: {
      enabled: saved?.enabled ?? false,
      threshold: String((saved?.threshold_quota ?? 50_000_000) / 500_000),
      emails: saved?.recipients.join('\n') ?? '',
    },
  })
  const [testResult, setTestResult] = useState<B2BAlertTestResult | null>(null)

  function payload(values: BalanceAlertFormValues): B2BBalanceAlertInput {
    return {
      group: props.group,
      user_id: props.customer.id,
      enabled: values.enabled,
      threshold_quota: Math.round(Number(values.threshold) * 500_000),
      recipients: parseReminderRecipients(values.emails),
      revision: props.rule?.revision ?? 0,
    }
  }

  const save = useMutation({
    mutationFn: saveB2BBalanceAlert,
    onSuccess: () => {
      toast.success(t('Reminder settings saved'))
      queryClient.invalidateQueries({
        queryKey: ['btob-balance-alerts', props.group],
      })
    },
  })
  const test = useMutation({
    mutationFn: testB2BBalanceAlert,
    onSuccess: (response) => {
      setTestResult(response.data)
      if (response.data.failed.length > 0)
        toast.error(
          t('Some test emails could not be sent. Check the results below.')
        )
      else
        toast.success(
          t('Test email sent. Please check your inbox and spam folder.')
        )
    },
  })
  const busy = save.isPending || test.isPending

  return (
    <form
      className='space-y-5'
      onSubmit={form.handleSubmit((values) => save.mutate(payload(values)))}
    >
      <div className='bg-muted/50 grid grid-cols-2 gap-3 rounded-xl p-4 text-sm'>
        <div>
          <div className='text-muted-foreground'>{t('Account balance')}</div>
          <div className='mt-1 font-medium'>
            ${(props.customer.quota / 500_000).toFixed(2)}
          </div>
        </div>
        <div>
          <div className='text-muted-foreground'>{t('Lifetime usage')}</div>
          <div className='mt-1 font-medium'>
            ${(props.customer.used_quota / 500_000).toFixed(2)}
          </div>
        </div>
      </div>
      <div className='flex items-center justify-between gap-4'>
        <Label htmlFor='balance-alert-enabled'>
          {t('Enable balance reminder')}
        </Label>
        <Controller
          control={form.control}
          name='enabled'
          render={({ field }) => (
            <Switch
              id='balance-alert-enabled'
              checked={field.value}
              onCheckedChange={field.onChange}
              disabled={busy}
            />
          )}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='balance-alert-threshold'>
          {t('Remind when balance is below (USD)')}
        </Label>
        <Input
          id='balance-alert-threshold'
          type='number'
          min='0.01'
          max='1000000000'
          step='0.01'
          {...form.register('threshold', {
            onChange: () => setTestResult(null),
          })}
          aria-invalid={Boolean(form.formState.errors.threshold)}
          disabled={busy}
        />
      </div>
      <div className='space-y-2'>
        <Label htmlFor='balance-alert-emails'>{t('Reminder recipients')}</Label>
        <Textarea
          id='balance-alert-emails'
          rows={3}
          {...form.register('emails', { onChange: () => setTestResult(null) })}
          aria-invalid={Boolean(form.formState.errors.emails)}
          placeholder={'name@company.com\nteam@company.com'}
          disabled={busy}
        />
        <p className='text-muted-foreground text-xs'>
          {t(
            'Up to 10 email addresses, separated by new lines or commas. These recipients receive this customer’s reminders only.'
          )}
        </p>
      </div>
      <p className='text-muted-foreground text-xs leading-relaxed'>
        {t(
          'Balances are checked about once a minute. One reminder per low-balance period; reminders reset after the balance recovers. Failed recipients are retried after 5 minutes. Moving the customer out of this group pauses the reminder.'
        )}
      </p>
      {saved?.last_notified_at ? (
        <p className='text-muted-foreground text-xs'>
          {t('Last email accepted')}:{' '}
          {new Date(saved.last_notified_at * 1000).toLocaleString()}
        </p>
      ) : null}
      {saved?.delivery_failed && (
        <p className='text-destructive text-sm'>
          {t(
            'The last delivery failed for some recipients and will be retried.'
          )}
        </p>
      )}
      {Object.entries(form.formState.errors).map(([field, error]) => (
        <p key={field} role='alert' className='text-destructive text-sm'>
          {error.message}
        </p>
      ))}
      {testResult && (
        <div
          role='status'
          className='bg-muted/50 space-y-2 rounded-lg p-3 text-sm'
        >
          {testResult.sent.length > 0 && (
            <p>
              {t('Test sent to')}: {testResult.sent.join(', ')}
            </p>
          )}
          {testResult.failed.length > 0 && (
            <p className='text-destructive'>
              {t('Could not send to')}: {testResult.failed.join(', ')}
            </p>
          )}
          <p className='text-muted-foreground text-xs'>
            {t(
              'Check your inbox and spam folder. Sending a test does not save settings or enable the reminder.'
            )}
          </p>
        </div>
      )}
      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          variant='outline'
          disabled={busy}
          onClick={async () => {
            if (!(await form.trigger())) return
            const data = payload(form.getValues())
            if (data.recipients.length === 0) {
              form.setError('emails', {
                type: 'manual',
                message: t('Enter up to 10 valid email addresses.'),
              })
              return
            }
            test.mutate(data)
          }}
        >
          {test.isPending && <Spinner className='mr-2 size-4' />}
          {t('Send test email')}
        </Button>
        <Button type='submit' disabled={busy}>
          {save.isPending && <Spinner className='mr-2 size-4' />}
          {t('Save reminder')}
        </Button>
      </div>
    </form>
  )
}
