import { create } from 'zustand'
import { logger } from '@/lib/logger'

interface AuthState {
  token: string | null
  role: 'admin' | 'viewer' | null
  username: string | null
  isAuthenticated: boolean
  isInitializing: boolean
  setAuth: (token: string, role: 'admin' | 'viewer', username?: string) => void
  logout: () => void
  initialize: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  username: null,
  isAuthenticated: false,
  isInitializing: true,

  setAuth: (token, role, username) => {
    logger.info('Auth', `User logged in with role: ${role}`)
    logger.debug('Auth', 'Storing token in localStorage')
    localStorage.setItem('token', token)
    localStorage.setItem('role', role)
    if (username) {
      localStorage.setItem('username', username)
    }
    set({ token, role, username: username ?? null, isAuthenticated: true })
  },

  logout: () => {
    logger.info('Auth', 'User logged out')
    logger.debug('Auth', 'Clearing token from localStorage')
    localStorage.removeItem('token')
    localStorage.removeItem('role')
    localStorage.removeItem('username')
    set({ token: null, role: null, username: null, isAuthenticated: false })
  },

  initialize: () => {
    logger.debug('Auth', 'Initializing auth state from localStorage')
    const token = localStorage.getItem('token')
    const role = localStorage.getItem('role') as 'admin' | 'viewer' | null
    const username = localStorage.getItem('username')
    if (token && role) {
      logger.debug('Auth', `Restored session for role: ${role}`)
      set({ token, role, username, isAuthenticated: true, isInitializing: false })
    } else {
      logger.debug('Auth', 'No existing session found')
      set({ isInitializing: false })
    }
  },
}))
