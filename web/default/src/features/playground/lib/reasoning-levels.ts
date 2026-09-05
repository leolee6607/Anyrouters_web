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
import type { ChatCompletionRequest, ReasoningLevel } from '../types'

type ReasoningProfile = 'openai' | 'claude' | 'astra'

export function isAstraModel(model: string): boolean {
  return model.trim() === 'gpt-6-astra'
}

const OPENAI_REASONING_MODEL = /^(?:gpt-5(?:[.-]|$)|codex(?:[.-]|$))/i
const CLAUDE_ADAPTIVE_MODEL = /^claude-opus-4-(?:6|7|8)(?:-|$)/i

function reasoningProfile(model: string): ReasoningProfile | null {
  const normalized = model.trim()
  if (isAstraModel(normalized)) return 'astra'
  if (OPENAI_REASONING_MODEL.test(normalized)) return 'openai'
  if (CLAUDE_ADAPTIVE_MODEL.test(normalized)) return 'claude'
  return null
}

export function supportsReasoningLevel(model: string): boolean {
  return reasoningProfile(model) !== null
}

export function reasoningEffortForModel(
  model: string,
  level: ReasoningLevel
): ChatCompletionRequest['reasoning_effort'] | undefined {
  const profile = reasoningProfile(model)
  if (!profile || level === 'auto') return undefined

  if (profile === 'astra') {
    if (level === 'fast') return 'low'
    return level
  }

  if (profile === 'claude') {
    if (level === 'fast') return 'low'
    if (level === 'xhigh') return 'max'
    return level
  }

  if (level === 'fast') return 'minimal'
  // A stored Astra selection can survive switching to an older model.
  if (level === 'max') return 'xhigh'
  return level
}
