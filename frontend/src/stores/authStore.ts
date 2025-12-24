import { create } from 'zustand'

interface AuthState {
  token: string | null
  role: 'admin' | 'viewer' | null
  isAuthenticated: boolean
  setAuth: (token: string, role: 'admin' | 'viewer') => void
  logout: () => void
  initialize: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  isAuthenticated: false,

  setAuth: (token, role) => {
    localStorage.setItem('token', token)
    localStorage.setItem('role', role)
    set({ token, role, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('role')
    set({ token: null, role: null, isAuthenticated: false })
  },

  initialize: () => {
    const token = localStorage.getItem('token')
    const role = localStorage.getItem('role') as 'admin' | 'viewer' | null
    if (token && role) {
      set({ token, role, isAuthenticated: true })
    }
  },
}))
