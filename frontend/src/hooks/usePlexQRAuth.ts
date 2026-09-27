import { useState, useCallback, useRef, useEffect } from 'react'
import { createPlexPin, checkPlexPin, getPlexAuthUrl, type PlexPin } from '@/services/plexAuth'
import { logger } from '@/lib/logger'

export type PlexQRAuthStatus = 'idle' | 'polling' | 'success' | 'timeout' | 'error'

export interface UsePlexQRAuthOptions {
  pollInterval?: number // default: 2000ms
  timeout?: number // default: 5 minutes in ms
  /**
   * On timeout, start over with fresh PINs, up to MAX_AUTO_RESTARTS times,
   * before settling on 'timeout'. For a TV that sits on the sign-in screen.
   */
  autoRestart?: boolean
  onSuccess?: (authToken: string) => void
  /**
   * A failure to start. Not called on timeout: that is the 'timeout' status,
   * which the code screen shows with its own Try Again.
   */
  onError?: (error: Error) => void
  /**
   * Each attempt asking Plex for a new code: the first, Try Again and every
   * auto-restart. A caller clears any earlier error here.
   */
  onCodeRequested?: () => void
}

export interface UsePlexQRAuthReturn {
  pin: PlexPin | null // Strong PIN for QR code auth URL
  shortPin: PlexPin | null // Short PIN for manual entry at plex.tv/link
  authUrl: string | null
  status: PlexQRAuthStatus
  timeRemaining: number // seconds remaining
  error: Error | null
  start: () => Promise<void>
  cancel: () => void
}

const DEFAULT_POLL_INTERVAL = 2000
const DEFAULT_TIMEOUT = 5 * 60 * 1000 // 5 minutes
/** Restarts after the first attempt, so an idle TV doesn't create PINs all night. */
export const MAX_AUTO_RESTARTS = 3

/**
 * Hook for QR code-based Plex authentication flow.
 * Creates a PIN, generates QR auth URL, and polls for completion.
 */
export function usePlexQRAuth(options: UsePlexQRAuthOptions = {}): UsePlexQRAuthReturn {
  const {
    pollInterval = DEFAULT_POLL_INTERVAL,
    timeout = DEFAULT_TIMEOUT,
    autoRestart = false,
    onSuccess,
    onError,
    onCodeRequested,
  } = options

  const [pin, setPin] = useState<PlexPin | null>(null)
  const [shortPin, setShortPin] = useState<PlexPin | null>(null)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<PlexQRAuthStatus>('idle')
  const [timeRemaining, setTimeRemaining] = useState(Math.floor(timeout / 1000))
  const [error, setError] = useState<Error | null>(null)

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startTimeRef = useRef<number>(0)

  const generation = useRef(0)

  const cleanup = useCallback(() => {
    generation.current += 1
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])

  const cancel = useCallback(() => {
    logger.debug('PlexQRAuth', 'Authentication cancelled')
    cleanup()
    setStatus('idle')
    setPin(null)
    setShortPin(null)
    setAuthUrl(null)
    setTimeRemaining(Math.floor(timeout / 1000))
  }, [cleanup, timeout])

  const start = useCallback(async () => {
    // Each call from the caller gets a fresh restart budget
    let restarts = 0

    const run = async (): Promise<void> => {
      logger.debug('PlexQRAuth', 'Starting QR authentication flow')
      cleanup()
      const attempt = generation.current
      const current = () => generation.current === attempt
      setError(null)
      setStatus('polling')
      setTimeRemaining(Math.floor(timeout / 1000))
      startTimeRef.current = Date.now()
      onCodeRequested?.()

      timeoutRef.current = setTimeout(() => {
        if (!current()) return
        cleanup()
        if (autoRestart && restarts < MAX_AUTO_RESTARTS) {
          restarts += 1
          logger.debug('PlexQRAuth', `Timed out, restarting (${restarts}/${MAX_AUTO_RESTARTS})`)
          // Hide the expired code until the new one arrives
          setPin(null)
          setShortPin(null)
          setAuthUrl(null)
          void run()
          return
        }
        setStatus('timeout')
        setTimeRemaining(0)
        setError(new Error('Authentication timed out'))
      }, timeout)

      try {
        // Create both PINs in parallel:
        // - Strong PIN for QR code auth URL
        // - Short PIN for manual entry at plex.tv/link
        const [strongPin, manualPin] = await Promise.all([
          createPlexPin(true),
          createPlexPin(false),
        ])

        if (!current()) return
        setPin(strongPin)
        setShortPin(manualPin)

        // Generate auth URL from strong PIN (for QR code)
        const url = getPlexAuthUrl(strongPin)
        setAuthUrl(url)
        logger.debug('PlexQRAuth', `Strong PIN: ${strongPin.id}, Short PIN: ${manualPin.id} (${manualPin.code})`)

        // Start countdown timer
        countdownIntervalRef.current = setInterval(() => {
          const elapsed = Date.now() - startTimeRef.current
          const remaining = Math.max(0, Math.floor((timeout - elapsed) / 1000))
          setTimeRemaining(remaining)
        }, 1000)

        // Start polling both PINs for auth completion
        const poll = async () => {
          if (!current()) return
          try {
            // Poll both PINs - user might scan QR or enter short code
            const [strongToken, shortToken] = await Promise.all([
              checkPlexPin(strongPin.id),
              checkPlexPin(manualPin.id),
            ])

            if (!current()) return
            const authToken = strongToken || shortToken
            if (authToken) {
              logger.info('PlexQRAuth', `Authentication successful via ${strongToken ? 'QR' : 'manual PIN'}`)
              cleanup()
              setStatus('success')
              onSuccess?.(authToken)
            }
          } catch (pollError) {
            // Continue polling on transient errors
            logger.debug('PlexQRAuth', 'Poll error, continuing', pollError)
          }
          if (current()) pollIntervalRef.current = setTimeout(poll, pollInterval)
        }
        pollIntervalRef.current = setTimeout(poll, pollInterval)
      } catch (startError) {
        if (!current()) return
        logger.error('PlexQRAuth', 'Failed to start authentication', startError)
        cleanup()
        setStatus('error')
        const err = startError instanceof Error ? startError : new Error('Failed to start authentication')
        setError(err)
        onError?.(err)
      }
    }

    await run()
  }, [cleanup, timeout, autoRestart, pollInterval, onSuccess, onError, onCodeRequested])

  return {
    pin,
    shortPin,
    authUrl,
    status,
    timeRemaining,
    error,
    start,
    cancel,
  }
}
