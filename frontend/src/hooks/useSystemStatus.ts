import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'

interface ErsatzTVSession {
  channelNumber: number
  channelName: string | null
  state: string | null
  bufferSeconds: number | null
  streamingMode: string | null
  resolution: string | null
  videoCodec: string | null
  videoBitrate: number | null
  audioCodec: string | null
  audioBitrate: number | null
}

interface ErsatzTVStatus {
  name: string
  online: boolean
  degraded: boolean
  lastChecked: string
  error: string | null
  activeSessions: number
  sessions: ErsatzTVSession[]
}

interface DispatcharrStream {
  channelId: string
  streamName: string
  state: string
  clientCount: number
  uptime: number
  totalBytes: number
  avgBitrate: string
  videoCodec: string | null
  resolution: string | null
  sourceFps: number | null
}

interface DispatchrrStatus {
  name: string
  online: boolean
  degraded: boolean
  lastChecked: string
  error: string | null
  activeStreams: number
  totalViewers: number
  streams: DispatcharrStream[]
}

interface EPGHealthStatus {
  name: string
  online: boolean
  lastChecked: string
  error: string | null
  stale: boolean
  channelCount: number
  programmeCount: number
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  nextRetryAt: string | null
}

export interface SystemStatusData {
  ersatztv: ErsatzTVStatus
  dispatcharr: DispatchrrStatus
  epg: EPGHealthStatus
  // Optional: a backend from before the ErsatzTV guide was reported omits it
  ersatztvGuide?: EPGHealthStatus
}

const POLL_INTERVAL = 30000 // 30 seconds

export function useSystemStatus() {
  const [data, setData] = useState<SystemStatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { token } = useAuth()
  const isMounted = useRef(true)
  // A slow status request must not have the next poll stacked on top of it
  const inFlight = useRef(false)

  const fetchStatus = useCallback(async (isManual = false) => {
    if (!token || inFlight.current) return
    inFlight.current = true

    if (isManual) {
      setIsRefreshing(true)
    }

    try {
      const response = await fetch('/api/admin/status', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`)
      }

      const responseData = await response.json()
      if (isMounted.current) {
        setData(responseData)
        setLastUpdated(new Date())
        setError(null)
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    } finally {
      inFlight.current = false
      if (isMounted.current) {
        setLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [token])

  useEffect(() => {
    isMounted.current = true
    fetchStatus()
    const interval = setInterval(() => fetchStatus(false), POLL_INTERVAL)
    return () => {
      isMounted.current = false
      clearInterval(interval)
    }
  }, [fetchStatus])

  const refetch = useCallback(() => fetchStatus(true), [fetchStatus])

  return { data, loading, error, lastUpdated, isRefreshing, refetch }
}
