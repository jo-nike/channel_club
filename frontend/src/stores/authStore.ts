import { create } from 'zustand'
import { logger } from '@/lib/logger'
import { getTokenSubject } from '@/lib/jwt'

interface AuthState {
  generation: number
  token: string | null
  role: 'admin' | 'viewer' | null
  username: string | null
  isAuthenticated: boolean
  isInitializing: boolean
  setAuth: (token: string, role: 'admin' | 'viewer', username?: string) => void
  logout: () => void
  initialize: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  generation: 0,
  token: null,
  role: null,
  username: null,
  isAuthenticated: false,
  isInitializing: true,

  setAuth: (token, role, username) => {
    logger.info('Auth', `User logged in with role: ${role}`)
    logger.debug('Auth', 'Storing token in localStorage')
    try {
      localStorage.setItem('token', token)
      localStorage.setItem('role', role)
      if (username) {
        localStorage.setItem('username', username)
      }
    } catch {
      // Storage blocked: signed in for this page only
    }
    // Plex logins pass no username; the token's subject is the username then
    set({
      generation: get().generation + 1,
      token,
      role,
      username: username || getTokenSubject(token),
      isAuthenticated: true,
    })
  },

  logout: () => {
    logger.info('Auth', 'User logged out')
    logger.debug('Auth', 'Clearing token from localStorage')
    try {
      localStorage.removeItem('token')
      localStorage.removeItem('role')
      localStorage.removeItem('username')
    } catch {
      // Storage blocked: nothing was stored to clear
    }
    set({ generation: get().generation + 1, token: null, role: null, username: null, isAuthenticated: false })
  },

  initialize: () => {
    logger.debug('Auth', 'Initializing auth state from localStorage')
    let token: string | null = null
    let role: 'admin' | 'viewer' | null = null
    let storedUsername: string | null = null
    try {
      token = localStorage.getItem('token')
      role = localStorage.getItem('role') as 'admin' | 'viewer' | null
      storedUsername = localStorage.getItem('username')
    } catch {
      // Storage blocked (a locked-down TV browser): no saved session, show sign-in
    }
    if (token && role) {
      logger.debug('Auth', `Restored session for role: ${role}`)
      const username = storedUsername || getTokenSubject(token)
      set({ generation: get().generation + 1, token, role, username, isAuthenticated: true, isInitializing: false })
    } else {
      logger.debug('Auth', 'No existing session found')
      set({ isInitializing: false })
    }
  },
}))
