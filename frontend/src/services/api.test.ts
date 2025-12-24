import { describe, it, expect, beforeEach, vi } from 'vitest'
import { login, fetchWithAuth } from './api'
import { useAuthStore } from '@/stores/authStore'

describe('api service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
    useAuthStore.setState({
      token: null,
      role: null,
      isAuthenticated: false,
    })
  })

  describe('login', () => {
    it('should POST to /api/auth/token with credentials', async () => {
      const mockResponse = {
        accessToken: 'test-token',
        tokenType: 'Bearer',
        role: 'admin' as const,
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)

      const result = await login({ username: 'testuser', password: 'testpass' })

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/auth/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'testuser', password: 'testpass' }),
        }
      )
      expect(result).toEqual(mockResponse)
    })

    it('should throw error on failed login with detail message', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ detail: 'Invalid credentials' }),
      } as Response)

      await expect(login({ username: 'bad', password: 'creds' }))
        .rejects.toThrow('Invalid credentials')
    })

    it('should throw default error if no detail provided', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      } as Response)

      await expect(login({ username: 'bad', password: 'creds' }))
        .rejects.toThrow('Invalid credentials')
    })

    it('should handle JSON parsing failure gracefully', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        json: () => Promise.reject(new Error('Invalid JSON')),
      } as Response)

      await expect(login({ username: 'bad', password: 'creds' }))
        .rejects.toThrow('Login failed')
    })
  })

  describe('fetchWithAuth', () => {
    it('should add Authorization header when token exists', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-jwt-token')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'test' }),
      } as Response)

      await fetchWithAuth('/test-endpoint')

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/test-endpoint',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-jwt-token',
          }),
        })
      )
    })

    it('should not add Authorization header when no token', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null)

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'test' }),
      } as Response)

      await fetchWithAuth('/test-endpoint')

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/test-endpoint',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
          },
        })
      )
    })

    it('should call logout on 401 response', async () => {
      const logoutSpy = vi.fn()
      useAuthStore.setState({ logout: logoutSpy })
      vi.mocked(localStorage.getItem).mockReturnValue('expired-token')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: 'Token expired' }),
      } as Response)

      await expect(fetchWithAuth('/protected')).rejects.toThrow('Session expired')
      expect(logoutSpy).toHaveBeenCalled()
    })

    it('should return response on successful request', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('valid-token')

      const mockResponse = {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ channels: [] }),
      } as Response

      vi.mocked(fetch).mockResolvedValueOnce(mockResponse)

      const response = await fetchWithAuth('/channels')

      expect(response).toBe(mockResponse)
    })

    it('should merge custom options with defaults', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response)

      await fetchWithAuth('/endpoint', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      })

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/endpoint',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ data: 'test' }),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          }),
        })
      )
    })
  })
})
