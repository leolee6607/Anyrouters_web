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
// Message types
export type MessageRole = 'user' | 'assistant' | 'system'

export type MessageStatus = 'loading' | 'streaming' | 'complete' | 'error'

export type StreamFinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_calls'
  | 'incomplete'
  | string

export type StreamTerminationReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_calls'
  | 'network_error'
  | 'client_abort'
  | 'upstream_timeout'
  | 'incomplete'

export type ReasoningLevel =
  | 'fast'
  | 'auto'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export interface ChatCompletionUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface MessageVersion {
  id: string
  content: string
}

export interface Message {
  key: string
  from: MessageRole
  versions: MessageVersion[]
  // Images attached to this (user) message as data URLs / idbimg refs, e.g. the
  // previous generated picture the user is asking the image model to edit. Sent
  // upstream as image_url content parts (multi-turn image editing for Nano
  // Banana). Absent for plain text messages.
  attachedImages?: string[]
  // Non-image documents attached to this (user) message (PDF / text / etc.),
  // each a base64 data URL plus its filename. Sent upstream as OpenAI-style
  // `file` content parts ({type:'file', file:{filename, file_data}}); the
  // gateway forwards these to models that accept document input (Claude →
  // `document` block, GPT-5.x → file input). Absent for plain text messages.
  attachedFiles?: AttachedFile[]
  sources?: { href: string; title: string }[]
  reasoning?: {
    content: string
    duration: number
  }
  isReasoningStreaming?: boolean
  isReasoningComplete?: boolean
  isContentComplete?: boolean
  // True while a tool-use round (web search) is running between model turns, so
  // the UI can show a "searching the web" indicator.
  isSearching?: boolean
  // True when an image generation stream was cut before the full-quality
  // `completed` frame arrived, so the bubble shows a low-res partial preview.
  // The UI must surface this — a partial silently passed off as the final
  // image reads as "the model is bad" to users.
  imageDegraded?: boolean
  status?: MessageStatus
  errorCode?: string | null
  finishReason?: StreamFinishReason
  terminationReason?: StreamTerminationReason
  requestId?: string
  usage?: ChatCompletionUsage
}

// API payload types
export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatCompletionMessage {
  role: MessageRole | 'tool'
  content: string | ContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

// A non-image document staged on / attached to a message.
export interface AttachedFile {
  name: string
  // base64 data URL, e.g. "data:application/pdf;base64,...."
  dataUrl: string
}

export interface ContentPart {
  type: 'text' | 'image_url' | 'file'
  text?: string
  image_url?: {
    url: string
  }
  // OpenAI-style file part. file_data is a base64 data URL; the gateway parses
  // the mime type from its header and forwards to document-capable models.
  file?: {
    filename?: string
    file_data: string
  }
}

export interface ChatCompletionRequest {
  model: string
  group?: string
  messages: ChatCompletionMessage[]
  stream: boolean
  temperature?: number
  top_p?: number
  max_tokens?: number
  frequency_penalty?: number
  presence_penalty?: number
  seed?: number
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  tools?: Array<Record<string, unknown>>
  // Vendor-specific passthrough. Used to carry Gemini's image generation config
  // (extra_body.google.image_config.aspect_ratio) for in-chat image models.
  extra_body?: Record<string, unknown>
}

export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: MessageRole
      content?: string
      reasoning_content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason: string | null
  }>
  usage?: ChatCompletionUsage
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: MessageRole
      content: string
      reasoning_content?: string
      tool_calls?: ToolCall[]
    }
    finish_reason: string
  }>
  usage?: ChatCompletionUsage
}

// Code execution (sandbox sidecar)
export interface ExecutionFile {
  name: string
  mime: string
  size: number
  b64?: string
  rich?: boolean
  truncated?: boolean
}

export interface ExecuteResponse {
  ok: boolean
  stdout?: string
  stderr?: string
  error?: unknown
  files?: ExecutionFile[]
  elapsed_ms?: number
}

// Configuration types
export interface PlaygroundConfig {
  model: string
  group: string
  reasoning_level: ReasoningLevel
  temperature: number
  top_p: number
  max_tokens: number
  frequency_penalty: number
  presence_penalty: number
  seed: number | null
  stream: boolean
}

export interface ParameterEnabled {
  temperature: boolean
  top_p: boolean
  max_tokens: boolean
  frequency_penalty: boolean
  presence_penalty: boolean
  seed: boolean
}

// Model and group options
export interface ModelOption {
  label: string
  value: string
  unavailable?: boolean
}

export interface GroupOption {
  label: string
  value: string
  ratio: number
  desc?: string
}
