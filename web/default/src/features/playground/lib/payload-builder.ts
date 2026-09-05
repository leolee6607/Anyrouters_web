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
import type {
  ChatCompletionRequest,
  Message,
  PlaygroundConfig,
  ParameterEnabled,
} from '../types'
import { resolutionsForModel, type ImageResolution } from './image-models'
import { formatMessageForAPI, isValidMessage } from './message-utils'
import { reasoningEffortForModel } from './reasoning-levels'

/**
 * System-prompt design (fixes the "dumbed-down / robotic AI tone" complaint):
 * the old prompt injected a long imperative English block into every message,
 * pushing models into a stiff, translated-sounding register. We replace it with
 * a short identity tuned per vendor:
 *  - Claude: distilled from Anthropic's OFFICIAL claude.ai system prompt —
 *    identity + date + mid-conversation model switching + a natural,
 *    non-over-formatted register — minus all claude.ai-product/redirect/policy
 *    boilerplate (which would misfire on a third-party gateway). See
 *    CLAUDE_IDENTITY.
 *  - GPT / Gemini: no public official prompt exists, so a minimal identity +
 *    date + "stay natural" nudge (minimalIdentity).
 * All variants tell the model to REPLY IN THE USER'S OWN LANGUAGE, so Chinese
 * users get natural Chinese, English users natural English, etc. Capability
 * hints (code sandbox) are injected ONLY when the user's latest message looks
 * like a file/data/chart request; web search is driven by the web_search tool's
 * own description rather than a system directive.
 */

