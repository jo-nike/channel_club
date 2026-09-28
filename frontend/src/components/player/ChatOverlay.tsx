import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { AlertCircle, Loader2, MessageCircle, Send } from 'lucide-react'
import type { ChatSendResult } from '@/hooks/useWebSocket'
import { detectMediaUrls, type MediaType } from '@/lib/mediaDetection'
import { memberColorStyle, memberKey } from '@/lib/memberColor'
import { createClientMessageId } from '@/lib/messageId'
import { cn } from '@/lib/utils'
import { isSystemMessage, useChatStore } from '@/stores/chatStore'
import type { ChatMessage } from '@/types'
import { usePlayerShell } from './PlayerShellContext'
import { useChatOverlayMode } from './useChatOverlayMode'

/** How many of the latest messages show over the video */
export const CHAT_OVERLAY_MAX = 4
/** How long each one stays before it fades */
export const CHAT_OVERLAY_SHOW_MS = 12_000
/** The fade itself, after which it is gone */
export const CHAT_OVERLAY_FADE_MS = 300

interface Preview {
  message: ChatMessage
  /** When it arrived here (ms, this clock), for its 12s */
  shownAt: number
  fading: boolean
}

const MEDIA_LABELS: Record<MediaType, string> = { gif: 'GIF', video: 'Video', image: 'Image' }

/**
 * A message's words, with an embedded GIF's or image's address said as 'GIF'
 * or 'Image'. A media link the chat doesn't embed stays as written.
 */
function previewText(content: string): string {
  let text = content
  const embeds = detectMediaUrls(content).filter((match) => match.kind === 'embed')
  for (const match of embeds.reverse()) {
    text = `${text.slice(0, match.startIndex)}${MEDIA_LABELS[match.type]}${text.slice(match.endIndex)}`
  }
  return text.trim()
}

/**
 * The messages that came in after the last one the list had: a new message,
 * or what a reconnect's history brings that was missed. A history that
 * replaces the list (the first load, a cleared chat) isn't news to show.
 * An empty list gaining one message is a new one.
 */
function arrivals(messages: ChatMessage[], before: ChatMessage[]): ChatMessage[] {
  const last = before.at(-1)
  if (!last) return messages.length === 1 ? messages : []
  const index = messages.findIndex((m) => m.messageId === last.messageId)
  return index === -1 ? [] : messages.slice(index + 1)
}

/**
 * Keeps the control bar up while the pointer rests on the element, like the
 * bar's own controls. The element can go from under a resting pointer
 * (clicked, faded out, sent), which fires no mouseleave, so it lets go of
 * the bar then too: otherwise the bar would never hide again.
 */
function useHoldsControls<T extends HTMLElement>() {
  const { setHoveringControls } = usePlayerShell()
  const isHovered = useRef(false)
  const ref = useCallback(
    (element: T | null) => {
      if (!element) return
      return () => {
        if (!isHovered.current) return
        isHovered.current = false
        setHoveringControls(false)
      }
    },
    [setHoveringControls]
  )
  const onMouseEnter = () => {
    isHovered.current = true
    setHoveringControls(true)
  }
  const onMouseLeave = () => {
    isHovered.current = false
    setHoveringControls(false)
  }
  return { ref, onMouseEnter, onMouseLeave }
}

// A send that failed, kept so sending the same words again is a retry of it
// under the same id, which the server recognises instead of posting twice
interface ComposerFailure {
  kind: Exclude<ChatSendResult, 'acknowledged'>
  content: string
  clientMessageId: string
}

interface OverlayComposerProps {
  /** Changes on every C press, which brings focus back here */
  request: number
  onClose: () => void
}

/**
 * One line to type into over the video. Enter sends through chatStore's
 * registered sender and closes it; Escape, or leaving it empty, closes it.
 * A failed send keeps the words and says so.
 */
function OverlayComposer({ request, onClose }: OverlayComposerProps) {
  // It closes under the pointer after a send
  const hold = useHoldsControls<HTMLFormElement>()
  const sendMessage = useChatStore((s) => s.sendMessage)
  const [draft, setDraft] = useState('')
  const [failure, setFailure] = useState<ComposerFailure | null>(null)
  const [isSending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [request])

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const content = draft.trim()
    if (!content || isSending) return
    const clientMessageId = failure?.content === content ? failure.clientMessageId : createClientMessageId()
    setSending(true)
    const result = await sendMessage(content, clientMessageId)
    setSending(false)
    if (result === 'acknowledged') onClose()
    else setFailure({ kind: result, content, clientMessageId })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return
    // Closes the composer only: not the chat, theater or fullscreen as well
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }

  return (
    <form
      onSubmit={handleSubmit}
      // Clicking away from an empty composer puts it away
      onBlur={(e) => {
        if (!draft.trim() && !e.currentTarget.contains(e.relatedTarget)) onClose()
      }}
      {...hold}
      className="video-controls pointer-events-auto flex w-full flex-col gap-1"
    >
      {failure && (
        <p role="alert" className="flex items-center gap-1.5 self-end rounded-md bg-black/65 px-2 py-1 text-xs text-white backdrop-blur-sm">
          <AlertCircle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
          {failure.kind === 'not-sent' ? "Not sent. You're offline or reconnecting." : "Couldn't confirm it was sent."}
        </p>
      )}
      <div className="flex items-center gap-1 rounded-full bg-black/75 py-1 pl-3 pr-1 shadow-md backdrop-blur-sm">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setFailure(null)
          }}
          onKeyDown={handleKeyDown}
          aria-label="Message the club"
          placeholder="Message the club…"
          maxLength={500}
          className="min-w-0 flex-1 rounded-sm bg-transparent text-sm text-white placeholder:text-white/60 focus-ring-media"
        />
        <button
          type="submit"
          disabled={!draft.trim() || isSending}
          aria-label="Send message"
          className="grid size-8 shrink-0 place-items-center rounded-full text-white transition-colors hover:bg-white/15 disabled:opacity-50 focus-ring-media"
        >
          {isSending ? (
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </form>
  )
}

