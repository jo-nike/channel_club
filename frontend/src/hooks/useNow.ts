import { useState, useEffect } from 'react'

/**
 * The current time (ms), refreshed every `intervalMs` while mounted and
 * `enabled`. One interval serves every child the value is passed to, so
 * relative times ("just now") move on without each row running its own
 * timer. While disabled it doesn't tick; enabled again, it catches up at once.
 */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    const refresh = () => setNow(Date.now())
    // The value held while paused is stale: catch up straight away
    const catchUp = setTimeout(refresh, 0)
    const timer = setInterval(refresh, intervalMs)
    return () => {
      clearTimeout(catchUp)
      clearInterval(timer)
    }
  }, [intervalMs, enabled])

  return now
}
