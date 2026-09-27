import { useCallback, useEffect, useState } from 'react'
import { toast, type ExternalToast } from 'sonner'
import {
  createHighlightCapture,
  deleteHighlightCapture,
  exportHighlight,
  fetchHighlightCapture,
  getHighlightFeatures,
  uploadHighlight,
  type HighlightCapture,
} from '@/services/api'
import { useChatEnabled } from '@/hooks/useChatEnabled'
import { useTVMode } from '@/hooks/useTVMode'
import { DEFAULT_CLIP_SECONDS, clipMessage, pressRange } from '@/lib/clip'
import { createClientMessageId } from '@/lib/messageId'
import { useChatStore } from '@/stores/chatStore'
import { useClipStore } from '@/stores/clipStore'

/** Seconds the 'Posting in' toast gives to cancel before anything is uploaded */
export const CLIP_THAT_COUNTDOWN_SECONDS = 3

export interface ClipThatChannel {
  id: string
  name: string
}

// Each run has its own toast, updated in place as the run moves on
let runs = 0

/** Resolves after `ms`, or as soon as the signal aborts. */
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * One press posts the last 20s to chat: capture, export the stretch ending at
 * the press, and after a 'Posting in 3s' toast with Cancel, upload it to
 * Zipline and post the link. Cancel stops everything before the upload's
 * link reaches chat. Edit stops it too and opens the editor on the same
 * capture; otherwise the capture is deleted.
 */
async function runClipThat(channelId: string, channelName: string) {
  const clips = useClipStore.getState()
  // The server keeps one capture per user: another capture now would replace
  // the editor's, or the running Clip that's
  if (clips.session || clips.clipping) return
  clips.setClipping(true)
  const id = `clip-that-${++runs}`
  const request = new AbortController()
  const { signal } = request
  let capture: HighlightCapture | null = null
  // Edit hands the capture to the editor, which deletes it when it closes
  let handedOver = false
  // Until the chat send starts the toast stays, and closing it (Cancel, a
  // swipe, the close button) cancels the run. It stays dismissible: sonner
  // ignores the Cancel button of a toast that isn't.
  const pending: ExternalToast = {
    id,
    duration: Infinity,
    cancel: { label: 'Cancel', onClick: () => request.abort() },
    onDismiss: () => request.abort(),
  }
  // A finished run's toast closes on its own and drops the buttons
  const finished = { id, duration: undefined, cancel: undefined, action: undefined, onDismiss: undefined }
  try {
    toast.loading(`Capturing the last ${DEFAULT_CLIP_SECONDS}s…`, pending)
    capture = await createHighlightCapture(channelId, signal)
    if (signal.aborted) return
    if (!(capture.duration >= 0.1)) throw new Error('No footage to clip yet. Try again in a moment.')
    const taken = capture
    pending.action = {
      label: 'Edit',
      onClick: () => {
        handedOver = true
        request.abort()
        useClipStore.getState().open(channelId, channelName, taken)
      },
    }
    // The press is this far before the capture's last frame (see HighlightCapture)
    const press = capture.duration - (capture.endsAt - capture.pressedAt)
    const [start, end] = pressRange(capture.duration, press)
    const trimmed = start > 0.001 || end < capture.duration - 0.001
    // Exported while the countdown runs, so the post follows it closely
    const clip = trimmed
      ? exportHighlight(capture.id, 'mp4', { startTime: start, endTime: end }, signal)
      : fetchHighlightCapture(capture.id, signal)
    // Awaited once the countdown ends; a failure before then is reported there
    clip.catch(() => {})
    const description = `Last ${Number((end - start).toFixed(1))}s of ${channelName}`
    for (let left = CLIP_THAT_COUNTDOWN_SECONDS; left > 0; left--) {
      toast.info(`Posting in ${left}s`, { ...pending, description })
      await delay(1000, signal)
      if (signal.aborted) return
    }
    toast.loading('Posting clip…', { ...pending, description })
    const blob = await clip
    if (signal.aborted) return
    const uploaded = await uploadHighlight(blob, 'mp4', signal)
    if (signal.aborted) return
    // A chat message can't be called back: from here there is nothing to cancel
    toast.loading('Posting to chat…', { ...pending, description, cancel: undefined, action: undefined, onDismiss: undefined })
    const result = await useChatStore
      .getState()
      .sendMessage(clipMessage(channelName, end - start, '', uploaded.url), createClientMessageId())
    if (result === 'acknowledged') {
      toast.success('Clip posted to chat', { ...finished, description })
      return
    }
    // The link is on Zipline either way: keep it within reach
    toast.error(
      result === 'unconfirmed'
        ? "Couldn't confirm the clip was posted. Check chat before posting it again."
        : "Clip not posted. You're offline or reconnecting.",
      {
        ...finished,
        description: uploaded.url,
        action: { label: 'Copy link', onClick: () => void navigator.clipboard?.writeText(uploaded.url).catch(() => {}) },
      },
    )
  } catch (err) {
    if (!signal.aborted) {
      toast.error(err instanceof Error ? err.message : 'Could not post the clip', { ...finished, description: undefined })
    }
  } finally {
    if (capture && !handedOver) void deleteHighlightCapture(capture.id)
    useClipStore.getState().setClipping(false)
  }
}

/**
 * 'Clip that' for the channel playing, or undefined where it isn't offered:
 * it needs clips, Zipline to host them and chat to post them to, and isn't
 * offered on a TV. Pressing it while the clip editor is open, or while
 * another Clip that runs, does nothing.
 */
export function useClipThat(channel: ClipThatChannel | null | undefined): (() => void) | undefined {
  const isTVMode = useTVMode()
  const chatEnabled = useChatEnabled()
  const wanted = chatEnabled && !isTVMode
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!wanted) return
    const request = new AbortController()
    void getHighlightFeatures(request.signal)
      .then((features) => {
        if (!request.signal.aborted) setAvailable(features.enabled && features.ziplineEnabled === true)
      })
      .catch(() => {})
    return () => request.abort()
  }, [wanted])

  const channelId = channel?.id
  const channelName = channel?.name
  const clipThat = useCallback(() => {
    if (channelId) void runClipThat(channelId, channelName ?? channelId)
  }, [channelId, channelName])
  return wanted && available && channelId ? clipThat : undefined
}