interface ChatOverlayProps {
  /** Set, and changed, by each C press asking for the composer; null while it is closed */
  composerRequest?: number | null
  onComposerClose?: () => void
}

/**
 * The latest chat messages over the video, bottom right above the control
 * bar, in theater and fullscreen (see useChatOverlayMode). Each one that
 * arrives while it shows stays 12s and then fades; at most the last 4. It
 * never takes the pointer, except for its 'Open chat' target and the
 * composer, and animates only opacity and transform.
 *
 * C opens a composer under the messages on a fine pointer. On a touch
 * screen it is read-only: in fullscreen its target says 'Exit fullscreen to
 * reply', leaving fullscreen for the chat panel.
 *
 * Rendered in the player shell, so it is in fullscreen and stays put while
 * the engine is swapped.
 */
export function ChatOverlay({ composerRequest = null, onComposerClose }: ChatOverlayProps) {
  const { isTheaterMode, isFullscreen, toggleFullscreen } = usePlayerShell()
  const { isShown, canReply } = useChatOverlayMode(isTheaterMode, isFullscreen)
  const setChatOpen = useChatStore((s) => s.setOpen)
  const openChatHold = useHoldsControls<HTMLButtonElement>()
  const [previews, setPreviews] = useState<Preview[]>([])

  // Only what arrives while it shows: nothing saved up from before theater,
  // nor what the open panel already showed. (Adjusted while rendering,
  // React's pattern for state that follows a prop.)
  if (!isShown && previews.length > 0) setPreviews([])

  // New messages as they arrive. State is only set from the store's callback
  useEffect(
    () =>
      useChatStore.subscribe((state, before) => {
        if (state.messages === before.messages) return
        const added = arrivals(state.messages, before.messages)
        if (added.length === 0) return
        const shownAt = Date.now()
        setPreviews((current) =>
          [...current, ...added.map((message) => ({ message, shownAt, fading: false }))].slice(-CHAT_OVERLAY_MAX)
        )
      }),
    []
  )

  // Each preview fades at 12s and goes once the fade is over. The timers are
  // set again when the list changes, from when each one arrived
  useEffect(() => {
    const timers = previews.map(({ message, shownAt, fading }) =>
      fading
        ? setTimeout(
            () => setPreviews((current) => current.filter((p) => p.message.messageId !== message.messageId)),
            CHAT_OVERLAY_FADE_MS
          )
        : setTimeout(
            () =>
              setPreviews((current) =>
                current.map((p) => (p.message.messageId === message.messageId ? { ...p, fading: true } : p))
              ),
            Math.max(0, shownAt + CHAT_OVERLAY_SHOW_MS - Date.now())
          )
    )
    return () => timers.forEach(clearTimeout)
  }, [previews])

  if (!isShown) return null

  const isReadOnlyFullscreen = isFullscreen && !canReply

  return (
    <div
      data-testid="chat-overlay"
      className={cn(
        'pointer-events-none absolute right-0 z-10 flex w-80 max-w-[calc(100%-2rem)] flex-col items-end gap-1.5',
        // Above the control bar, clear of the notch and home indicator
        'bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] mr-[max(1rem,env(safe-area-inset-right))]'
      )}
    >
      {/* Read out as they come; the panel, which would also say them, is closed */}
      <div role="log" aria-label="Latest chat messages" aria-live="polite" className="flex w-full flex-col items-end gap-1.5">
        {previews.map(({ message, fading }) => (
          <p
            key={message.messageId}
            data-testid="chat-overlay-message"
            style={isSystemMessage(message) ? undefined : memberColorStyle(memberKey(message))}
            className={cn(
              'max-w-full rounded-lg bg-black/65 px-3 py-1.5 text-sm leading-snug text-white shadow-md backdrop-blur-sm break-words',
              'motion-safe:transition-[opacity,transform] motion-safe:duration-300',
              fading ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100'
            )}
          >
            {isSystemMessage(message) ? (
              <span className="italic text-white/85">{message.content}</span>
            ) : (
              <>
                {/* The member's colour for dark surfaces: the picture behind is dark */}
                <span className="font-semibold text-(--member-dark)">{message.username}</span>{' '}
                {previewText(message.content)}
              </>
            )}
          </p>
        ))}
      </div>
      {previews.length > 0 && (
        <button
          type="button"
          onClick={() => {
            // A touch screen keeps chat outside fullscreen (see TVView)
            if (isReadOnlyFullscreen) toggleFullscreen()
            setChatOpen(true)
          }}
          {...openChatHold}
          aria-controls="chat-panel"
          className="video-controls pointer-events-auto inline-flex min-h-9 items-center gap-1.5 rounded-full bg-black/65 px-3 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/80 focus-ring-media"
        >
          <MessageCircle className="size-3.5" aria-hidden="true" />
          {isReadOnlyFullscreen ? 'Exit fullscreen to reply' : 'Open chat'}
        </button>
      )}
      {canReply && composerRequest !== null && onComposerClose && (
        <OverlayComposer request={composerRequest} onClose={onComposerClose} />
      )}
    </div>
  )
}
