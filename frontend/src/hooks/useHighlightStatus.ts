import { useState, useEffect } from 'react'
import { getHighlightStatus, type HighlightStatusResponse } from '@/services/api'

const defaultStatus: HighlightStatusResponse = {
  enabled: false,
  recording: false,
  bufferSeconds: 0,
  maxBufferSeconds: 60,
}

/**
 * Poll highlight recording status for a channel.
 * Runs regardless of UI visibility to keep the backend recorder alive
 * and the buffer accumulating.
 */
export function useHighlightStatus(channelId: string | undefined): HighlightStatusResponse {
  const [status, setStatus] = useState<HighlightStatusResponse>(defaultStatus)

  useEffect(() => {
    if (!channelId) {
      setStatus(defaultStatus)
      return
    }

    const fetchStatus = async () => {
      try {
        const result = await getHighlightStatus(channelId)
        setStatus(result)
      } catch {
        // Silently fail - status is informational
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [channelId])

  return status
}
