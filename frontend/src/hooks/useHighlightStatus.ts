import { useState, useEffect } from 'react'
import { getHighlightStatus, type HighlightStatusResponse } from '@/services/api'

const defaultStatus: HighlightStatusResponse = {
  enabled: false, recording: false, bufferSeconds: 0, maxBufferSeconds: 60,
}

export interface HighlightStatusResult {
  status: HighlightStatusResponse
  /** False until the first poll for this channel answers (or fails), so the
   *  placeholder status isn't mistaken for "not recording" */
  loaded: boolean
}

/** Poll independently of control visibility to keep the recorder alive. */
export function useHighlightStatus(channelId: string | undefined): HighlightStatusResult {
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
  return result && result.channel === channelId
    ? { status: result.status, loaded: true }
    : { status: defaultStatus, loaded: false }
}