// Appended ONLY when the user's message looks like they want a file / data
// analysis / visualization: tells the model it can emit one-click-runnable
// Python instead of refusing. Plain declarative tone, no must/never commands.
const CODE_CAPABILITY =
  ' This workspace has a Python code execution sandbox: when the user wants a ' +
  'file (Word/.docx, Excel/.xlsx, PowerPoint/.pptx, PDF, CSV, chart/image, or ' +
  'any document/script), data analysis, or a visualization, you CAN produce it — ' +
  'do NOT say you are unable to generate or send files. Write one complete, ' +
  'self-contained Python block that produces the file(s), saving outputs to the ' +
  "current directory (e.g. df.to_excel('report.xlsx'); doc.save('report.docx'); " +
  "prs.save('slides.pptx'); plt.savefig('chart.png')); the code runs " +
  'automatically and the user downloads the result — no manual step needed. ' +
  'This applies to EVERY downloadable file, including plain-text ones like a ' +
  'shell script, a macOS .command file, .sh, .txt, .json, .csv or a config file: ' +
  "write them to disk from Python too (e.g. open('setup.command','w').write(...)). " +
  'NEVER put a `data:`/base64 download link or a made-up file URL in your reply — ' +
  'the chat blocks those and the user gets a dead "blocked" link; the ONLY way to ' +
  'deliver a file is to have the Python block write it to the current directory. ' +
  'When the file configures Claude Code / Codex / a client to use THIS service ' +
  '(AnyRouters), always use these exact values so it works out of the box: base ' +
  'URL https://api.anyrouters.com (for Claude Code end at the domain — do NOT ' +
  'append /v1; Codex uses https://api.anyrouters.com/v1 and wire_api="responses"). ' +
  'You MUST pin an available model name — the gateway only accepts the exact ' +
  'model ids claude-opus-4-8 / claude-sonnet-4-6 / claude-haiku-4-5 / gpt-5.5 / ' +
  'gpt-5.4 / gemini-3.5-flash (a bare "claude-sonnet-4-5" or a dated id is NOT ' +
  'available and 503s). For Claude Code set ANTHROPIC_MODEL=claude-sonnet-4-6 ' +
  '(the user can change it later to switch models). ' +
  'Preinstalled (import directly): pandas, matplotlib, openpyxl, numpy, PIL, ' +
  'python-docx (from docx import Document). ' +
  'The sandbox HAS internet: for anything else, pip install it at the top of the ' +
  "block, e.g. `import subprocess,sys; subprocess.run([sys.executable,'-m'," +
  "'pip','install','-q','python-pptx','reportlab'])` (installs in ~2s). " +
  'Pick the format by intent: a text document (report, letter, notes, summary) ' +
  '-> .docx via python-docx; a slide deck / presentation -> .pptx via ' +
  'python-pptx (pip install first); a spreadsheet -> .xlsx; a print-ready / ' +
  'typeset PDF -> reportlab (pip install first). Use matplotlib only for actual ' +
  'charts/plots, or a savefig(.pdf) when the "PDF" is really just a chart — do ' +
  'NOT lay out prose or tables as a matplotlib image. ' +
  'FONTS (non-Latin text — Chinese, Japanese, Korean): the sandbox has no ' +
  'Windows fonts, so never set SimHei/SimSun/Microsoft YaHei. ' +
  '- matplotlib: set matplotlib.rcParams["font.sans-serif"] = ["Noto Sans CJK JP"] ' +
  'and matplotlib.rcParams["axes.unicode_minus"] = False (that one font covers all ' +
  'CJK and prevents tofu boxes / broken minus signs). ' +
  '- reportlab: the bundled TTF loader cannot read the sandbox CJK fonts, so ' +
  'register the built-in CID font instead — `from reportlab.pdfbase import ' +
  'pdfmetrics; from reportlab.pdfbase.cidfonts import UnicodeCIDFont; ' +
  "pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))` — then use font " +
  "'STSong-Light' for any Chinese text. " +
  '- Office documents (docx / pptx / xlsx): use ONE font family for the ENTIRE ' +
  'file — same face for body, headings, tables, and for Chinese, English and ' +
  'digits alike. The common failure is a doc where the body is one font but the ' +
  'HEADINGS fall back to the theme font (e.g. Calibri) — that split is what looks ' +
  '"messy". So you MUST set the font on the heading/title styles too, not just ' +
  'Normal. A sensible default is SimSun (宋体) for a formal doc, but any one ' +
  'common family is fine — honor the user if they ask for a specific font ' +
  '(微软雅黑 / 等线 / a Latin font …); just keep the whole file consistent. ' +
  'For python-docx (from docx.oxml.ns import qn): set every style you use, ' +
  "e.g. FONT='SimSun'; " +
  "for s in ['Normal','Title','Heading 1','Heading 2','Heading 3']:\\n" +
  '    st=doc.styles[s]; st.font.name=FONT; ' +
  'rp=st.element.get_or_add_rPr().get_or_add_rFonts(); ' +
  "rp.set(qn('w:ascii'),FONT); rp.set(qn('w:hAnsi'),FONT); " +
  "rp.set(qn('w:eastAsia'),FONT) — the ascii/hAnsi keys cover English+digits, " +
  'eastAsia covers Chinese, so all three must be the same value. For python-pptx ' +
  "set each run's font.name (and East-Asian face via run.font._rPr) to that same " +
  'family. For openpyxl set a single Font(name=...) on the cells. IMPORTANT: ' +
  'write valid Python — use ASCII quotes/brackets/commas in code syntax (Chinese ' +
  'full-width punctuation like ，、（） is fine INSIDE string literals but must ' +
  'never appear as code syntax), or the script will raise a SyntaxError. ' +
  'TONE: do not lecture the user about these sandbox/font/rFonts implementation ' +
  'details or narrate your internal plan — just briefly say you are generating the ' +
  'file and write the Python. The mechanics above guide the code you write, not ' +
  'the prose you show the user.'

// The universal web_search function definition handed to non-Gemini text models.
export const WEB_SEARCH_TOOL: Record<string, unknown> = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the web for current, real-time or recent information (news, ' +
      'events, prices, releases, or any fact that may post-date your training). ' +
      'Returns relevant results to ground your answer.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query, phrased for a search engine.',
        },
      },
      required: ['query'],
    },
  },
}

