import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { logger } from '@/lib/logger'
import { isIOS, isStandalone } from '@/lib/platform'
import {
  authenticateWithPlex,
  authenticateWithPlexRedirect,
  finishPlexRedirect,
  hasPendingPlexPin,
  openPlexAuthWindow,
  PlexAuthError,
  takePendingPlexPin,
  type PlexAuthErrorCode,
} from '@/services/plexAuth'

/** What a sign-in callout says for each Plex sign-in failure (popup or redirect). */
export const PLEX_ERROR_COPY: Record<PlexAuthErrorCode, string> = {
  popup_blocked: 'Your browser blocked the Plex window.',
  timeout: 'Plex sign-in timed out.',
  rate_limited: 'Too many attempts, wait a minute.',
  pin_failed: "Couldn't start Plex sign-in.",
  finish_failed: "Couldn't finish Plex sign-in. Try again.",
  cancelled: 'Plex sign-in was cancelled.',
}

export interface UsePlexSignInOptions {
  /**
   * Use the token Plex gave (sign in with it, list servers with it). Throw to
   * report a failure. Check `signal` before acting on a reply: Cancel aborts it.
   */
  onToken: (authToken: string, signal: AbortSignal) => Promise<void>
  /**
   * A failure to show: a PlexAuthError (see PLEX_ERROR_COPY) or a message.
   * Never called for Cancel, a closed Plex window or coming back from Plex
   * without signing in.
   */
  onError: (error: PlexAuthError | string) => void
  /** A flow starts, or a page restored from the back-forward cache resumes one: clear old errors. */
  onStart?: () => void
  /** Where Plex's redirect sign-in sends the page back to (default '/'). */
  returnPath?: string
  /** The page is about to leave for Plex's redirect sign-in: save what should survive it. */
  onBeforeRedirect?: () => void
}

export interface PlexSignIn {
  /** A flow is running: the Plex window is open, the page is leaving for Plex, or a return is being finished. */
  waiting: boolean
  /** Start signing in. Call it from the click itself: the Plex window opens before any await. */
  start: () => Promise<void>
  /** Stop the flow in progress, with no error. */
  cancel: () => void
}

/**
 * Plex sign-in: a popup on desktops and Android browsers, a full-page redirect
 * on iPhones, iPads and installed apps. A redirect is finished when the page
 * comes back: on mount, or when the browser restores the page from its
 * back-forward cache.
 */
export function usePlexSignIn({
  onToken,
  onError,
  onStart,
  returnPath,
  onBeforeRedirect,
}: UsePlexSignInOptions): PlexSignIn {
  // Back from Plex's redirect sign-in: waiting until the PIN is checked
  const [waiting, setWaiting] = useState(hasPendingPlexPin)
  // Aborts the Plex flow in progress (Cancel); null when none is running
  const abortRef = useRef<AbortController | null>(null)
  // The redirect PIN being finished. Taken from storage once, so a reload
  // never retries it; kept here for StrictMode's second effect run.
  const pendingPinRef = useRef<number | null>(null)

  /**
   * Report a Plex failure. Cancel, closing the Plex window or coming back
   * from Plex without signing in is not an error.
   */
  const reportFailure = (err: unknown, controller: AbortController) => {
    const cancelled = controller.signal.aborted
      || (err instanceof PlexAuthError && err.code === 'cancelled')
    if (err instanceof Error && !cancelled) {
      onError(err instanceof PlexAuthError ? err : err.message)
    }
  }

  /** Hand the Plex button back, unless a cancelled flow already has. */
  const releaseFlow = (controller: AbortController) => {
    if (abortRef.current === controller) {
      abortRef.current = null
      setWaiting(false)
    }
  }

  /** Pass on the token a Plex flow (popup or redirect return) resolves to. */
  const completeSignIn = async (controller: AbortController, plexToken: Promise<string>) => {
    try {
      const authToken = await plexToken
      await onToken(authToken, controller.signal)
    } catch (err) {
      reportFailure(err, controller)
    } finally {
      releaseFlow(controller)
    }
  }

  // Back from Plex's redirect sign-in (iPhone, iPad, installed app): finish it
  const resumeRedirect = useEffectEvent((pinId: number, controller: AbortController) => {
    abortRef.current = controller
    void completeSignIn(controller, finishPlexRedirect(pinId, controller.signal))
  })

  useEffect(() => {
    const pinId = pendingPinRef.current ?? takePendingPlexPin()
    if (pinId === null) return
    pendingPinRef.current = pinId
    const controller = new AbortController()
    resumeRedirect(pinId, controller)
    return () => controller.abort()
  }, [])

  // Back from Plex with the Back button: the browser may restore this page
  // from its back-forward cache, still waiting with no check running.
  // Finish the pending PIN as a normal return would, or let go.
  const handleRestoredPage = useEffectEvent((event: PageTransitionEvent) => {
    if (!event.persisted) return
    abortRef.current?.abort()
    abortRef.current = null
    const pinId = takePendingPlexPin()
    if (pinId === null) {
      setWaiting(false)
      return
    }
    onStart?.()
    setWaiting(true)
    resumeRedirect(pinId, new AbortController())
  })

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => handleRestoredPage(event)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      // A check the restored page started has no other owner to stop it
      abortRef.current?.abort()
    }
  }, [])

  const start = async () => {
    // iPhone, iPad and installed apps: a popup is unreliable there, so the
    // whole page goes to Plex and the sign-in finishes when it comes back.
    // Plain Android browsers keep the popup, which works there.
    if (isIOS() || isStandalone()) {
      onStart?.()
      const controller = new AbortController()
      abortRef.current = controller
      setWaiting(true)
      try {
        onBeforeRedirect?.()
        await authenticateWithPlexRedirect(controller.signal, returnPath)
        // The page is leaving for Plex: stay waiting
      } catch (err) {
        reportFailure(err, controller)
        releaseFlow(controller)
      }
      return
    }
    // Everywhere else, a popup. Open the window before any await so the
    // browser still counts it as part of the click.
    const popup = openPlexAuthWindow()
    onStart?.()
    if (!popup) {
      logger.error('Plex', 'Failed to open Plex authentication popup')
      onError(new PlexAuthError('popup_blocked', 'Failed to open Plex authentication popup'))
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setWaiting(true)
    await completeSignIn(controller, authenticateWithPlex(popup, controller.signal))
  }

  const cancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setWaiting(false)
  }

  return { waiting, start, cancel }
}
