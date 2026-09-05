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
import { useRef, useState } from 'react'
import {
  CheckIcon,
  ChevronsUpDown,
  FileTextIcon,
  PaperclipIcon,
  SendIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { ModelGroupSelector } from '@/components/model-group-selector'
import {
  ASPECT_RATIOS,
  IMAGE_QUALITIES,
  IMAGE_COUNTS,
  VIDEO_ASPECT_RATIOS,
  videoResolutionsForModel,
  videoDurationsForResolution,
  isOmniVideoModel,
  imageModelKind,
  resolutionsForModel,
  supportsResolution,
  type AspectRatio,
  type ImageCount,
  type ImageGenOptions,
  type ImageQuality,
  type ImageResolution,
  type VideoGenOptions,
  type VideoDuration,
  type VideoResolution,
  type VideoAspectRatio,
} from '../lib/image-models'
import { isAstraModel, supportsReasoningLevel } from '../lib/reasoning-levels'
import type {
  ModelOption,
  GroupOption,
  AttachedFile,
  ReasoningLevel,
} from '../types'

interface PlaygroundInputProps {
  onSubmit: (text: string) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  isModelLoading?: boolean
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
  reasoningLevel: ReasoningLevel
  onReasoningLevelChange: (value: ReasoningLevel) => void
  // Images staged to send with the next message (data URLs), from edit / drag /
  // paste / upload. Shown as removable thumbnail chips above the textarea.
  images?: string[]
  onAddImages?: (dataUrls: string[]) => void
  onRemoveImage?: (index: number) => void
  // Documents (PDF/text) staged to send with the next message. Shown as named
  // chips; only offered for models that accept document input.
  files?: AttachedFile[]
  onRemoveFile?: (index: number) => void
  // Ingest picked / pasted files (images + documents). Owned by the parent so
  // the same logic backs the composer picker, paste, and the page-level drop
  // zone. Returns nothing; the parent updates staged images/files.
  onIngestFiles?: (files: FileList | File[]) => void
  // Image-generation options (aspect ratio / quality). Rendered as an inline bar
  // only when the selected model is an image model; the quality control shows
  // only for the OpenAI image family (gpt-image-2). Driven from the parent so the
  // send path can read them.
  imageOptions?: ImageGenOptions
  onImageOptionsChange?: (next: ImageGenOptions) => void
  // Video-generation options (duration / resolution / aspect / audio). Rendered
  // as an inline bar only when the selected model is a video model (Veo).
  videoOptions?: VideoGenOptions
  onVideoOptionsChange?: (next: VideoGenOptions) => void
}

// A compact collapsing pill (label + current value + chevron) that opens a
// single-select list — visually matched to the model selector pill (h-8 outline)
// so the image-generation options sit flush in the composer footer.
function OptionPill<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            size='sm'
            role='combobox'
            disabled={disabled}
            className={cn(
              'bg-background text-foreground hover:bg-accent flex h-8 items-center gap-1.5 border px-3 font-medium shadow-none transition-colors',
              'focus:!ring-0 focus:!outline-none'
            )}
          >
            <span className='text-muted-foreground text-xs'>{label}</span>
            <span className='text-foreground text-xs'>
              {current?.label ?? value}
            </span>
            <ChevronsUpDown className='text-muted-foreground h-4 w-4 opacity-50' />
          </Button>
        }
      />
      <PopoverContent align='start' className='w-36 gap-0.5 p-1'>
        {options.map((o) => (
          <button
            key={o.value}
            type='button'
            onClick={() => {
              onChange(o.value)
              setOpen(false)
            }}
            className={cn(
              'hover:bg-accent flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors',
              o.value === value && 'text-primary'
            )}
          >
            <span>{o.label}</span>
            {o.value === value && <CheckIcon className='size-3.5' />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function StaticOptionPill({ label, value }: { label: string; value: string }) {
  return (
    <span
      className={cn(
        'bg-background text-foreground flex h-8 items-center gap-1.5 rounded-md border px-3 font-medium shadow-none',
        'cursor-default select-none'
      )}
      title={`${label}: ${value}`}
    >
      <span className='text-muted-foreground text-xs'>{label}</span>
      <span className='text-foreground text-xs'>{value}</span>
    </span>
  )
}

export function PlaygroundInput({
  onSubmit,
  onStop,
  disabled,
  isGenerating,
  models,
  modelValue,
  onModelChange,
  isModelLoading = false,
  groups,
  groupValue,
  onGroupChange,
  reasoningLevel,
  onReasoningLevelChange,
  images,
  onRemoveImage,
  files,
  onRemoveFile,
  onIngestFiles,
  imageOptions,
  onImageOptionsChange,
  videoOptions,
  onVideoOptionsChange,
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Generation-options pills: image models show their native controls. Video
  // models share aspect ratio; Veo also exposes duration/resolution/audio,
  // while Omni keeps those in the prompt per the Interactions API.
  const kind = imageModelKind(modelValue)
  const showVideoOptions = kind === 'video' && !!videoOptions
  const showVeoOptions = showVideoOptions && !isOmniVideoModel(modelValue)
  const showImageOptions = kind !== null && kind !== 'video' && !!imageOptions
  const showQuality = kind === 'openai'
  const showResolution = kind === 'gemini' && supportsResolution(modelValue)
  const showReasoningLevel = supportsReasoningLevel(modelValue)
  const isModelSelectDisabled =
    disabled || isModelLoading || models.length === 0
  const isGroupSelectDisabled = disabled || groups.length === 0

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text?.trim() || disabled) return
    onSubmit(message.text)
    setText('')
  }

  const handlePickFile = () => fileInputRef.current?.click()

  // Paste an image (Ctrl/Cmd+V) into the composer; routed through the parent's
  // shared ingest so it behaves like the picker and the page-level drop zone.
  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData?.items || [])
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
    if (pasted.length) {
      e.preventDefault()
      onIngestFiles?.(pasted)
    }
  }

  const hasImages = !!images?.length
  const hasFiles = !!files?.length

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        className='hidden'
        onChange={(e) => {
          if (e.target.files?.length) onIngestFiles?.(e.target.files)
          e.target.value = ''
        }}
      />
      <div className='relative'>
        <PromptInput groupClassName='rounded-xl' onSubmit={handleSubmit}>
          {(hasImages || hasFiles) && (
            <div className='flex flex-wrap items-center gap-2 px-3 pt-3'>
              {images?.map((src, i) => (
                <span
                  key={`img-${i}`}
                  className='group/chip relative inline-block shrink-0'
                >
                  <img
                    src={src}
                    alt={t('Attached image')}
                    className='border-primary/30 h-14 w-14 rounded-lg border-2 object-cover'
                  />
                  <button
                    type='button'
                    onClick={() => onRemoveImage?.(i)}
                    className='bg-background absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border shadow-sm'
                    title={t('Remove')}
                  >
                    <XIcon size={12} />
                  </button>
                </span>
              ))}
              {files?.map((f, i) => (
                <span
                  key={`file-${i}`}
                  className='bg-muted/60 relative inline-flex max-w-[12rem] items-center gap-2 rounded-lg border py-2 pr-7 pl-2.5'
                  title={f.name}
                >
                  <FileTextIcon className='text-primary size-5 shrink-0' />
                  <span className='truncate text-xs font-medium'>{f.name}</span>
                  <button
                    type='button'
                    onClick={() => onRemoveFile?.(i)}
                    className='bg-background absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border shadow-sm'
                    title={t('Remove')}
                  >
                    <XIcon size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <PromptInputTextarea
            autoComplete='off'
            autoCorrect='off'
            autoCapitalize='off'
            spellCheck={false}
            className='px-5 md:text-base'
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onPaste={handlePaste}
            placeholder={
              // Surface the new send shortcut right where users type: Enter now
              // inserts a newline, so without this hint the change reads as
              // "the send button broke".
              /Mac|iPhone|iPad/.test(navigator.platform)
                ? t('Ask anything — ⌘+Enter to send')
                : t('Ask anything — Ctrl+Enter to send')
            }
            value={text}
          />

          <PromptInputFooter className='p-2.5'>
            <PromptInputTools>
              {/* Attach a file: opens the picker. Users can also drag a file onto
                the box or paste an image. Images are sent as image_url so vision
                / image-edit models (Nano Banana) can use them. */}
              <PromptInputButton
                className='border font-medium'
                disabled={disabled}
                variant='outline'
                type='button'
                onClick={handlePickFile}
              >
                <PaperclipIcon size={16} />
                <span className='hidden sm:inline'>{t('Attach file')}</span>
                <span className='sr-only sm:hidden'>{t('Attach file')}</span>
              </PromptInputButton>

              {showReasoningLevel && (
                <OptionPill
                  label={t('Reasoning')}
                  value={
                    reasoningLevel === 'max' && !isAstraModel(modelValue)
                      ? 'xhigh'
                      : reasoningLevel
                  }
                  options={[
                    { value: 'fast', label: t('Fast') },
                    { value: 'auto', label: t('Auto') },
                    { value: 'medium', label: t('Medium') },
                    { value: 'high', label: t('High') },
                    { value: 'xhigh', label: t('Extreme') },
                    ...(isAstraModel(modelValue)
                      ? [{ value: 'max', label: t('Maximum') }]
                      : []),
                  ]}
                  onChange={(level) =>
                    onReasoningLevelChange(level as ReasoningLevel)
                  }
                  disabled={disabled}
                />
              )}

              {/* Image-generation options as collapsing pills, flush with the
                attach / model pills. Only for image models; quality only for the
                OpenAI image family (gpt-image-2). */}
              {showImageOptions && (
                <OptionPill
                  label={t('Aspect ratio')}
                  value={imageOptions!.aspectRatio}
                  options={ASPECT_RATIOS.map((r) => ({
                    value: r,
                    label: r === 'auto' ? t('Auto (free aspect)') : r,
                  }))}
                  onChange={(r) =>
                    onImageOptionsChange?.({
                      ...imageOptions!,
                      aspectRatio: r as AspectRatio,
                    })
                  }
                  disabled={disabled}
                />
              )}
              {showImageOptions && showQuality && (
                <OptionPill
                  label={t('Quality')}
                  value={imageOptions!.quality}
                  options={IMAGE_QUALITIES.map((q) => ({
                    value: q,
                    label:
                      q === 'low'
                        ? t('Low')
                        : q === 'medium'
                          ? t('Medium')
                          : t('High'),
                  }))}
                  onChange={(q) =>
                    onImageOptionsChange?.({
                      ...imageOptions!,
                      quality: q as ImageQuality,
                    })
                  }
                  disabled={disabled}
                />
              )}
              {showImageOptions && showResolution && (
                <OptionPill
                  label={t('Resolution')}
                  value={imageOptions!.resolution}
                  options={resolutionsForModel(modelValue).map((r) => ({
                    value: r,
                    label: r,
                  }))}
                  onChange={(r) =>
                    onImageOptionsChange?.({
                      ...imageOptions!,
                      resolution: r as ImageResolution,
                    })
                  }
                  disabled={disabled}
                />
              )}
              {showImageOptions && (
                <OptionPill
                  label={t('Count')}
                  value={String(imageOptions!.count)}
                  options={IMAGE_COUNTS.map((n) => ({
                    value: String(n),
                    label: `×${n}`,
                  }))}
                  onChange={(n) =>
                    onImageOptionsChange?.({
                      ...imageOptions!,
                      count: Number(n) as ImageCount,
                    })
                  }
                  disabled={disabled}
                />
              )}

              {/* Video-generation options: Omni exposes official aspect-ratio
                choices plus a read-only 720p capability label; Veo also exposes
                duration, resolution, and native audio controls. */}
              {showVeoOptions && (
                <OptionPill
                  label={t('Duration')}
                  value={String(videoOptions!.duration)}
                  options={videoDurationsForResolution(
                    videoOptions!.resolution,
                    modelValue
                  ).map((d) => ({
                    value: String(d),
                    label: `${d}s`,
                  }))}
                  onChange={(d) =>
                    onVideoOptionsChange?.({
                      ...videoOptions!,
                      duration: Number(d) as VideoDuration,
                    })
                  }
                  disabled={disabled}
                />
              )}
              {showVideoOptions && (
                <OptionPill
                  label={t('Aspect ratio')}
                  value={videoOptions!.aspectRatio}
                  options={VIDEO_ASPECT_RATIOS.map((r) => ({
                    value: r,
                    label: r,
                  }))}
                  onChange={(r) =>
                    onVideoOptionsChange?.({
                      ...videoOptions!,
                      aspectRatio: r as VideoAspectRatio,
                    })
                  }
                  disabled={disabled}
                />
              )}
              {showVeoOptions && (
                <OptionPill
                  label={t('Resolution')}
                  value={videoOptions!.resolution}
                  options={videoResolutionsForModel(modelValue).map((r) => ({
                    value: r,
                    label: r === '4k' ? '4K' : r,
                  }))}
                  onChange={(r) => {
                    // 1080p / 4K only support an 8s clip — clamp duration when
                    // switching to a resolution that doesn't allow the current one.
                    const res = r as VideoResolution
                    const allowed = videoDurationsForResolution(res, modelValue)
                    const duration = allowed.includes(videoOptions!.duration)
                      ? videoOptions!.duration
                      : allowed[allowed.length - 1]
                    onVideoOptionsChange?.({
                      ...videoOptions!,
                      resolution: res,
                      duration,
                    })
                  }}
                  disabled={disabled}
                />
              )}
              {showVideoOptions && isOmniVideoModel(modelValue) && (
                <StaticOptionPill label={t('Resolution')} value='720p' />
              )}
              {showVeoOptions && (
                <OptionPill
                  label={t('Audio')}
                  value={videoOptions!.audio ? 'on' : 'off'}
                  options={[
                    { value: 'on', label: t('On') },
                    { value: 'off', label: t('Off') },
                  ]}
                  onChange={(v) =>
                    onVideoOptionsChange?.({
                      ...videoOptions!,
                      audio: v === 'on',
                    })
                  }
                  disabled={disabled}
                />
              )}
            </PromptInputTools>

            <div className='flex items-center gap-1.5 md:gap-2'>
              <ModelGroupSelector
                selectedModel={modelValue}
                models={models}
                onModelChange={onModelChange}
                selectedGroup={groupValue}
                groups={groups}
                onGroupChange={onGroupChange}
                disabled={isModelSelectDisabled || isGroupSelectDisabled}
              />

              {isGenerating && onStop ? (
                <PromptInputButton
                  className='text-foreground font-medium'
                  onClick={onStop}
                  variant='secondary'
                >
                  <SquareIcon className='fill-current' size={16} />
                  <span className='hidden sm:inline'>{t('Stop')}</span>
                  <span className='sr-only sm:hidden'>{t('Stop')}</span>
                </PromptInputButton>
              ) : (
                <PromptInputButton
                  className='text-foreground font-medium'
                  disabled={disabled || !text.trim()}
                  type='submit'
                  variant='secondary'
                >
                  <SendIcon size={16} />
                  <span className='hidden sm:inline'>{t('Send')}</span>
                  <span className='sr-only sm:hidden'>{t('Send')}</span>
                </PromptInputButton>
              )}
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
