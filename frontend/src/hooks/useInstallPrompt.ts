import { useState, useEffect, useCallback } from 'react'
import { logger } from '@/lib/logger'
import { detectTVMode } from '@/hooks/useTVMode'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const STORAGE_KEY = 'pwa-install-state'

interface InstallState {
  installed: boolean
  dismissed: boolean
  dismissedAt?: number
}

interface UseInstallPromptResult {
  canInstall: boolean
  install: () => Promise<boolean>
  dismiss: () => void
}

function getInstallState(): InstallState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : { installed: false, dismissed: false }
  } catch {
    return { installed: false, dismissed: false }
  }
}

function setInstallState(state: InstallState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

// Starts the 7-day snooze, whether the user closed the banner or cancelled
// the browser's own install dialog.
function recordDismissal(): void {
  setInstallState({
    installed: false,
    dismissed: true,
    dismissedAt: Date.now()
  })
}

function isRecentlyDismissed(state: InstallState): boolean {
  if (!state.dismissed || !state.dismissedAt) return false
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  return Date.now() - state.dismissedAt < sevenDays
}

export function useInstallPrompt(): UseInstallPromptResult {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [canInstall, setCanInstall] = useState(false)

  useEffect(() => {
    // Never offer installation on a TV: don't even listen for the event
    if (detectTVMode()) {
      return
    }

    // Check if already installed or dismissed
    const state = getInstallState()
    if (state.installed || isRecentlyDismissed(state)) {
      return
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setCanInstall(true)
    }

    const handleAppInstalled = () => {
      setInstallState({ installed: true, dismissed: false })
      setCanInstall(false)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const install = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false

    // A BeforeInstallPromptEvent can only be prompted once; a second
    // prompt() rejects, so drop it before awaiting anything.
    const promptEvent = deferredPrompt
    setDeferredPrompt(null)

    try {
      await promptEvent.prompt()
      const { outcome } = await promptEvent.userChoice

      if (outcome === 'accepted') {
        setInstallState({ installed: true, dismissed: false })
        setCanInstall(false)
        return true
      }

      recordDismissal()
      setCanInstall(false)
      return false
    } catch (error) {
      logger.warn('Install', 'Install prompt failed', error)
      setCanInstall(false)
      return false
    }
  }, [deferredPrompt])

  const dismiss = useCallback(() => {
    recordDismissal()
    setCanInstall(false)
  }, [])

  return { canInstall, install, dismiss }
}
