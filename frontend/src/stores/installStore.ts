import { create } from 'zustand'
import { logger } from '@/lib/logger'
import { detectTVMode } from '@/hooks/useTVMode'

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const STORAGE_KEY = 'pwa-install-state'
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

interface StoredInstallState {
  installed: boolean
  dismissed: boolean
  dismissedAt?: number
}

function getStoredState(): StoredInstallState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : { installed: false, dismissed: false }
  } catch {
    return { installed: false, dismissed: false }
  }
}

function setStoredState(state: StoredInstallState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function isRecentlyDismissed(state: StoredInstallState): boolean {
  if (!state.dismissed || !state.dismissedAt) return false
  return Date.now() - state.dismissedAt < SNOOZE_MS
}

interface InstallState {
  // The browser's install offer, kept until it is used (it can only be prompted once)
  deferredPrompt: BeforeInstallPromptEvent | null
  // Installed, or the banner was closed (or the browser's dialog cancelled) in the last 7 days
  snoozed: boolean
  // A TV browser at startup: never offer installation there
  tv: boolean
  install: () => Promise<boolean>
  dismiss: () => void
}

export const useInstallStore = create<InstallState>()((set, get) => ({
  deferredPrompt: null,
  snoozed: false,
  tv: false,

  install: async () => {
    const promptEvent = get().deferredPrompt
    if (!promptEvent) return false

    // A BeforeInstallPromptEvent can only be prompted once; a second
    // prompt() rejects, so drop it before awaiting anything.
    set({ deferredPrompt: null })

    try {
      await promptEvent.prompt()
      const { outcome } = await promptEvent.userChoice

      if (outcome === 'accepted') {
        setStoredState({ installed: true, dismissed: false })
        set({ snoozed: true })
        return true
      }

      // Cancelling the browser's own dialog starts the same 7-day snooze
      // as closing the banner
      get().dismiss()
      return false
    } catch (error) {
      logger.warn('Install', 'Install prompt failed', error)
      return false
    }
  },

  dismiss: () => {
    setStoredState({ installed: false, dismissed: true, dismissedAt: Date.now() })
    set({ snoozed: true })
  },
}))

/** The browser has offered installation (a menu can offer it even while the banner is snoozed). */
export const selectCanInstall = (s: InstallState): boolean => s.deferredPrompt !== null

/** Show the install banner. */
export const selectShouldPromote = (s: InstallState): boolean =>
  selectCanInstall(s) && !s.tv && !s.snoozed

let stopListening: (() => void) | null = null

/**
 * Read the stored install state and listen for the browser's install offer.
 * Runs once at module load, which is at app startup (App imports
 * InstallPrompt statically), so an offer made while the sign-in screen is up
 * is kept. Calling it again replaces the listeners (tests do this between cases).
 */
export function initInstallStore(): void {
  stopListening?.()

  const stored = getStoredState()
  const tv = detectTVMode()
  useInstallStore.setState({
    deferredPrompt: null,
    snoozed: stored.installed || isRecentlyDismissed(stored),
    tv,
  })

  stopListening = null
  // Never offer installation on a TV: don't even listen for the offer
  if (tv) return

  const handleBeforeInstallPrompt = (e: Event) => {
    // Keep the offer for our own banner and menu instead of the browser's
    e.preventDefault()
    useInstallStore.setState({ deferredPrompt: e as BeforeInstallPromptEvent })
  }

  const handleAppInstalled = () => {
    setStoredState({ installed: true, dismissed: false })
    useInstallStore.setState({ deferredPrompt: null, snoozed: true })
  }

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  window.addEventListener('appinstalled', handleAppInstalled)

  stopListening = () => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.removeEventListener('appinstalled', handleAppInstalled)
  }
}

initInstallStore()
