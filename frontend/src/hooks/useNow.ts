import { useState, useEffect } from 'react'

/**
 * The current time (ms), refreshed every `intervalMs` while mounted. One
 * interval serves every child the value is passed to, so relative times
 * ("just now") move on without each row running its own timer.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
