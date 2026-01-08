import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@/test/utils'
import { useAuth } from './useAuth'
import { useAuthStore } from '@/stores/authStore'

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
    })
  })

  afterEach(() => {
    localStorage.clear()
  })

  describe('initialization', () => {
    it('should call initialize on mount', () => {
      const initializeSpy = vi.fn()
      useAuthStore.setState({ initialize: initializeSpy })

      renderHook(() => useAuth())

      expect(initializeSpy).toHaveBeenCalled()
    })

    it('should return isAuthenticated as false when no token', () => {
      const { result } = renderHook(() => useAuth())

      expect(result.current.isAuthenticated).toBe(false)
    })

    it('should return isAuthenticated as true when valid token exists', () => {
      // Create a valid JWT token that expires in 1 hour
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'admin',
        isAuthenticated: true,
      })

      const { result } = renderHook(() => useAuth())

      expect(result.current.isAuthenticated).toBe(true)
    })
  })

  describe('token validation', () => {
    it('should call logout when token is expired', async () => {
      const logoutSpy = vi.fn()
      // Create an expired JWT token
      const payload = { exp: Math.floor(Date.now() / 1000) - 3600 } // expired 1 hour ago
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'admin',
        isAuthenticated: true,
        logout: logoutSpy,
      })

      renderHook(() => useAuth())

      await waitFor(() => {
        expect(logoutSpy).toHaveBeenCalled()
      })
    })

    it('should call logout when token is malformed', async () => {
      const logoutSpy = vi.fn()

      useAuthStore.setState({
        token: 'invalid-token',
        role: 'admin',
        isAuthenticated: true,
        logout: logoutSpy,
      })

      renderHook(() => useAuth())

      await waitFor(() => {
        expect(logoutSpy).toHaveBeenCalled()
      })
    })

    it('should not call logout when token is valid', () => {
      const logoutSpy = vi.fn()
      // Create a valid JWT token that expires in 1 hour
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'admin',
        isAuthenticated: true,
        logout: logoutSpy,
      })

      renderHook(() => useAuth())

      expect(logoutSpy).not.toHaveBeenCalled()
    })
  })

  describe('role helpers', () => {
    it('should return isAdmin as true when role is admin', () => {
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'admin',
        isAuthenticated: true,
      })

      const { result } = renderHook(() => useAuth())

      expect(result.current.isAdmin).toBe(true)
      expect(result.current.isViewer).toBe(false)
    })

    it('should return isViewer as true when role is viewer', () => {
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'viewer',
        isAuthenticated: true,
      })

      const { result } = renderHook(() => useAuth())

      expect(result.current.isAdmin).toBe(false)
      expect(result.current.isViewer).toBe(true)
    })
  })

  describe('checkAuth function', () => {
    it('should return token and role when token is valid', () => {
      const payload = { exp: Math.floor(Date.now() / 1000) + 3600 }
      const token = `header.${btoa(JSON.stringify(payload))}.signature`

      useAuthStore.setState({
        token,
        role: 'admin',
        isAuthenticated: true,
      })

      const { result } = renderHook(() => useAuth())

      expect(result.current.token).toBe(token)
      expect(result.current.role).toBe('admin')
    })
  })
})
