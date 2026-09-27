import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { decodeTokenPayload } from '@/lib/jwt'

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
