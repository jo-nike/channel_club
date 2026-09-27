import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from '@testing-library/react'
import {
  initInstallStore,
  selectCanInstall,
  selectShouldPromote,
  useInstallStore,
  type BeforeInstallPromptEvent,
} from './installStore'
import { logger } from '@/lib/logger'

const STORAGE_KEY = 'pwa-install-state'
const DAY = 24 * 60 * 60 * 1000

function createPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome })
  return event
}

function offer(outcome: 'accepted' | 'dismissed' = 'accepted'): BeforeInstallPromptEvent {
  const event = createPromptEvent(outcome)
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

const canInstall = () => selectCanInstall(useInstallStore.getState())
const shouldPromote = () => selectShouldPromote(useInstallStore.getState())
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')

describe('installStore', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    // Replaces the module-scope listeners with fresh ones over clean storage
    initInstallStore()
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('the browser offer', () => {
    it('starts with nothing to install', () => {
      expect(canInstall()).toBe(false)
      expect(shouldPromote()).toBe(false)
    })

    it('keeps an offer made before any component mounts, and takes it from the browser', () => {
      // No component is rendered: the listener was registered by the module
      const event = offer()

      expect(event.defaultPrevented).toBe(true)
      expect(useInstallStore.getState().deferredPrompt).toBe(event)
      expect(canInstall()).toBe(true)
      expect(shouldPromote()).toBe(true)
    })

    it('replaces its listeners when initialised again, so an offer is kept once', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener')
      initInstallStore()
      expect(removeSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function))
      removeSpy.mockRestore()

      const event = offer()
      expect(useInstallStore.getState().deferredPrompt).toBe(event)
    })

    it('does not listen at all in TV mode', () => {
      localStorage.setItem('tv-mode', 'true')
      const addSpy = vi.spyOn(window, 'addEventListener')
      initInstallStore()

      const event = offer()

      expect(addSpy).not.toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function))
      expect(event.defaultPrevented).toBe(false)
      expect(canInstall()).toBe(false)
      expect(shouldPromote()).toBe(false)
      addSpy.mockRestore()
    })

    it('handles corrupted stored state', () => {
      localStorage.setItem(STORAGE_KEY, 'not valid json')
      initInstallStore()

      offer()

      expect(shouldPromote()).toBe(true)
    })
  })

  describe('snooze', () => {
    it('does not promote an installed app but still lets the menu offer a new install', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ installed: true, dismissed: false }))
      initInstallStore()

      offer()

      expect(shouldPromote()).toBe(false)
      expect(canInstall()).toBe(true)
    })

    it('does not promote within 7 days of a dismissal', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ installed: false, dismissed: true, dismissedAt: Date.now() - DAY }),
      )
      initInstallStore()

      offer()

      expect(shouldPromote()).toBe(false)
      expect(canInstall()).toBe(true)
    })

    it('promotes again more than 7 days after a dismissal', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ installed: false, dismissed: true, dismissedAt: Date.now() - 8 * DAY }),
      )
      initInstallStore()

      offer()

      expect(shouldPromote()).toBe(true)
    })

    it('dismiss() records the snooze and hides the banner, keeping the offer for the menu', () => {
      offer()

      act(() => {
        useInstallStore.getState().dismiss()
      })

      expect(stored().dismissed).toBe(true)
      expect(typeof stored().dismissedAt).toBe('number')
      expect(shouldPromote()).toBe(false)
      expect(canInstall()).toBe(true)
    })
  })

  describe('install()', () => {
    it('prompts with the kept offer and records an accepted install', async () => {
      const event = offer('accepted')

      let result = false
      await act(async () => {
        result = await useInstallStore.getState().install()
      })

      expect(event.prompt).toHaveBeenCalledTimes(1)
      expect(result).toBe(true)
      expect(stored().installed).toBe(true)
      expect(canInstall()).toBe(false)
      expect(shouldPromote()).toBe(false)
    })

    it('treats a cancelled browser dialog as a dismissal', async () => {
      offer('dismissed')

      let result = true
      await act(async () => {
        result = await useInstallStore.getState().install()
      })

      expect(result).toBe(false)
      expect(canInstall()).toBe(false)
      expect(stored().dismissed).toBe(true)
      expect(typeof stored().dismissedAt).toBe('number')
    })

    it('keeps the banner snoozed on the next start after a cancelled browser dialog', async () => {
      offer('dismissed')
      await act(async () => {
        await useInstallStore.getState().install()
      })

      initInstallStore()
      offer()

      expect(shouldPromote()).toBe(false)
    })

    it('does not prompt the same offer twice', async () => {
      const event = offer('dismissed')

      await act(async () => {
        await useInstallStore.getState().install()
      })
      let second = true
      await act(async () => {
        second = await useInstallStore.getState().install()
      })

      expect(second).toBe(false)
      expect(event.prompt).toHaveBeenCalledTimes(1)
    })

    it('resolves false and drops the offer when prompt() rejects', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      const event = createPromptEvent()
      event.prompt = vi.fn().mockRejectedValue(new DOMException('already prompted', 'InvalidStateError'))
      act(() => {
        window.dispatchEvent(event)
      })

      let result = true
      await act(async () => {
        result = await useInstallStore.getState().install()
      })

      expect(result).toBe(false)
      expect(canInstall()).toBe(false)
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('resolves false with no offer', async () => {
      let result = true
      await act(async () => {
        result = await useInstallStore.getState().install()
      })
      expect(result).toBe(false)
    })
  })

  describe('appinstalled', () => {
    it('records the install and drops the offer', () => {
      offer()

      act(() => {
        window.dispatchEvent(new Event('appinstalled'))
      })

      expect(canInstall()).toBe(false)
      expect(shouldPromote()).toBe(false)
      expect(stored().installed).toBe(true)
    })
  })

  // A fresh copy of the module, imported without ever calling initInstallStore:
  // only the import itself can have registered its listener
  describe('app startup', () => {
    let fresh: typeof import('./installStore') | null = null

    /** Drop a module's listeners: initialising in TV mode removes them and adds none. */
    function detach(init: () => void) {
      localStorage.setItem('tv-mode', 'true')
      init()
      localStorage.removeItem('tv-mode')
    }

    beforeEach(() => {
      // The listener of this file's own copy would otherwise take the offer
      detach(initInstallStore)
      vi.resetModules()
    })

    afterEach(() => {
      if (fresh) detach(fresh.initInstallStore)
      fresh = null
    })

    it('listens as soon as the module is imported', async () => {
      fresh = await import('./installStore')

      const event = createPromptEvent()
      window.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(true)
      expect(fresh.useInstallStore.getState().deferredPrompt).toBe(event)
    })

    it('keeps an offer made on the sign-in screen, before InstallPrompt ever renders', async () => {
      // Importing the app (not rendering it) must be enough to start listening
      await import('@/App')

      const event = createPromptEvent()
      window.dispatchEvent(event)

      fresh = await import('./installStore')
      expect(event.defaultPrevented).toBe(true)
      expect(fresh.useInstallStore.getState().deferredPrompt).toBe(event)
    })
  })
})
