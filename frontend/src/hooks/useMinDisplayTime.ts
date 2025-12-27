import { useState, useRef, useEffect } from 'react'

/**
 * Prevents flash of loading state on fast connections by ensuring
 * loading indicators are shown for a minimum amount of time.
 *
 * @param isLoading - The actual loading state
 * @param minTime - Minimum time in ms to show loading state (default 300ms)
 * @returns Whether to show the loading state
 */
export function useMinDisplayTime(isLoading: boolean, minTime = 300): boolean {
  // Track whether we're still in the "extended showing" period after loading stops
  const [isExtending, setIsExtending] = useState(false)
  const loadStartRef = useRef<number>(0)

  // When loading starts, record the start time
  useEffect(() => {
    if (isLoading) {
      loadStartRef.current = Date.now()
      // Reset extending state when new loading starts
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: synchronizing with loading state change
      setIsExtending(false)
    }
  }, [isLoading])

  // When loading stops, check if we need to extend the display
  useEffect(() => {
    if (!isLoading && loadStartRef.current > 0) {
      const elapsed = Date.now() - loadStartRef.current
      const remaining = minTime - elapsed

      if (remaining > 0) {
        // Extend display time - synchronizing with external timing constraint
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: implementing minimum display time
        setIsExtending(true)
        const timer = setTimeout(() => {
          setIsExtending(false)
        }, remaining)
        return () => clearTimeout(timer)
      }
    }
  }, [isLoading, minTime])

  return isLoading || isExtending
}
