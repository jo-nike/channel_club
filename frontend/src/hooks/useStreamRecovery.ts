import { useState, useRef, useCallback, useEffect } from 'react'
import { logger } from '@/lib/logger'

/**
 * - loading: the first attempt (or a Retry) is starting
 * - ready: the stream plays
 * - reconnecting: it failed and an automatic reconnect is waiting or starting
 * - failed: every automatic reconnect failed; only a Retry starts another
 */
export type StreamRecoveryStatus = 'loading' | 'ready' | 'reconnecting' | 'failed'

export const DEFAULT_MAX_RETRIES = 5
// Each live reconnect opens a new upstream connection, so the waits grow and
// the attempts are capped: friends reconnecting at once can hit the stream limit
export const DEFAULT_BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 8000]

interface UseStreamRecoveryOptions {
  maxRetries?: number
  /** The wait before each reconnect; the last entry repeats */
  backoffMs?: readonly number[]
}

interface UseStreamRecoveryReturn {
  status: StreamRecoveryStatus
  /** The reconnect under way, 1-based (0 when none is): '2 of 5' is attempt 2 */
  attempt: number
  maxRetries: number
  /** Changes when the engine should start the stream again */
  retryKey: number
  /** The stream failed: schedule the next reconnect, or give up after the last */
  fail: () => void
  /** The stream plays: the attempt count starts over */
  succeed: () => void
  /** Start again now with a full set of attempts (the Retry button) */
  retryNow: () => void
}

interface RecoveryState {
  status: StreamRecoveryStatus
  attempt: number
}

/**
 * One recovery model for both players: on each failure the engine is started
 * again after a growing wait, up to maxRetries times, and then it stops with
 * a Retry. Several reports of one failure (an engine error and the element's
 * error, say) count once: a failure while a reconnect is waiting is ignored.
 */
export function useStreamRecovery({
  maxRetries = DEFAULT_MAX_RETRIES,
  backoffMs = DEFAULT_BACKOFF_MS,
}: UseStreamRecoveryOptions = {}): UseStreamRecoveryReturn {
  const [state, setState] = useState<RecoveryState>({ status: 'loading', attempt: 0 })
  const [retryKey, setRetryKey] = useState(0)
  const attemptRef = useRef(0)
  const hasFailedRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => clearTimer, [clearTimer])

  const fail = useCallback(() => {
    // Already waiting to reconnect, or given up: the same failure again
    if (timerRef.current !== null || hasFailedRef.current) return

    if (attemptRef.current >= maxRetries) {
      logger.warn('StreamRecovery', `Stopped after ${maxRetries} reconnects`)
      hasFailedRef.current = true
      setState({ status: 'failed', attempt: attemptRef.current })
      return
    }

    const attempt = attemptRef.current + 1
    const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0
    logger.debug('StreamRecovery', `Reconnect ${attempt}/${maxRetries} in ${delay}ms`)
    attemptRef.current = attempt
    setState({ status: 'reconnecting', attempt })
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setRetryKey((key) => key + 1)
    }, delay)
  }, [maxRetries, backoffMs])

  const succeed = useCallback(() => {
    clearTimer()
    if (attemptRef.current > 0) logger.info('StreamRecovery', `Playing after ${attemptRef.current} reconnects`)
    attemptRef.current = 0
    hasFailedRef.current = false
    // 'playing' fires after every stall, so keep the same state when nothing changed
    setState((prev) => (prev.status === 'ready' && prev.attempt === 0 ? prev : { status: 'ready', attempt: 0 }))
  }, [clearTimer])

  const retryNow = useCallback(() => {
    clearTimer()
    attemptRef.current = 0
    hasFailedRef.current = false
    setState({ status: 'loading', attempt: 0 })
    setRetryKey((key) => key + 1)
  }, [clearTimer])

  return {
    status: state.status,
    attempt: state.attempt,
    maxRetries,
    retryKey,
    fail,
    succeed,
    retryNow,
  }
}
