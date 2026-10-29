/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GEMINI_REST_PREFIX, OPENAI_BASE_URL } from '@/lib/api-endpoints'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Button } from '@/components/ui/button'

export function ApiConnectionCard(props: { showGuideLink?: boolean }) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard()
  const endpoints = [
    {
      label: t('OpenAI-compatible API'),
      kind: 'Base URL',
      url: OPENAI_BASE_URL,
    },
    {
      label: t('Gemini API-compatible API'),
      kind: t('REST prefix'),
      url: GEMINI_REST_PREFIX,
    },
  ]

  return (
    <section
      className='bg-muted/20 shrink-0 rounded-xl border p-4'
      aria-label={t('API connection addresses')}
    >
      <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
        <h3 className='text-sm font-semibold'>
          {t('API connection addresses')}
        </h3>
        {props.showGuideLink !== false && (
          <Link
            to='/docs'
            className='inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline'
          >
            {t('API integration guide')}
            <ArrowUpRight className='size-4' aria-hidden='true' />
          </Link>
        )}
      </div>
      <div className='grid gap-3 lg:grid-cols-2'>
        {endpoints.map((endpoint) => (
          <div key={endpoint.url} className='min-w-0'>
            <p className='text-muted-foreground mb-1.5 text-xs'>
              {endpoint.label} · {endpoint.kind}
            </p>
            <div className='bg-background flex min-w-0 items-center gap-2 rounded-lg border py-1 pr-1 pl-3'>
              <code className='min-w-0 flex-1 text-xs break-all sm:text-sm'>
                {endpoint.url}
              </code>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='shrink-0'
                aria-label={t('Copy {{protocol}} address', {
                  protocol: endpoint.label,
                })}
                onClick={() => void copyToClipboard(endpoint.url)}
              >
                {copiedText === endpoint.url ? (
                  <Check className='size-4' aria-hidden='true' />
                ) : (
                  <Copy className='size-4' aria-hidden='true' />
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className='text-muted-foreground mt-3 text-xs leading-5'>
        {t(
          'Use an AnyRouters API key. Choose the address by API protocol, not by model provider.'
        )}
      </p>
    </section>
  )
}
