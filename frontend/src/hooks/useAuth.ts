import { useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'

export function useAuth() {
  const { token, role, username, isAuthenticated, isInitializing, logout, initialize } = useAuthStore()

  useEffect(() => {
    initialize()
  }, [initialize])

  // Check if token is expired (client-side validation)
  useEffect(() => {
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        const exp = payload.exp * 1000 // Convert to milliseconds
        if (Date.now() >= exp) {
          logout()
        }
      } catch {
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
