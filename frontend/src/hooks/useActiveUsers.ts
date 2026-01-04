import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'

interface ActiveUser {
  username: string
  channel: string | null
  connectedSince: string
  bitrateMbps: number
}

interface ActiveUsersTotals {
  liveCount: number
  ersatztvCount: number
  liveBitrateMbps: number
  ersatztvBitrateMbps: number
  totalBitrateMbps: number
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
  const { token } = useAuth()

  const fetchUsers = useCallback(async () => {
    if (!token) return

    try {
      const response = await fetch('/api/admin/active-users', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`)
      }

      const responseData = await response.json()
      setData(responseData)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchUsers()
    const interval = setInterval(fetchUsers, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchUsers])

  return { data, loading, error, refetch: fetchUsers }
}
