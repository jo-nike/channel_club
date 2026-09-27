import { useChatEnabled } from '@/hooks/useChatEnabled'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useTVMode } from '@/hooks/useTVMode'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'

export interface ChatOverlayMode {
  /** The latest messages show over the video */
  isShown: boolean
  /** C opens a composer over the video, for a keyboard beside a fine pointer */
  canReply: boolean
}

/**
 * Whether the chat over the video shows: only in theater and fullscreen,
 * where the page header and its chat button are gone, while the chat panel is
 * closed (it shows the same messages). Off without chat, when the viewer has
 * turned 'Show chat over the video' off, and on the 10-foot TV layout, where
 * it would cover the picture (a score bug) from across the room.
 *
 * It takes a reply only on a fine pointer: on a touch screen typing needs
 * the soft keyboard, which real fullscreen fights, so there it is read-only.
 */
export function useChatOverlayMode(isTheaterMode: boolean, isFullscreen: boolean): ChatOverlayMode {
  const chatEnabled = useChatEnabled()
  const chatPreviews = useUIStore((s) => s.chatPreviews)
  const isTVMode = useTVMode()
  const isChatOpen = useChatStore((s) => s.isOpen)
  const isCoarsePointer = useMediaQuery('(pointer: coarse)')
  const isShown = chatEnabled && chatPreviews && !isTVMode && (isTheaterMode || isFullscreen) && !isChatOpen
  return { isShown, canReply: isShown && !isCoarsePointer }
}
