import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { detectMediaUrls, type MediaType } from '@/lib/mediaDetection'
import { memberColorStyle, memberKey } from '@/lib/memberColor'
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

/** A message's words, with a GIF's or an image's address said as 'GIF' or 'Image'. */
function previewText(content: string): string {
  let text = content
  for (const match of detectMediaUrls(content).reverse()) {
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

/**
 * The latest chat messages over the video, bottom right above the control
 * bar, in theater and fullscreen (see useChatOverlayMode). Each one that
 * arrives while it shows stays 12s and then fades; at most the last 4. It
 * never takes the pointer, except for its 'Open chat' target, and animates
 * only opacity and transform.
 *
 * Rendered in the player shell, so it is in fullscreen and stays put while
 * the engine is swapped.
 */
export function ChatOverlay() {
  const { isTheaterMode, isFullscreen } = usePlayerShell()
  const { isShown } = useChatOverlayMode(isTheaterMode, isFullscreen)
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
          onClick={() => setChatOpen(true)}
          {...openChatHold}
          aria-controls="chat-panel"
          className="video-controls pointer-events-auto inline-flex min-h-9 items-center gap-1.5 rounded-full bg-black/65 px-3 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/80 focus-ring-media"
        >
          <MessageCircle className="size-3.5" aria-hidden="true" />
          Open chat
        </button>
      )}
    </div>
  )
}
