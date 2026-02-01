import { useState, useEffect, useCallback, useRef } from 'react'
import type { NHLScoresResponse } from '@/types/nhl'

/** Fast polling interval when live games are in progress (5 seconds) */
const LIVE_POLL_INTERVAL = 5000

/** Slower polling interval when no live games (30 seconds) */
const IDLE_POLL_INTERVAL = 30000

/**
 * Hook for fetching and polling NHL scores with adaptive polling.
 *
 * Polling behavior:
 * - When live games exist: polls every 5 seconds for real-time updates
 * - When no live games: polls every 30 seconds to check for game starts
 * - When disabled: no polling occurs
 *
 * @param enabled - Whether to enable polling. When false, pauses all fetching.
 * @returns NHL scores data, loading state, error, and refetch function.
 */
export function useNHLScores(enabled: boolean) {
  const [data, setData] = useState<NHLScoresResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const isMounted = useRef(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentIntervalMs = useRef<number>(LIVE_POLL_INTERVAL)

  const fetchScores = useCallback(async () => {
    try {
      const response = await fetch('/api/nhl/scores')

      if (!response.ok) {
        throw new Error(`Failed to fetch NHL scores: ${response.status}`)
      }

      const responseData: NHLScoresResponse = await response.json()
      if (isMounted.current) {
        setData(responseData)
        setError(null)

        // Adjust polling interval based on live game count
        const newInterval =
          responseData.liveGameCount > 0 ? LIVE_POLL_INTERVAL : IDLE_POLL_INTERVAL

        // Restart interval if it changed
        if (newInterval !== currentIntervalMs.current && intervalRef.current) {
          clearInterval(intervalRef.current)
          currentIntervalMs.current = newInterval
          intervalRef.current = setInterval(fetchScores, newInterval)
        }
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err : new Error('Unknown error'))
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false)
      }
    }
  }, [])

  const refetch = useCallback(() => {
    setIsLoading(true)
    return fetchScores()
  }, [fetchScores])

  useEffect(() => {
    isMounted.current = true

    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (enabled) {
      // Initial fetch
      setIsLoading(true)
      currentIntervalMs.current = LIVE_POLL_INTERVAL // Start with fast polling
      fetchScores()

      // Set up polling (will adjust after first fetch based on live games)
      intervalRef.current = setInterval(fetchScores, currentIntervalMs.current)
    } else {
      // Reset loading state when disabled
      setIsLoading(false)
    }

    return () => {
      isMounted.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [enabled, fetchScores])

  return { data, isLoading, error, refetch }
}
