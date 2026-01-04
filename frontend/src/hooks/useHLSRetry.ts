import { useState, useRef, useCallback, useEffect } from 'react'
import { logger } from '@/lib/logger'

const MAX_RETRIES = 5
const INITIAL_BACKOFF = 500 // 500ms
const MAX_BACKOFF = 5000 // 5 seconds

type StreamStatus = 'loading' | 'retrying' | 'ready' | 'failed'

interface UseHLSRetryOptions {
  streamUrl: string
  onReady?: () => void
  onFinalError?: (error: Error) => void
}

interface UseHLSRetryReturn {
  status: StreamStatus
  retryCount: number
  retryKey: number
  handleError: () => void
  handlePlaying: () => void
}

export function useHLSRetry({
  streamUrl,
  onReady,
  onFinalError,
}: UseHLSRetryOptions): UseHLSRetryReturn {
  const [status, setStatus] = useState<StreamStatus>('loading')
  const [retryKey, setRetryKey] = useState(0)
  const [retryCount, setRetryCount] = useState(0)
  const retryTimeoutRef = useRef<number | null>(null)

  // Calculate exponential backoff delay based on current retry count
  const getBackoffDelay = useCallback((count: number) => {
    return Math.min(INITIAL_BACKOFF * Math.pow(2, count), MAX_BACKOFF)
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        window.clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
    }
  }, [])

  const handleError = useCallback(() => {
    // Clear any pending retry
    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    setRetryCount((currentCount) => {
      if (currentCount < MAX_RETRIES) {
        const delay = getBackoffDelay(currentCount)
        logger.debug(
          'HLSRetry',
          `Retry ${currentCount + 1}/${MAX_RETRIES} in ${delay}ms for ${streamUrl}`
        )

        setStatus('retrying')

        retryTimeoutRef.current = window.setTimeout(() => {
          // Increment key to force MediaPlayer remount
          setRetryKey((prev) => prev + 1)
        }, delay)

        return currentCount + 1
      } else {
        logger.warn('HLSRetry', `Max retries (${MAX_RETRIES}) reached for ${streamUrl}`)
        setStatus('failed')
        onFinalError?.(new Error('Stream unavailable after maximum retries'))
        return currentCount
      }
    })
  }, [streamUrl, getBackoffDelay, onFinalError])

  const handlePlaying = useCallback(() => {
    // Clear any pending retry
    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }

    setRetryCount((currentCount) => {
      if (currentCount > 0) {
        logger.info('HLSRetry', `Stream ready after ${currentCount} retries`)
      }
      return 0
    })
    setStatus('ready')
    onReady?.()
  }, [onReady])

  return {
    status,
    retryCount,
    retryKey,
    handleError,
    handlePlaying,
  }
}