// Image / video generation models take no chat tools.
function isTextModel(m: string): boolean {
  return !/image|imagen|veo|sora|gemini-omni-flash|dall|flux|midjourney|stable-?diffusion/.test(
    m
  )
}

// Tells the model to mirror the user's language so non-Chinese users stay
// natural too (the prompts themselves are in English — the register models
// handle most reliably — but the *reply* should match the user).
const REPLY_IN_USER_LANGUAGE =
  ' Always reply in the same language the user writes in.'

// Today's date, so the model isn't anchored to its training cutoff. claude.ai's
// official system prompt does exactly this (provides the current date up front).
function todayLine(): string {
  try {
    const d = new Date()
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return ` Today's date is ${date}.`
  } catch {
    return ''
  }
}

// Claude identity — distilled from Anthropic's official claude.ai system prompt
// (docs.claude.com/en/release-notes/system-prompts), keeping only the
// vendor-neutral, genuinely useful parts: accurate identity, awareness that the
// user can switch models mid-conversation, and a natural, non-listy default
// register. We deliberately DROP all claude.ai-product-specific content (Claude
// Code/Cowork/Artifacts feature tours, support.claude.com / docs.claude.com
// redirects, child-safety/refusal boilerplate) — that's tied to Anthropic's own
// surfaces and on a third-party gateway would make the model hallucinate
// features or send users to a competitor.
const CLAUDE_IDENTITY =
  'You are Claude, an AI assistant made by Anthropic.' +
  todayLine() +
  ' The user may switch between different models mid-conversation, so earlier' +
  ' replies may come from another model.' +
  ' In casual conversation, keep a natural, warm tone and avoid bullet points,' +
  ' headers, or numbered lists unless the user asks for them or the content' +
  ' (steps, comparisons, code) genuinely calls for structure.' +
  REPLY_IN_USER_LANGUAGE

// Minimal identity for vendors without a public official system prompt
// (OpenAI / Google don't publish theirs). One line + current date + reply in
// the user's language + a light "stay natural" nudge — enough to avoid
// misidentification and the stiff, over-formatted "AI tone" without importing a
// long imperative prompt.
function minimalIdentity(who: string): string {
  return (
    who +
    todayLine() +
    ' In casual conversation, keep a natural, conversational tone and avoid' +
    ' unnecessary lists, headers, or jargon unless the user asks.' +
    REPLY_IN_USER_LANGUAGE
  )
}

function identityForModel(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('claude')) {
    return CLAUDE_IDENTITY
  }
  if (m.includes('gemini')) {
    return minimalIdentity('You are Gemini, an AI assistant made by Google.')
  }
  if (/\b(gpt|chatgpt|o\d)\b/.test(m)) {
    return minimalIdentity('You are ChatGPT, an AI assistant made by OpenAI.')
  }
  return minimalIdentity('You are a helpful AI assistant.')
}

// Heuristic: does the user's latest message look like a file / data-analysis /
// visualization request? Covers both English and Chinese phrasings so the code
// hint is injected when relevant regardless of the user's language. Only on a
// hit do we append CODE_CAPABILITY, so ordinary chat isn't weighed down.
function wantsFileOutput(text: string): boolean {
  return /excel|csv|xlsx|word|docx?|ppt|pptx|幻灯片|演示文稿|文件|图表|表格|chart|plot|可视化|visuali|pdf|文档|报告|report|脚本|script|画(个|一个|张)?图|generate.*file|生成.*文件|导出|export|下载|download|数据分析|data analysis|柱状图|折线图|饼图|bar chart|line chart|pie chart|matplotlib|pandas/i.test(
    text
  )
}

// Assemble this turn's system prompt: just the one-line identity by default;
// append the code-capability hint only when the user's message looks like a
// file request. Search capability is no longer in the system prompt — it's
// driven by the web_search tool's own description.
function systemPromptForModel(model: string, lastUserText: string): string {
  let prompt = identityForModel(model)
  if (isTextModel(model.toLowerCase()) && wantsFileOutput(lastUserText)) {
    prompt += CODE_CAPABILITY
  }
  return prompt
}

