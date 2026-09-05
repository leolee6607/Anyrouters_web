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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../constants'
import type { Message, PlaygroundConfig } from '../types'
import { buildChatCompletionPayload } from './payload-builder'

const messages: Message[] = [
  {
    key: 'user-1',
    from: 'user',
    versions: [{ id: 'v1', content: 'hello' }],
  },
]

function config(overrides: Partial<PlaygroundConfig>): PlaygroundConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

describe('playground reasoning payload', () => {
  test('Astra removes unsupported sampling parameters and retains tools', () => {
    const payload = buildChatCompletionPayload(
      messages,
      config({ model: 'gpt-6-astra', reasoning_level: 'fast' }),
      { ...DEFAULT_PARAMETER_ENABLED, temperature: true, top_p: true }
    )
    assert.equal(payload.temperature, undefined)
    assert.equal(payload.top_p, undefined)
    assert.equal(payload.reasoning_effort, 'low')
    assert.ok(payload.tools?.length)
  })
  test('sends selected GPT effort and keeps auto unset', () => {
    const extreme = buildChatCompletionPayload(
      messages,
      config({ model: 'gpt-5.6-sol', reasoning_level: 'xhigh' }),
      DEFAULT_PARAMETER_ENABLED
    )
    assert.equal(extreme.reasoning_effort, 'xhigh')
    assert.equal(extreme.temperature, undefined)
    assert.equal(extreme.top_p, undefined)

    const automatic = buildChatCompletionPayload(
      messages,
      config({ model: 'gpt-5.6-sol', reasoning_level: 'auto' }),
      DEFAULT_PARAMETER_ENABLED
    )
    assert.equal(automatic.reasoning_effort, undefined)
  })

  test('maps Claude extreme to max and omits unsupported models', () => {
    const claude = buildChatCompletionPayload(
      messages,
      config({ model: 'claude-opus-4-6', reasoning_level: 'xhigh' }),
      DEFAULT_PARAMETER_ENABLED
    )
    assert.equal(claude.reasoning_effort, 'max')

    const unsupported = buildChatCompletionPayload(
      messages,
      config({ model: 'claude-sonnet-4-6', reasoning_level: 'high' }),
      DEFAULT_PARAMETER_ENABLED
    )
    assert.equal(unsupported.reasoning_effort, undefined)
  })
})
