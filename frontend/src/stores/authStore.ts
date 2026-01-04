import { create } from 'zustand'
import { logger } from '@/lib/logger'

interface AuthState {
  token: string | null
  role: 'admin' | 'viewer' | null
  isAuthenticated: boolean
  isInitializing: boolean
  setAuth: (token: string, role: 'admin' | 'viewer') => void
  logout: () => void
  initialize: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  isAuthenticated: false,
  isInitializing: true,

  setAuth: (token, role) => {
    logger.info('Auth', `User logged in with role: ${role}`)
    logger.debug('Auth', 'Storing token in localStorage')
    localStorage.setItem('token', token)
    localStorage.setItem('role', role)
    set({ token, role, isAuthenticated: true })
  },

  logout: () => {
    logger.info('Auth', 'User logged out')
    logger.debug('Auth', 'Clearing token from localStorage')
    localStorage.removeItem('token')
    localStorage.removeItem('role')
    set({ token: null, role: null, isAuthenticated: false })
  },

  initialize: () => {
    logger.debug('Auth', 'Initializing auth state from localStorage')
    const token = localStorage.getItem('token')
    const role = localStorage.getItem('role') as 'admin' | 'viewer' | null
    if (token && role) {
      logger.debug('Auth', `Restored session for role: ${role}`)
      set({ token, role, isAuthenticated: true, isInitializing: false })
    } else {
      logger.debug('Auth', 'No existing session found')
      set({ isInitializing: false })
    }
  },
}))