const GEMINI_SINGLE_IMAGE_INSTRUCTION =
  'Final image output requirement: generate exactly ONE final image in this ' +
  'request. Do not output candidate images, alternate versions, comparison ' +
  'images, process images, thumbnails, contact sheets, or any extra image. If ' +
  'the user asks for multiple views or variations, compose them inside that one ' +
  'final image instead of returning multiple image files.'

function appendGeminiSingleImageInstruction(
  messages: ChatCompletionRequest['messages']
): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue

    if (typeof message.content === 'string') {
      message.content = `${message.content}\n\n${GEMINI_SINGLE_IMAGE_INSTRUCTION}`
      return
    }

    if (Array.isArray(message.content)) {
      const textPart = message.content.find(
        (part) =>
          part &&
          typeof part === 'object' &&
          (part as { type?: string }).type === 'text'
      ) as { text?: string } | undefined

      if (textPart) {
        textPart.text = `${textPart.text ?? ''}\n\n${GEMINI_SINGLE_IMAGE_INSTRUCTION}`
      } else {
        message.content.unshift({
          type: 'text',
          text: GEMINI_SINGLE_IMAGE_INSTRUCTION,
        })
      }
      return
    }
  }
}

/**
 * Build API request payload from messages and config
 */
export function buildChatCompletionPayload(
  messages: Message[],
  config: PlaygroundConfig,
  parameterEnabled: ParameterEnabled,
  // For Gemini image models (Nano Banana): the chosen aspect ratio, sent as
  // extra_body.google.image_config.aspect_ratio (verified to actually steer the
  // output size; plain text "make it 16:9" does not).
  geminiAspectRatio?: string,
  // For Gemini image models: resolution tier ("1K" / "2K"), sent as
  // extra_body.google.image_config.image_size.
  geminiImageSize?: string,
  // Resolved reference images (data URLs) for image models — the SAME rule as
  // gpt-image-2's edits path (attachments, else the conversation's newest
  // generated image). Injected into the LAST user message because
  // formatMessageForAPI strips history images to placeholders (request-size
  // guard) and drops non-data attachment refs, so without this the model
  // never sees the picture it is being asked to edit.
  referenceImages?: string[],
  // For Gemini image models: how many images to generate. Sent as `n`; the
  // gateway returns N images in the reply (verified), which render as N separate
  // downloadable pictures. Omitted (defaults to 1) for text models.
  imageCount?: number
): ChatCompletionRequest {
  // Filter and format valid messages
  const processedMessages = messages
    .filter(isValidMessage)
    .map(formatMessageForAPI)

  if (referenceImages?.length) {
    for (let i = processedMessages.length - 1; i >= 0; i--) {
      const pm = processedMessages[i]
      if (pm.role !== 'user') continue
      const contentParts = Array.isArray(pm.content) ? pm.content : []
      const text =
        typeof pm.content === 'string'
          ? pm.content
          : ((
              contentParts.find(
                (p) => (p as { type?: string }).type === 'text'
              ) as { text?: string }
            )?.text ?? '')
      const fileParts = contentParts.filter(
        (p) => (p as { type?: string }).type === 'file'
      )
      pm.content = [
        { type: 'text', text },
        ...referenceImages.map((url) => ({
          type: 'image_url' as const,
          image_url: { url },
        })),
        ...fileParts,
      ]
      break
    }
  }

  // Prepend an identity system prompt unless the conversation already starts
  // with one, so the model introduces itself correctly. Pass the latest user
  // message so the code-capability hint is only injected for file requests.
  // Image / video generation models (Nano Banana, Imagen, Veo, …) must NOT get
  // a chat-style system prompt: instructions like "reply naturally, avoid
  // lists" make them behave like a chatbot and hallucinate a fake image link
  // (e.g. a pollinations.ai URL) instead of actually generating the picture.
  // They should only ever see the user's image description.
  if (
    isTextModel(config.model.toLowerCase()) &&
    processedMessages[0]?.role !== 'system'
  ) {
    const lastUser = [...processedMessages]
      .reverse()
      .find((m) => m.role === 'user')
    const lastUserText =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : Array.isArray(lastUser?.content)
          ? lastUser.content
              .map((p) =>
                typeof p === 'string'
                  ? p
                  : ((p as { text?: string }).text ?? '')
              )
              .join(' ')
          : ''
    processedMessages.unshift({
      role: 'system' as const,
      content: systemPromptForModel(config.model, lastUserText),
    })
  }

  const payload: ChatCompletionRequest = {
    model: config.model,
    group: config.group,
    messages: processedMessages,
    stream: config.stream,
  }

  // Add enabled parameters
  const parameterKeys: Array<keyof ParameterEnabled> = [
    'temperature',
    'top_p',
    'max_tokens',
    'frequency_penalty',
    'presence_penalty',
    'seed',
  ]

  parameterKeys.forEach((key) => {
    if (parameterEnabled[key]) {
      const value = config[key as keyof PlaygroundConfig]
      if (value !== undefined && value !== null) {
        ;(payload as unknown as Record<string, unknown>)[key] = value
      }
    }
  })

  // Some models reject the classic sampling params. Claude on Bedrock (Opus 4.8
  // etc.) deprecates `temperature` / rejects temperature+top_p together; OpenAI's
  // GPT-5 family and the o-series reasoning models reject `temperature` outright
  // ("Unsupported parameter: 'temperature' is not supported with this model").
  // Drop both for those models and let them use their own defaults so the chat
  // doesn't error out.
  const record = payload as unknown as Record<string, unknown>
  const noSamplingParams =
    config.model.trim() === 'gpt-6-astra' ||
    /claude/i.test(config.model) ||
    /\b(gpt-5|gpt5|o\d)\b/i.test(config.model) ||
    /codex|gpt-5\.\d|chatgpt/i.test(config.model)
  if (noSamplingParams) {
    delete record.temperature
    delete record.top_p
  }

  const reasoningEffort = reasoningEffortForModel(
    config.model,
    config.reasoning_level
  )
  if (reasoningEffort) record.reasoning_effort = reasoningEffort

  // Web search is on by default for every text model. Gemini (Vertex) grounds
  // natively via a "googleSearch" tool. Every other text model (Claude on
  // Bedrock, GPT on Azure, …) gets a universal `web_search` function tool whose
  // calls the playground executes server-side (/pg/search -> Tavily), feeding
  // results back — so ALL models can search, not just Gemini.
  const m = config.model.toLowerCase()
  if (isTextModel(m)) {
    record.tools = m.includes('gemini')
      ? [{ type: 'function', function: { name: 'googleSearch' } }]
      : [WEB_SEARCH_TOOL]
  }

  // Gemini image models (Nano Banana) take an aspect ratio and resolution via
  // Gemini's native image_config, surfaced through OpenAI-compat extra_body.
  // Only attach for a Gemini image model, and only the fields the user set.
  if (!isTextModel(m) && m.includes('gemini')) {
    appendGeminiSingleImageInstruction(payload.messages)

    const imageConfig: Record<string, string> = {}
    if (geminiAspectRatio) imageConfig.aspect_ratio = geminiAspectRatio
    // Only send image_size when the selected model exposes that exact tier. The
    // UI also clamps on model switch, but this keeps direct state reuse safe.
    if (
      geminiImageSize &&
      resolutionsForModel(config.model).includes(
        geminiImageSize as ImageResolution
      )
    ) {
      imageConfig.image_size = geminiImageSize
    }
    if (Object.keys(imageConfig).length > 0) {
      payload.extra_body = { google: { image_config: imageConfig } }
    }
    // Ask for N images at once; the gateway returns them in one reply.
    if (imageCount && imageCount > 1) {
      ;(payload as unknown as Record<string, unknown>).n = imageCount
    }
  }

  return payload
}
