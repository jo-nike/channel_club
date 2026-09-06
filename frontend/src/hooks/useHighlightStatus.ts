import { useState, useEffect } from 'react'
import { getHighlightStatus, type HighlightStatusResponse } from '@/services/api'

const defaultStatus: HighlightStatusResponse = {
  enabled: false, recording: false, bufferSeconds: 0, maxBufferSeconds: 60,
}

/** Poll independently of control visibility to keep the recorder alive. */
export function useHighlightStatus(channelId: string | undefined): HighlightStatusResponse {
  const [result, setResult] = useState<{ channel: string; status: HighlightStatusResponse } | null>(null)
  useEffect(() => {
    if (!channelId) return
    const controller = new AbortController()
    let pending = false
    const fetchStatus = async () => {
      if (pending) return
      pending = true
      try {
        const status = await getHighlightStatus(channelId, controller.signal)
        if (!controller.signal.aborted) setResult({ channel: channelId, status })
      } catch {
        if (!controller.signal.aborted) setResult({ channel: channelId, status: defaultStatus })
      } finally { pending = false }
    }
    void fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => { controller.abort(); clearInterval(interval) }
  }, [channelId])
  return result && result.channel === channelId ? result.status : defaultStatus
}
