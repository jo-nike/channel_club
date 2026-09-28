import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'

interface ActiveUser {
  username: string
  channel: string | null
  channelId: string | null
  // Following the shared Live slot, not a personal pick of whatever is live
  onLive: boolean
  programme: string | null
  connectedSince: string
}

interface ActiveUsersTotals {
  liveCount: number
  ersatztvCount: number
}

interface ActiveUsersData {
  liveUsers: ActiveUser[]
  ersatztvUsers: ActiveUser[]
  totals: ActiveUsersTotals
}

const POLL_INTERVAL = 5000 // 5 seconds

export function useActiveUsers() {
  const [data, setData] = useState<ActiveUsersData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { token } = useAuth()
  const isMounted = useRef(true)

  const fetchUsers = useCallback(async (isManual = false) => {
    if (!token) return

    if (isManual) {
      setIsRefreshing(true)
    }

    try {
      const response = await fetch('/api/admin/active-users', {
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
      if (isMounted.current) {
        setLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [token])

  useEffect(() => {
    isMounted.current = true
    fetchUsers()
    const interval = setInterval(() => fetchUsers(false), POLL_INTERVAL)
    return () => {
      isMounted.current = false
      clearInterval(interval)
    }
  }, [fetchUsers])

  const refetch = useCallback(() => fetchUsers(true), [fetchUsers])

  return { data, loading, error, lastUpdated, isRefreshing, refetch }
}
