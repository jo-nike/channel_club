import { useChatEnabled } from '@/hooks/useChatEnabled'
import { useTVMode } from '@/hooks/useTVMode'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'

/**
 * Whether the chat over the video shows: only in theater and fullscreen,
 * where the page header and its chat button are gone, while the chat panel is
 * closed (it shows the same messages). Off without chat, when the viewer has
 * turned 'Show chat over the video' off, and on the 10-foot TV layout, where
 * it would cover the picture (a score bug) from across the room.
 */
export function useChatOverlayMode(isTheaterMode: boolean, isFullscreen: boolean): { isShown: boolean } {
  const chatEnabled = useChatEnabled()
  const chatPreviews = useUIStore((s) => s.chatPreviews)
  const isTVMode = useTVMode()
  const isChatOpen = useChatStore((s) => s.isOpen)
  const isShown = chatEnabled && chatPreviews && !isTVMode && (isTheaterMode || isFullscreen) && !isChatOpen
  return { isShown }
}
