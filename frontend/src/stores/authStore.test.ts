import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuthStore } from './authStore'

describe('authStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
    })
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have null token initially', () => {
      const state = useAuthStore.getState()
      expect(state.token).toBeNull()
    })

    it('should have null role initially', () => {
      const state = useAuthStore.getState()
      expect(state.role).toBeNull()
    })

    it('should not be authenticated initially', () => {
      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
    })
  })

  describe('setAuth', () => {
    it('should set token and role correctly', () => {
      useAuthStore.getState().setAuth('test-token', 'admin')

      const state = useAuthStore.getState()
      expect(state.token).toBe('test-token')
      expect(state.role).toBe('admin')
      expect(state.isAuthenticated).toBe(true)
    })

    it('should store token in localStorage', () => {
      useAuthStore.getState().setAuth('test-token', 'viewer')

      expect(localStorage.setItem).toHaveBeenCalledWith('token', 'test-token')
      expect(localStorage.setItem).toHaveBeenCalledWith('role', 'viewer')
    })
  })

  describe('logout', () => {
    it('should clear auth state', () => {
      // Set up initial authenticated state
      useAuthStore.setState({
        token: 'test-token',
        role: 'admin',
        isAuthenticated: true,
      })

      useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.token).toBeNull()
      expect(state.role).toBeNull()
      expect(state.isAuthenticated).toBe(false)
    })

    it('should remove items from localStorage', () => {
      useAuthStore.getState().logout()

      expect(localStorage.removeItem).toHaveBeenCalledWith('token')
      expect(localStorage.removeItem).toHaveBeenCalledWith('role')
    })
  })

  describe('initialize', () => {
    it('should restore auth state from localStorage if token and role exist', () => {
      vi.mocked(localStorage.getItem).mockImplementation((key) => {
        if (key === 'token') return 'stored-token'
        if (key === 'role') return 'admin'
        return null
      })

      useAuthStore.getState().initialize()

      const state = useAuthStore.getState()
      expect(state.token).toBe('stored-token')
      expect(state.role).toBe('admin')
      expect(state.isAuthenticated).toBe(true)
    })

    it('should not set auth if localStorage has no token', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null)

      useAuthStore.getState().initialize()

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
    })
  })
})
