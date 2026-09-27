import { useEffect } from 'react'
import { useChatStore } from '@/stores/chatStore'

/**
 * Sets the installed app's icon badge where the platform has one (Chrome and
 * Edge PWAs, Safari web apps); elsewhere does nothing. The API can be missing,
 * throw or reject (no permission, not installed), and the count is only a
 * nicety, so every failure is ignored.
 */
function setAppBadge(count: number): void {
  try {
    const result = count > 0 ? navigator.setAppBadge?.(count) : navigator.clearAppBadge?.()
    result?.catch(() => {})
  } catch {
    // Unsupported here
  }
}

/**
 * Shows the unread chat count outside the page: in the tab title, '(3)
 * Channel Club', and on the installed app's icon. It reaches people in
 * another tab, or watching fullscreen, who can't see the chat button's
 * badge. The title it prefixes is the page's own (index.html), which comes
 * back when the count clears or the view goes away.
 *
 * It follows the store by subscription rather than by rendering, so a new
 * message doesn't re-render the view that mounts it.
 */
export function useUnreadTitleBadge(): void {
  useEffect(() => {
    const baseTitle = document.title
    // Unknown at first, so the first count always applies: nothing unread
    // clears a badge the icon kept from an earlier session
    let shown = -1

    const show = (count: number) => {
      if (count === shown) return
      shown = count
      document.title = count > 0 ? `(${count}) ${baseTitle}` : baseTitle
      setAppBadge(count)
    }

    show(useChatStore.getState().unreadCount)
    const unsubscribe = useChatStore.subscribe((state) => show(state.unreadCount))

    return () => {
      unsubscribe()
      show(0)
    }
  }, [])
}
