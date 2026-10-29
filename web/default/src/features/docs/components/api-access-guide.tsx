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
import { useTranslation } from 'react-i18next'
import { GEMINI_REST_PREFIX, OPENAI_BASE_URL } from '@/lib/api-endpoints'
import {
  CodeBlock,
  CodeBlockCopyButton,
} from '@/components/ai-elements/code-block'
import { ApiConnectionCard } from '@/components/api-connection-card'

const OPENAI_EXAMPLE = `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["ANYROUTERS_API_KEY"],
    base_url="${OPENAI_BASE_URL}",
)

response = client.responses.create(
    model="gpt-5.4-mini",
    input="Reply only OK.",
    max_output_tokens=128,
    reasoning={"effort": "low"},
)
print(response.output_text)`

const GEMINI_EXAMPLE = `curl "${GEMINI_REST_PREFIX}/models/gemini-3.1-flash-lite:generateContent" \\
  -H "x-goog-api-key: $ANYROUTERS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "contents": [{"role": "user", "parts": [{"text": "Reply only OK."}]}],
    "generationConfig": {"maxOutputTokens": 256}
  }'`

export function ApiAccessGuide() {
  const { t } = useTranslation()
  return (
    <article className='space-y-8'>
      <header>
        <h1 className='text-2xl font-semibold tracking-tight'>
          {t('API integration guide')}
        </h1>
        <p className='text-muted-foreground mt-3 text-sm leading-6'>
          {t(
            'Requests are authenticated, routed and billed by AnyRouters. Use your platform API key and a model available to your account.'
          )}
        </p>
      </header>
      <ApiConnectionCard showGuideLink={false} />
      <section className='space-y-3'>
        <h2 className='text-base font-semibold'>{t('Prepare your API key')}</h2>
        <p className='text-muted-foreground text-sm leading-6'>
          {t(
            'Create a key on the API Keys page and set ANYROUTERS_API_KEY in your server environment. Keep the key on your server; do not include it in browser code or public repositories.'
          )}
        </p>
        <div className='flex flex-wrap gap-4 text-sm'>
          <Link to='/keys' className='underline underline-offset-4'>
            {t('API Keys')}
          </Link>
          <Link to='/marketplace' className='underline underline-offset-4'>
            {t('View available models')}
          </Link>
        </div>
      </section>
      <section className='space-y-3'>
        <h2 className='text-base font-semibold'>
          {t('OpenAI-compatible API')}
        </h2>
        <p className='text-muted-foreground text-sm leading-6'>
          {t(
            'Set the OpenAI SDK base_url to the /v1 address above. Install the Python dependency with pip install openai.'
          )}
        </p>
        <CodeBlock
          code={OPENAI_EXAMPLE}
          language='python'
          className='[&_pre]:overflow-x-auto'
        >
          <CodeBlockCopyButton aria-label={t('Copy')} />
        </CodeBlock>
        <p className='text-muted-foreground text-sm leading-6'>
          {t(
            'The example uses Responses. For Chat Completions, use client.chat.completions.create with messages; the Base URL stays the same. Gemini models that support the OpenAI-compatible protocol also use this Base URL. Check each model’s supported endpoints.'
          )}
        </p>
      </section>
      <section className='space-y-3'>
        <h2 className='text-base font-semibold'>
          {t('Gemini API-compatible API')}
        </h2>
        <p className='text-muted-foreground text-sm leading-6'>
          {t(
            'Send Gemini-format requests to /v1beta/models/{model}:generateContent and authenticate with the x-goog-api-key header. The example below runs in a macOS or Linux shell.'
          )}
        </p>
        <CodeBlock
          code={GEMINI_EXAMPLE}
          language='bash'
          className='[&_pre]:overflow-x-auto'
        >
          <CodeBlockCopyButton aria-label={t('Copy')} />
        </CodeBlock>
        <p className='text-muted-foreground text-sm leading-6'>
          {t(
            'The /v1beta address is a REST prefix. If your SDK adds the API version automatically, configure its base address and version separately to avoid repeating /v1beta.'
          )}
        </p>
      </section>
      <section className='space-y-3 border-t pt-6'>
        <h2 className='text-base font-semibold'>{t('Connection checks')}</h2>
        <p className='text-muted-foreground text-sm leading-6'>
          {t(
            'API requests can connect directly to the addresses above. Downloads and third-party sign-in pages use their own service addresses.'
          )}
        </p>
        <ul className='text-muted-foreground list-disc space-y-2 pl-5 text-sm leading-6'>
          <li>
            {t(
              'A JSON 401 response without a key means the API is reachable. Add a valid key to authenticate.'
            )}
          </li>
          <li>
            {t(
              'For HTML 403 responses or connection timeouts, check the full request URL and the client proxy settings. Send support the error, request time and request ID if available; do not send your API key.'
            )}
          </li>
          <li>
            {t(
              'Use /v1 only once in an OpenAI-compatible Base URL. Direct HTTP requests need the complete endpoint, such as /v1/responses or /v1/chat/completions.'
            )}
          </li>
        </ul>
      </section>
    </article>
  )
}
