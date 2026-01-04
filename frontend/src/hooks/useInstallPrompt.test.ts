import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useInstallPrompt } from './useInstallPrompt'

// Mock BeforeInstallPromptEvent
interface MockBeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function createMockPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): MockBeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt') as MockBeforeInstallPromptEvent
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome })
  return event
}

describe('useInstallPrompt', () => {
  const STORAGE_KEY = 'pwa-install-state'

  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('initial state', () => {
    it('starts with canInstall as false when no beforeinstallprompt event', () => {
      const { result } = renderHook(() => useInstallPrompt())
      expect(result.current.canInstall).toBe(false)
    })

    it('sets canInstall to true when beforeinstallprompt event fires', () => {
      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent()
        window.dispatchEvent(event)
      })

      expect(result.current.canInstall).toBe(true)
    })
  })

  describe('installed state', () => {
    it('does not show prompt when already installed', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        installed: true,
        dismissed: false
      }))

      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent()
        window.dispatchEvent(event)
      })

      expect(result.current.canInstall).toBe(false)
    })
  })

  describe('dismissed state', () => {
    it('does not show prompt when recently dismissed (within 7 days)', () => {
      const now = Date.now()
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        installed: false,
        dismissed: true,
        dismissedAt: now - (1000 * 60 * 60 * 24) // 1 day ago
      }))

      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent()
        window.dispatchEvent(event)
      })

      expect(result.current.canInstall).toBe(false)
    })

    it('shows prompt when dismissed more than 7 days ago', () => {
      const now = Date.now()
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        installed: false,
        dismissed: true,
        dismissedAt: now - (1000 * 60 * 60 * 24 * 8) // 8 days ago
      }))

      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent()
        window.dispatchEvent(event)
      })

      expect(result.current.canInstall).toBe(true)
    })
  })

  describe('install function', () => {
    it('calls prompt() on the deferred event', async () => {
      const { result } = renderHook(() => useInstallPrompt())

      const mockEvent = createMockPromptEvent('accepted')
      act(() => {
        window.dispatchEvent(mockEvent)
      })

      await act(async () => {
        await result.current.install()
      })

      expect(mockEvent.prompt).toHaveBeenCalled()
    })

    it('returns true when user accepts', async () => {
      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent('accepted')
        window.dispatchEvent(event)
      })

      let installResult: boolean = false
      await act(async () => {
        installResult = await result.current.install()
      })

      expect(installResult).toBe(true)
    })

    it('returns false when user dismisses', async () => {
      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent('dismissed')
        window.dispatchEvent(event)
      })

      let installResult: boolean = true
      await act(async () => {
        installResult = await result.current.install()
      })

      expect(installResult).toBe(false)
    })

    it('sets installed state in localStorage when accepted', async () => {
      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent('accepted')
        window.dispatchEvent(event)
      })

      await act(async () => {
        await result.current.install()
      })

      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      expect(state.installed).toBe(true)
    })

    it('sets canInstall to false after successful install', async () => {
      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent('accepted')
        window.dispatchEvent(event)
      })

      expect(result.current.canInstall).toBe(true)

      await act(async () => {
        await result.current.install()
      })

      expect(result.current.canInstall).toBe(false)
    })

    it('returns false when no deferred prompt exists', async () => {
      const { result } = renderHook(() => useInstallPrompt())

      let installResult: boolean = true
      await act(async () => {
        installResult = await result.current.install()
      })

      expect(installResult).toBe(false)
    })
  })

  describe('dismiss function', () => {
    it('sets dismissed state in localStorage', () => {
      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent()
        window.dispatchEvent(event)
      })

      act(() => {
        result.current.dismiss()
      })

      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      expect(state.dismissed).toBe(true)
      expect(state.dismissedAt).toBeDefined()
    })

    it('sets canInstall to false after dismissal', () => {
      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent()
        window.dispatchEvent(event)
      })

      expect(result.current.canInstall).toBe(true)

      act(() => {
        result.current.dismiss()
      })

      expect(result.current.canInstall).toBe(false)
    })
  })

  describe('appinstalled event', () => {
    it('sets installed state and hides prompt on appinstalled event', () => {
      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent()
        window.dispatchEvent(event)
      })

      expect(result.current.canInstall).toBe(true)

      act(() => {
        window.dispatchEvent(new Event('appinstalled'))
      })

      expect(result.current.canInstall).toBe(false)

      const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      expect(state.installed).toBe(true)
    })
  })

  describe('cleanup', () => {
    it('removes event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

      const { unmount } = renderHook(() => useInstallPrompt())

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'beforeinstallprompt',
        expect.any(Function)
      )

      removeEventListenerSpy.mockRestore()
    })
  })

  describe('localStorage error handling', () => {
    it('handles corrupted localStorage gracefully', () => {
      localStorage.setItem(STORAGE_KEY, 'not valid json')

      const { result } = renderHook(() => useInstallPrompt())

      act(() => {
        const event = createMockPromptEvent()
        window.dispatchEvent(event)
      })

      // Should still work despite corrupted storage
      expect(result.current.canInstall).toBe(true)
    })
  })
})
