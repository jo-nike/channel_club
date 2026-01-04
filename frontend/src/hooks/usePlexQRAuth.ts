import { useState, useCallback, useRef, useEffect } from 'react'
import { createPlexPin, checkPlexPin, getPlexAuthUrl, type PlexPin } from '@/services/plexAuth'
import { logger } from '@/lib/logger'

export type PlexQRAuthStatus = 'idle' | 'polling' | 'success' | 'timeout' | 'error'

export interface UsePlexQRAuthOptions {
  pollInterval?: number // default: 2000ms
  timeout?: number // default: 5 minutes in ms
  onSuccess?: (authToken: string) => void
  onError?: (error: Error) => void
}

export interface UsePlexQRAuthReturn {
  pin: PlexPin | null
  authUrl: string | null
  status: PlexQRAuthStatus
  timeRemaining: number // seconds remaining
  error: Error | null
  start: () => Promise<void>
  cancel: () => void
}

const DEFAULT_POLL_INTERVAL = 2000
const DEFAULT_TIMEOUT = 5 * 60 * 1000 // 5 minutes

/**
 * Hook for QR code-based Plex authentication flow.
 * Creates a PIN, generates QR auth URL, and polls for completion.
 */
export function usePlexQRAuth(options: UsePlexQRAuthOptions = {}): UsePlexQRAuthReturn {
  const {
    pollInterval = DEFAULT_POLL_INTERVAL,
    timeout = DEFAULT_TIMEOUT,
    onSuccess,
    onError,
  } = options

  const [pin, setPin] = useState<PlexPin | null>(null)
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<PlexQRAuthStatus>('idle')
  const [timeRemaining, setTimeRemaining] = useState(Math.floor(timeout / 1000))
  const [error, setError] = useState<Error | null>(null)

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startTimeRef = useRef<number>(0)

  const cleanup = useCallback(() => {
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
    setAuthUrl(null)
    setTimeRemaining(Math.floor(timeout / 1000))
  }, [cleanup, timeout])

  const start = useCallback(async () => {
    logger.debug('PlexQRAuth', 'Starting QR authentication flow')
    cleanup()
    setError(null)
    setStatus('polling')
    setTimeRemaining(Math.floor(timeout / 1000))
    startTimeRef.current = Date.now()

    try {
      // Create PIN
      const newPin = await createPlexPin()
      setPin(newPin)

      // Generate auth URL
      const url = getPlexAuthUrl(newPin)
      setAuthUrl(url)
      logger.debug('PlexQRAuth', `PIN created: ${newPin.id}, code: ${newPin.code}`)

      // Start countdown timer
      countdownIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current
        const remaining = Math.max(0, Math.floor((timeout - elapsed) / 1000))
        setTimeRemaining(remaining)
      }, 1000)

      // Start polling for auth completion
      pollIntervalRef.current = setInterval(async () => {
        try {
          const authToken = await checkPlexPin(newPin.id)
          if (authToken) {
            logger.info('PlexQRAuth', 'Authentication successful')
            cleanup()
            setStatus('success')
            onSuccess?.(authToken)
          }
        } catch (pollError) {
          // Continue polling on transient errors
          logger.debug('PlexQRAuth', 'Poll error, continuing', pollError)
        }
      }, pollInterval)

      // Set timeout
      timeoutRef.current = setTimeout(() => {
        logger.error('PlexQRAuth', 'Authentication timed out')
        cleanup()
        setStatus('timeout')
        const timeoutError = new Error('Authentication timed out')
        setError(timeoutError)
        onError?.(timeoutError)
      }, timeout)
    } catch (startError) {
      logger.error('PlexQRAuth', 'Failed to start authentication', startError)
      cleanup()
      setStatus('error')
      const err = startError instanceof Error ? startError : new Error('Failed to start authentication')
      setError(err)
      onError?.(err)
    }
  }, [cleanup, timeout, pollInterval, onSuccess, onError])

  return {
    pin,
    authUrl,
    status,
    timeRemaining,
    error,
    start,
    cancel,
  }
}
