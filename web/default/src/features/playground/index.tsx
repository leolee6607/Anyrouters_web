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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getUserModels, getUserGroups } from './api'
import { ChatHistory } from './components/chat-history'
import { PlaygroundChat } from './components/playground-chat'
import { PlaygroundInput } from './components/playground-input'
import { usePlaygroundState, useChatHandler, useChatSessions } from './hooks'
import {
  createUserMessage,
  createLoadingAssistantMessage,
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_VIDEO_OPTIONS,
  defaultResolutionForModel,
  readFilesToAttachments,
  resolutionsForModel,
  imageCountsForModel,
  supportsDocumentInput,
  videoResolutionsForModel,
  videoDurationsForResolution,
  type ImageGenOptions,
  type VideoGenOptions,
} from './lib'
import {
  buildContinuationMessages,
  CONTINUATION_PROMPT,
} from './lib/continuation'
import { setEditImageHandler } from './lib/image-edit-bridge'
import type { Message as MessageType, AttachedFile } from './types'

export function Playground() {
  const { t } = useTranslation()
  const {
    config,
    parameterEnabled,
    models,
    groups,
    setModels,
    setGroups,
    updateConfig,
  } = usePlaygroundState()

  // Conversations (ChatGPT-style history). The active session is the source of
  // truth for messages, replacing the old single-conversation storage.
  const {
    sessions,
    activeId,
    messages,
    updateMessages,
    updateSessionMessages,
    flushPersist,
    newChat,
    selectChat,
    renameChat,
    deleteChat,
  } = useChatSessions()

  // In-chat image-generation options (aspect ratio / quality). Shown in the
  // composer only for image models; threaded into the send path so Gemini gets
  // an aspect_ratio and gpt-image-2 gets a size + quality.
  const [imageOptions, setImageOptions] = useState<ImageGenOptions>(
    DEFAULT_IMAGE_OPTIONS
  )

  // Video-generation options (Veo): duration / resolution / aspect / audio.
  // Shown in the composer only for video models; threaded into the send path.
  const [videoOptions, setVideoOptions] = useState<VideoGenOptions>(
    DEFAULT_VIDEO_OPTIONS
  )

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
    onSessionMessageUpdate: updateSessionMessages,
    imageOptions,
    videoOptions,
    sessionId: activeId,
  })

  // Session writes are debounced during streaming (so we don't serialize the
  // whole conversation to localStorage on every token). When generation ends,
  // force the final write immediately so a refresh/crash right after keeps the
  // complete reply.
  const wasGeneratingRef = useRef(isGenerating)
  useEffect(() => {
    if (wasGeneratingRef.current && !isGenerating) flushPersist()
    wasGeneratingRef.current = isGenerating
  }, [isGenerating, flushPersist])

  // Edit dialog state
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(
    null
  )

  // Images staged to send with the next message (data URLs). Sources: clicking
  // "edit" on a generated picture, dragging a file onto the composer, pasting an
  // image, or the Attach menu. Sent as image_url parts so the model sees them
  // (multi-turn image editing for Nano Banana; vision for text models). Shown as
  // removable thumbnail chips above the input until sent or cleared.
  const [pendingImages, setPendingImages] = useState<string[]>([])

  const addPendingImages = useCallback((urls: string[]) => {
    const valid = urls.filter((u) => u && u.startsWith('data:image/'))
    // Dedupe against what's already staged: the edit-image button can be
    // clicked repeatedly and used to pile up identical reference chips.
    if (valid.length)
      setPendingImages((prev) => {
        const fresh = valid.filter((u) => !prev.includes(u))
        return fresh.length ? [...prev, ...fresh] : prev
      })
  }, [])
  const removePendingImage = useCallback((idx: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  // Documents (PDF/text) staged to send with the next message. Sent as `file`
  // content parts to document-capable models (Claude / GPT-5.x). Shown as named
  // chips above the input until sent or cleared.
  const [pendingFiles, setPendingFiles] = useState<AttachedFile[]>([])

  const addPendingFiles = useCallback((added: AttachedFile[]) => {
    const valid = added.filter(
      (f) => f && f.dataUrl && f.dataUrl.startsWith('data:')
    )
    if (valid.length) setPendingFiles((prev) => [...prev, ...valid])
  }, [])
  const removePendingFile = useCallback((idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  // Shared file ingest for the composer picker, paste, and the page-level drop
  // zone. Images become image_url attachments; documents attach only for
  // document-capable models, otherwise one honest notice (no silent drop).
  const handleIngestFiles = useCallback(
    async (incoming: FileList | File[]) => {
      if (isGenerating) return
      const allowDocs = supportsDocumentInput(config.model)
      const { images, files, rejectedDocs } = await readFilesToAttachments(
        incoming,
        allowDocs
      )
      if (images.length) addPendingImages(images)
      if (files.length) addPendingFiles(files)
      if (rejectedDocs > 0) {
        toast.info(t('This model does not support file attachments'))
      }
    },
    [isGenerating, config.model, addPendingImages, addPendingFiles, t]
  )

  // Page-level drag & drop: drop a file anywhere over the chat area (like a
  // messenger), not just on the composer. A full-area overlay gives feedback.
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)

  // Load models.
  // `t` below is only a fallback-message helper, not a data input, so it is
  // intentionally kept out of the query cache key.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const { data: modelsData, isLoading: isLoadingModels } = useQuery({
    queryKey: ['playground-models'],
    queryFn: async () => {
      try {
        return await getUserModels()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t('Failed to load playground models')
        )
        return []
      }
    },
  })

  // Load groups.
  // See note above: `t` is a fallback-message helper, not a cache input.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const { data: groupsData } = useQuery({
    queryKey: ['playground-groups'],
    queryFn: async () => {
      try {
        return await getUserGroups()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t('Failed to load playground groups')
        )
        return []
      }
    },
  })

  // Update models when data changes
  useEffect(() => {
    if (!modelsData) return

    setModels(modelsData)

    // Move away from a removed or temporarily unavailable model while keeping
    // unavailable entries visible in the selector.
    const currentModel = modelsData.find((m) => m.value === config.model)
    const fallbackModel = modelsData.find((m) => !m.unavailable)
    if (fallbackModel && (!currentModel || currentModel.unavailable)) {
      updateConfig('model', fallbackModel.value)
    }
  }, [modelsData, config.model, setModels, updateConfig])

  // Update groups when data changes
  useEffect(() => {
    if (!groupsData) return

    setGroups(groupsData)

    const hasCurrentGroup = groupsData.some((g) => g.value === config.group)
    if (!hasCurrentGroup && groupsData.length > 0) {
      const fallback =
        groupsData.find((g) => g.value === 'default')?.value ??
        groupsData[0].value
      updateConfig('group', fallback)
    }
  }, [groupsData, setGroups, config.group, updateConfig])

  const handleSendMessage = (text: string) => {
    // Attach any staged images (edited picture / dropped / pasted / uploaded) so
    // the model receives them as image_url parts, plus any staged documents
    // (sent as file parts to document-capable models).
    const attached = pendingImages.length ? pendingImages : undefined
    const attachedDocs = pendingFiles.length ? pendingFiles : undefined
    const userMessage = createUserMessage(text, attached, attachedDocs)
    const assistantMessage = createLoadingAssistantMessage()

    const newMessages = [...messages, userMessage, assistantMessage]
    sendChat(newMessages, () => {
      updateMessages(newMessages)
      setPendingImages([])
      setPendingFiles([])
    })
  }

  // Register the in-chat "edit image" handler: clicking the edit button on a
  // generated image stages it (a chip appears above the input); the user then
  // types what to change and sends. Cleared on unmount.
  useEffect(() => {
    setEditImageHandler((dataUrl: string) => {
      addPendingImages([dataUrl])
      // Fixed id: repeated clicks refresh the one toast instead of stacking.
      toast.info(t('Describe how to edit the image, then send'), {
        id: 'edit-image-hint',
      })
    })
    return () => setEditImageHandler(null)
  }, [t, addPendingImages])

  const handleCopyMessage = (message: MessageType) => {
    // Copy is handled in MessageActions component
    // eslint-disable-next-line no-console
    console.log('Message copied:', message.key)
  }

  const handleRegenerateMessage = (message: MessageType) => {
    // Find the message index and regenerate from there
    const messageIndex = messages.findIndex((m) => m.key === message.key)
    if (messageIndex === -1) return

    const isGeneratedMedia =
      message.from === 'assistant' &&
      /(?:!\[[^\]]*\]\((?:data:image\/|idbimg:\/\/)|!video\[)/.test(
        message.versions?.[0]?.content || ''
      )
    if (isGeneratedMedia) {
      const loadingMessage = {
        ...createLoadingAssistantMessage(),
        key: message.key,
      }
      const displayMessages = messages.map((m) =>
        m.key === message.key ? loadingMessage : m
      )
      sendChat([...messages.slice(0, messageIndex), loadingMessage], () =>
        updateMessages(displayMessages)
      )
      return
    }

    // Remove messages after this one and regenerate
    const messagesUpToHere = messages.slice(0, messageIndex)
    const loadingMessage = createLoadingAssistantMessage()
    const newMessages = [...messagesUpToHere, loadingMessage]

    sendChat(newMessages, () => updateMessages(newMessages))
  }

  const handleContinueMessage = (message: MessageType) => {
    if (message.finishReason !== 'length' || isGenerating) return
    const newMessages = buildContinuationMessages(
      messages,
      message.key,
      t(CONTINUATION_PROMPT)
    )
    if (!newMessages) return
    sendChat(newMessages, () => updateMessages(newMessages))
  }

  const handleEditMessage = useCallback((message: MessageType) => {
    setEditingMessageKey(message.key)
  }, [])

  const handleEditOpenChange = useCallback((open: boolean) => {
    if (!open) setEditingMessageKey(null)
  }, [])

  // Apply edit and optionally re-submit from the edited user message
  const applyEdit = useCallback(
    (newContent: string, submit: boolean) => {
      if (!editingMessageKey) return
      const index = messages.findIndex((m) => m.key === editingMessageKey)
      if (index === -1) return

      const updated = messages.map((m) =>
        m.key === editingMessageKey
          ? { ...m, versions: [{ ...m.versions[0], content: newContent }] }
          : m
      )

      if (!submit || updated[index].from !== 'user') {
        setEditingMessageKey(null)
        updateMessages(updated)
        return
      }

      const toSubmit = [
        ...updated.slice(0, index + 1),
        createLoadingAssistantMessage(),
      ]
      sendChat(toSubmit, () => {
        setEditingMessageKey(null)
        updateMessages(toSubmit)
      })
    },
    [editingMessageKey, messages, updateMessages, sendChat]
  )

  const handleDeleteMessage = (message: MessageType) => {
    const newMessages = messages.filter((m) => m.key !== message.key)
    updateMessages(newMessages)
  }

  return (
    <div className='relative flex size-full overflow-hidden'>
      <ChatHistory
        sessions={sessions}
        activeId={activeId}
        onNewChat={newChat}
        onSelect={selectChat}
        onRename={renameChat}
        onDelete={deleteChat}
      />

      <div
        className='relative flex min-w-0 flex-1 flex-col overflow-hidden'
        onDragEnter={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault()
            dragDepth.current += 1
            setDragOver(true)
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          dragDepth.current = 0
          setDragOver(false)
          if (e.dataTransfer?.files?.length)
            void handleIngestFiles(e.dataTransfer.files)
        }}
      >
        {/* Full-width scroll container: scrolling works even over side whitespace */}
        <div className='flex flex-1 flex-col overflow-hidden'>
          <PlaygroundChat
            messages={messages}
            onCopyMessage={handleCopyMessage}
            onRegenerateMessage={handleRegenerateMessage}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onContinueMessage={handleContinueMessage}
            isGenerating={isGenerating}
            editingKey={editingMessageKey}
            onCancelEdit={handleEditOpenChange}
            onSaveEdit={(newContent) => applyEdit(newContent, false)}
            onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
            currentModel={config.model}
          />
        </div>

        {/* Input area: center content and constrain to the same container width */}
        <div className='mx-auto w-full max-w-4xl'>
          <PlaygroundInput
            disabled={isGenerating}
            groups={groups}
            groupValue={config.group}
            isGenerating={isGenerating}
            isModelLoading={isLoadingModels}
            modelValue={config.model}
            models={models}
            onGroupChange={(value) => updateConfig('group', value)}
            reasoningLevel={config.reasoning_level}
            onReasoningLevelChange={(value) =>
              updateConfig('reasoning_level', value)
            }
            onModelChange={(value) => {
              updateConfig('model', value)
              setImageOptions((prev) => {
                const resolutions = resolutionsForModel(value)
                return {
                  ...prev,
                  count: imageCountsForModel(value).includes(prev.count)
                    ? prev.count
                    : 1,
                  resolution: resolutions.includes(prev.resolution)
                    ? prev.resolution
                    : defaultResolutionForModel(value),
                }
              })
              // Clamp video options to the new model's capabilities so the pills
              // never show a tier it can't do (e.g. 4K after switching from a
              // Fast model to the standard one).
              setVideoOptions((prev) => {
                const res = videoResolutionsForModel(value).includes(
                  prev.resolution
                )
                  ? prev.resolution
                  : '720p'
                const durs = videoDurationsForResolution(res, value)
                return {
                  ...prev,
                  resolution: res,
                  duration: durs.includes(prev.duration)
                    ? prev.duration
                    : durs[durs.length - 1],
                }
              })
            }}
            onStop={stopGeneration}
            onSubmit={handleSendMessage}
            images={pendingImages}
            onRemoveImage={removePendingImage}
            files={pendingFiles}
            onRemoveFile={removePendingFile}
            onIngestFiles={handleIngestFiles}
            imageOptions={imageOptions}
            onImageOptionsChange={setImageOptions}
            videoOptions={videoOptions}
            onVideoOptionsChange={setVideoOptions}
          />
        </div>

        {/* Drop-anywhere overlay: covers the whole chat pane so a file dragged
            in from the desktop can be released over the conversation, not just
            the composer (messenger-style). */}
        {dragOver && (
          <div className='bg-primary/5 border-primary/40 text-primary pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed text-base font-medium backdrop-blur-sm'>
            {t('Drop file to attach')}
          </div>
        )}
      </div>
    </div>
  )
}
