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
import {
  reasoningEffortForModel,
  supportsReasoningLevel,
} from './reasoning-levels'

describe('reasoning level capabilities', () => {
  test('recognizes Astra and maps fast to supported low effort', () => {
    assert.equal(supportsReasoningLevel('gpt-6-astra'), true)
    assert.equal(reasoningEffortForModel('gpt-6-astra', 'fast'), 'low')
    assert.equal(reasoningEffortForModel('gpt-6-astra', 'auto'), undefined)
    assert.equal(reasoningEffortForModel('gpt-6-astra', 'xhigh'), 'xhigh')
    assert.equal(reasoningEffortForModel('gpt-6-astra', 'max'), 'max')
  })
  test('maps GPT reasoning levels to OpenAI efforts', () => {
    assert.equal(supportsReasoningLevel('gpt-5.6-sol'), true)
    assert.equal(reasoningEffortForModel('gpt-5.6-sol', 'fast'), 'minimal')
    assert.equal(reasoningEffortForModel('gpt-5.6-sol', 'auto'), undefined)
    assert.equal(reasoningEffortForModel('gpt-5.6-sol', 'xhigh'), 'xhigh')
    assert.equal(reasoningEffortForModel('gpt-5.6-sol', 'max'), 'xhigh')
  })

  test('maps Claude adaptive levels to supported efforts', () => {
    assert.equal(supportsReasoningLevel('claude-opus-4-6'), true)
    assert.equal(reasoningEffortForModel('claude-opus-4-6', 'fast'), 'low')
    assert.equal(reasoningEffortForModel('claude-opus-4-6', 'xhigh'), 'max')
  })

  test('does not expose the control for unsupported models', () => {
    assert.equal(supportsReasoningLevel('claude-sonnet-4-6'), false)
    assert.equal(supportsReasoningLevel('gemini-3.5-flash'), false)
    assert.equal(
      reasoningEffortForModel('claude-sonnet-4-6', 'high'),
      undefined
    )
  })
})
