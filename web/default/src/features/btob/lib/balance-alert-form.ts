/*
Copyright (C) 2023-2026 QuantumNous
SPDX-License-Identifier: AGPL-3.0-or-later
*/
import { z } from 'zod'
import type { TFunction } from 'i18next'

export function parseReminderRecipients(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,;，；]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

export function balanceAlertFormSchema(t: TFunction) {
  return z
    .object({
      enabled: z.boolean(),
      threshold: z.string().refine((value) => {
        const amount = Number(value)
        return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000
      }, t('Enter a reminder amount greater than zero and no more than $1 billion.')),
      emails: z.string().refine((value) => {
        const recipients = parseReminderRecipients(value)
        return (
          recipients.length <= 10 &&
          recipients.every((item) =>
            /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(item)
          )
        )
      }, t('Enter up to 10 valid email addresses.')),
    })
    .superRefine((values, context) => {
      if (
        values.enabled &&
        parseReminderRecipients(values.emails).length === 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['emails'],
          message: t('Enter up to 10 valid email addresses.'),
        })
      }
    })
}

export type BalanceAlertFormValues = z.infer<
  ReturnType<typeof balanceAlertFormSchema>
>
