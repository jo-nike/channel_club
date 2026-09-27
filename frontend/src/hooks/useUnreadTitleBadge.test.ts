import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUnreadTitleBadge } from './useUnreadTitleBadge'
import { useChatStore } from '@/stores/chatStore'

// navigator.setAppBadge/clearAppBadge exist only in some browsers; jsdom has neither
type BadgeNavigator = { setAppBadge?: unknown; clearAppBadge?: unknown }
const badgeNavigator = navigator as unknown as BadgeNavigator

const installBadgeApi = (setAppBadge: unknown, clearAppBadge: unknown) => {
  Object.defineProperty(navigator, 'setAppBadge', { value: setAppBadge, configurable: true, writable: true })
  Object.defineProperty(navigator, 'clearAppBadge', { value: clearAppBadge, configurable: true, writable: true })
}

describe('useUnreadTitleBadge', () => {
  beforeEach(() => {
    document.title = 'Channel Club'
    useChatStore.setState({ isOpen: false, unreadCount: 0 })
  })

  afterEach(() => {
    delete badgeNavigator.setAppBadge
    delete badgeNavigator.clearAppBadge
  })

  describe('tab title', () => {
    it('leaves the title alone with nothing unread', () => {
      renderHook(() => useUnreadTitleBadge())

      expect(document.title).toBe('Channel Club')
    })

    it('puts the unread count in front of the title', () => {
      useChatStore.setState({ unreadCount: 3 })
      renderHook(() => useUnreadTitleBadge())

      expect(document.title).toBe('(3) Channel Club')
    })

    it('follows the count as messages arrive and are read', () => {
      renderHook(() => useUnreadTitleBadge())

      act(() => useChatStore.setState({ unreadCount: 1 }))
      expect(document.title).toBe('(1) Channel Club')

      act(() => useChatStore.setState({ unreadCount: 12 }))
      expect(document.title).toBe('(12) Channel Club')

      act(() => useChatStore.getState().setOpen(true))
      expect(document.title).toBe('Channel Club')
    })

    it('gives the page its own title back on unmount', () => {
      useChatStore.setState({ unreadCount: 2 })
      const { unmount } = renderHook(() => useUnreadTitleBadge())

      unmount()

      expect(document.title).toBe('Channel Club')
      act(() => useChatStore.setState({ unreadCount: 5 }))
      expect(document.title).toBe('Channel Club')
    })
  })

  describe('app badge', () => {
    it('sets the badge to the unread count and clears it when read', () => {
      const setAppBadge = vi.fn(() => Promise.resolve())
      const clearAppBadge = vi.fn(() => Promise.resolve())
      installBadgeApi(setAppBadge, clearAppBadge)
      renderHook(() => useUnreadTitleBadge())
      clearAppBadge.mockClear()

      act(() => useChatStore.setState({ unreadCount: 4 }))
      expect(setAppBadge).toHaveBeenLastCalledWith(4)

      act(() => useChatStore.setState({ unreadCount: 0 }))
      expect(clearAppBadge).toHaveBeenCalledTimes(1)
    })

    it('clears a badge left from an earlier session when nothing is unread', () => {
      const clearAppBadge = vi.fn(() => Promise.resolve())
      installBadgeApi(vi.fn(() => Promise.resolve()), clearAppBadge)

      renderHook(() => useUnreadTitleBadge())

      expect(clearAppBadge).toHaveBeenCalledTimes(1)
    })

    it('clears the badge on unmount', () => {
      const clearAppBadge = vi.fn(() => Promise.resolve())
      installBadgeApi(vi.fn(() => Promise.resolve()), clearAppBadge)
      useChatStore.setState({ unreadCount: 2 })
      const { unmount } = renderHook(() => useUnreadTitleBadge())

      unmount()

      expect(clearAppBadge).toHaveBeenCalledTimes(1)
    })

    it('does nothing to the badge while the count is unchanged', () => {
      const setAppBadge = vi.fn(() => Promise.resolve())
      installBadgeApi(setAppBadge, vi.fn(() => Promise.resolve()))
      useChatStore.setState({ unreadCount: 2 })
      renderHook(() => useUnreadTitleBadge())

      act(() => useChatStore.setState({ messages: [] }))

      expect(setAppBadge).toHaveBeenCalledTimes(1)
    })

    it('still titles the tab where there is no badge API', () => {
      expect('setAppBadge' in navigator).toBe(false)
      useChatStore.setState({ unreadCount: 1 })

      renderHook(() => useUnreadTitleBadge())

      expect(document.title).toBe('(1) Channel Club')
    })

    it('ignores a badge API that throws', () => {
      installBadgeApi(
        vi.fn(() => {
          throw new Error('not allowed')
        }),
        vi.fn(() => {
          throw new Error('not allowed')
        })
      )

      renderHook(() => useUnreadTitleBadge())
      act(() => useChatStore.setState({ unreadCount: 1 }))

      expect(document.title).toBe('(1) Channel Club')
    })

    it('ignores a badge API that rejects', async () => {
      const setAppBadge = vi.fn(() => Promise.reject(new Error('not installed')))
      installBadgeApi(setAppBadge, vi.fn(() => Promise.reject(new Error('not installed'))))

      renderHook(() => useUnreadTitleBadge())
      act(() => useChatStore.setState({ unreadCount: 1 }))
      // An unhandled rejection would fail the run
      await Promise.resolve()

      expect(setAppBadge).toHaveBeenCalledWith(1)
      expect(document.title).toBe('(1) Channel Club')
    })
  })
})
