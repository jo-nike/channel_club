import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAuthStore } from './authStore'

function base64url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function makeToken(payload: Record<string, unknown>): string {
  return `${base64url({ alg: 'HS256' })}.${base64url(payload)}.signature`
}

describe('authStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAuthStore.setState({
      token: null,
      role: null,
      username: null,
      isAuthenticated: false,
      isInitializing: true,
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

    it('should be initializing initially', () => {
      const state = useAuthStore.getState()
      expect(state.isInitializing).toBe(true)
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

    it('keeps the username it is given', () => {
      useAuthStore.getState().setAuth(makeToken({ sub: 'from-token' }), 'viewer', 'typed-name')

      expect(useAuthStore.getState().username).toBe('typed-name')
    })

    it('derives the username from the token subject when none is given (Plex login)', () => {
      useAuthStore.getState().setAuth(makeToken({ sub: 'Zoë_plex', role: 'viewer' }), 'viewer')

      expect(useAuthStore.getState().username).toBe('Zoë_plex')
    })

    it('leaves the username null when none is given and the token has no subject', () => {
      useAuthStore.getState().setAuth('test-token', 'viewer')

      expect(useAuthStore.getState().username).toBeNull()
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
      expect(state.isInitializing).toBe(false)
    })

    it('derives the username from the stored token when none is stored', () => {
      const token = makeToken({ sub: 'plex-user', role: 'admin' })
      vi.mocked(localStorage.getItem).mockImplementation((key) => {
        if (key === 'token') return token
        if (key === 'role') return 'admin'
        return null
      })

      useAuthStore.getState().initialize()

      expect(useAuthStore.getState().username).toBe('plex-user')
    })

    it('prefers the stored username over the token subject', () => {
      const token = makeToken({ sub: 'plex-user' })
      vi.mocked(localStorage.getItem).mockImplementation((key) => {
        if (key === 'token') return token
        if (key === 'role') return 'viewer'
        if (key === 'username') return 'stored-name'
        return null
      })

      useAuthStore.getState().initialize()

      expect(useAuthStore.getState().username).toBe('stored-name')
    })

    it('should not set auth if localStorage has no token', () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null)

      useAuthStore.getState().initialize()

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(state.isInitializing).toBe(false)
    })
  })

  describe('with site storage blocked', () => {
    const realStorage = window.localStorage
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }

    beforeEach(() => {
      Object.defineProperty(window, 'localStorage', {
        value: { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked },
        writable: true,
      })
    })

    afterEach(() => {
      Object.defineProperty(window, 'localStorage', { value: realStorage, writable: true })
    })

    it('initialize finishes with no saved session instead of throwing', () => {
      expect(() => useAuthStore.getState().initialize()).not.toThrow()

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(state.isInitializing).toBe(false)
    })

    it('setAuth still signs in for this page', () => {
      const token = makeToken({ sub: 'plex-user' })

      expect(() => useAuthStore.getState().setAuth(token, 'viewer')).not.toThrow()

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(true)
      expect(state.token).toBe(token)
      expect(state.username).toBe('plex-user')
    })

    it('logout still signs out', () => {
      useAuthStore.setState({ token: 'test-token', role: 'viewer', username: 'u', isAuthenticated: true })

      expect(() => useAuthStore.getState().logout()).not.toThrow()

      expect(useAuthStore.getState().isAuthenticated).toBe(false)
      expect(useAuthStore.getState().token).toBeNull()
    })
  })
})
