import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { decodeTokenPayload } from '@/lib/jwt'
import { refreshSession } from '@/services/api'

const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000
const REFRESH_WHEN_EXPIRING_WITHIN_MS = 24 * 60 * 60 * 1000
// How often to check whether a refresh is due; a temporary failure is retried at the next check
const REFRESH_CHECK_MS = 15 * 60 * 1000

// superseded: someone signed in or out while the refresh was in flight
export type AuthRefreshOutcome = 'refreshed' | 'expired' | 'temporary' | 'superseded'

/**
 * Swap the session token for a fresh one. Success replaces it in place
 * (the socket and requests under way carry on); only a 401 signs out; a
 * temporary failure keeps the current token.
 */
export async function refreshAuth(): Promise<AuthRefreshOutcome> {
  const { token, generation } = useAuthStore.getState()
  if (!token) return 'superseded'
  const result = await refreshSession(token)
  const store = useAuthStore.getState()
  if (store.generation !== generation || !store.token) return 'superseded'
  // Another refresh landed while this one was in flight
  if (store.token !== token) return 'refreshed'
  if (result.ok) {
    store.replaceToken(result.token, result.role)
    return 'refreshed'
  }
  if (result.reason === 'expired') {
    store.logout()
    return 'expired'
  }
  return 'temporary'
}

let refreshTimer: ReturnType<typeof setInterval> | null = null
let stopWatchingAuth: (() => void) | null = null
let lastRefreshAt = 0

function expiresSoon(token: string): boolean {
  const exp = decodeTokenPayload(token)?.exp
  return typeof exp === 'number' && exp * 1000 - Date.now() < REFRESH_WHEN_EXPIRING_WITHIN_MS
}

function refreshIfDue() {
  const { token } = useAuthStore.getState()
  if (!token) return
  if (Date.now() - lastRefreshAt < REFRESH_EVERY_MS && !expiresSoon(token)) return
  void refreshAuth()
}

/**
 * Keep the session token fresh: once when the stored session is restored,
 * then every 6 hours, and sooner when it has less than a day left. The
 * server caps renewals at 30 days from the original sign-in.
 */
export function startSessionRefresh(): void {
  if (refreshTimer !== null) return
  refreshTimer = setInterval(refreshIfDue, REFRESH_CHECK_MS)
  stopWatchingAuth = useAuthStore.subscribe((state, prev) => {
    if (prev.isInitializing && !state.isInitializing) {
      if (state.token) void refreshAuth()
    } else if (state.token && state.token !== prev.token) {
      // A sign-in or a refresh: this token is new
      lastRefreshAt = Date.now()
    }
  })
}

export function stopSessionRefresh(): void {
  if (refreshTimer !== null) clearInterval(refreshTimer)
  refreshTimer = null
  stopWatchingAuth?.()
  stopWatchingAuth = null
  lastRefreshAt = 0
}

export function useAuth() {
  const { token, role, username, isAuthenticated, isInitializing, logout, initialize } = useAuthStore()

  useEffect(() => {
    initialize()
  }, [initialize])

  // Check if token is expired (client-side validation)
  useEffect(() => {
    if (token) {
      // base64url-aware: plain atob throws on '-' and '_' and logged valid users out
      const payload = decodeTokenPayload(token)
      if (!payload) {
        logout()
      } else if (typeof payload.exp === 'number' && Date.now() >= payload.exp * 1000) {
        logout()
      }
    }
  }, [token, logout])

  return {
    token,
    role,
    username,
    isAuthenticated,
    isInitializing,
    isAdmin: role === 'admin',
    isViewer: role === 'viewer',
    logout,
  }
}
