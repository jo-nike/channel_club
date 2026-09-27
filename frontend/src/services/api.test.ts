import { describe, it, expect, beforeEach, vi } from 'vitest'
import { login, fetchWithAuth, getAuthConfig, loginWithPlex, createCaptureDownloadUrl } from './api'
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
        '/api/auth/token',
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
        '/api/test-endpoint',
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
        '/api/test-endpoint',
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
        '/api/endpoint',
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

  describe('fetchChannels', () => {
    it('should fetch channels with authentication', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      const mockChannels = [
        { id: '1', name: 'Channel 1', streamUrl: 'http://stream1.m3u8' },
        { id: '2', name: 'Channel 2', streamUrl: 'http://stream2.m3u8' },
      ]

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChannels),
      } as Response)

      const { fetchChannels } = await import('./api')
      const result = await fetchChannels()

      expect(fetch).toHaveBeenCalledWith(
        '/api/channels',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
      expect(result).toEqual(mockChannels)
    })

    it('should throw error when fetch fails', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Server error' }),
      } as Response)

      const { fetchChannels } = await import('./api')
      await expect(fetchChannels()).rejects.toThrow('Failed to fetch channels')
    })

    it('should throw specific error when service unavailable', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ detail: 'Service unavailable' }),
      } as Response)

      const { fetchChannels } = await import('./api')
      await expect(fetchChannels()).rejects.toThrow('Channel service unavailable')
    })

    it('should return typed Channel array', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      const mockChannels = [
        { id: 'abc', name: 'Test Channel', streamUrl: 'http://test.m3u8' },
      ]

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChannels),
      } as Response)

      const { fetchChannels } = await import('./api')
      const result = await fetchChannels()

      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('name')
      expect(result[0]).toHaveProperty('streamUrl')
    })
  })

  describe('setCurrentChannel', () => {
    const mockChannel = { id: '1', name: 'Channel 1', streamUrl: 'http://stream1.m3u8' }

    it('should PUT to /channels/current with channel data', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockChannel),
      } as Response)

      const { setCurrentChannel } = await import('./api')
      const result = await setCurrentChannel(mockChannel)

      expect(fetch).toHaveBeenCalledWith(
        '/api/channels/current',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(mockChannel),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          }),
        })
      )
      expect(result).toEqual(mockChannel)
    })

    it('should throw error on 403 forbidden', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ detail: 'Forbidden' }),
      } as Response)

      const { setCurrentChannel } = await import('./api')
      await expect(setCurrentChannel(mockChannel)).rejects.toThrow('Only admins can change the channel')
    })

    it('should throw generic error on other failures', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Server error' }),
      } as Response)

      const { setCurrentChannel } = await import('./api')
      await expect(setCurrentChannel(mockChannel)).rejects.toThrow('Failed to set channel')
    })
  })

  describe('clearCurrentChannel', () => {
    it.each([
      [403, 'Only admins can stop live TV'],
      [500, 'Could not stop live TV'],
    ])('says a %i failure in the words of stopping live TV', async (status, message) => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status,
        json: () => Promise.resolve({ detail: 'Error' }),
      } as Response)

      const { clearCurrentChannel } = await import('./api')
      await expect(clearCurrentChannel()).rejects.toThrow(message)
    })
  })

  describe('fetchCurrentChannel', () => {
    it('should GET /channels/current and return channel', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      const mockChannel = { id: '1', name: 'Channel 1', streamUrl: 'http://stream1.m3u8' }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ currentChannel: mockChannel }),
      } as Response)

      const { fetchCurrentChannel } = await import('./api')
      const result = await fetchCurrentChannel()

      expect(fetch).toHaveBeenCalledWith(
        '/api/channels/current',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
      expect(result).toEqual(mockChannel)
    })

    it('should return null when no channel is set', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ currentChannel: null }),
      } as Response)

      const { fetchCurrentChannel } = await import('./api')
      const result = await fetchCurrentChannel()

      expect(result).toBeNull()
    })

    it('should throw error on failure', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-token')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Server error' }),
      } as Response)

      const { fetchCurrentChannel } = await import('./api')
      await expect(fetchCurrentChannel()).rejects.toThrow('Failed to fetch current channel')
    })
  })

  describe('fetchNowPlaying', () => {
    const ok = () =>
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ channelId: '28', currentProgram: null }),
      } as Response)

    it('sends the channel name, encoded, for the guide lookup', async () => {
      ok()
      const { fetchNowPlaying } = await import('./api')
      await fetchNowPlaying('5.1', 'CA-S: TSN 5 & More')

      expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
        '/api/epg/now-playing?channel_id=5.1&channel_name=CA-S%3A+TSN+5+%26+More'
      )
    })

    it('leaves the name out when there is none', async () => {
      ok()
      const { fetchNowPlaying } = await import('./api')
      await fetchNowPlaying('28')

      expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/epg/now-playing?channel_id=28')
    })
  })

  describe('fetchLiveProgrammes', () => {
    it('asks for 12 hours by guide id, with the channel name encoded, and returns the schedule', async () => {
      const schedule = {
        channelId: '5.1',
        programmes: [{ title: 'Hockey Night', startTime: '2026-09-26T23:00:00Z', endTime: '2026-09-27T02:00:00Z' }],
      }
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(schedule),
      } as Response)
      const { fetchLiveProgrammes } = await import('./api')

      await expect(fetchLiveProgrammes('5.1', 'CA-S: TSN 5 & More')).resolves.toEqual(schedule)
      expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
        '/api/epg/programmes?channel_id=5.1&hours=12&channel_name=CA-S%3A+TSN+5+%26+More'
      )
    })

    it('throws when the guide is unavailable', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ detail: 'EPG service unavailable' }),
      } as Response)
      const { fetchLiveProgrammes } = await import('./api')

      await expect(fetchLiveProgrammes('28', undefined, 6)).rejects.toThrow('Failed to fetch programmes')
      expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/epg/programmes?channel_id=28&hours=6')
    })
  })

  describe('getAuthConfig', () => {
    it('should GET /auth/config and return auth methods', async () => {
      const mockConfig = {
        localAuthEnabled: true,
        plexAuthEnabled: true,
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockConfig),
      } as Response)

      const result = await getAuthConfig()

      expect(fetch).toHaveBeenCalledWith('/api/auth/config')
      expect(result).toEqual(mockConfig)
    })

    it('should throw error when request fails', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response)

      await expect(getAuthConfig()).rejects.toThrow('Failed to get auth config')
    })
  })

  describe('loginWithPlex', () => {
    it('should POST to /auth/plex with authToken', async () => {
      const mockResponse = {
        accessToken: 'jwt-token-123',
        tokenType: 'bearer',
        role: 'viewer' as const,
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      } as Response)

      const result = await loginWithPlex('plex-auth-token')

      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/plex',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ authToken: 'plex-auth-token' }),
        }
      )
      expect(result).toEqual(mockResponse)
    })

    it('should throw error with detail message on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ detail: 'No access to Plex server' }),
      } as Response)

      await expect(loginWithPlex('plex-token')).rejects.toThrow('No access to Plex server')
    })

    it('should throw default error if no detail provided', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      } as Response)

      await expect(loginWithPlex('bad-token')).rejects.toThrow('Plex authentication failed')
    })
  })

  describe('createCaptureDownloadUrl', () => {
    it('asks for a single-use link with the session header and returns it without the session token', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue('test-jwt-token')
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ url: '/api/highlight/download/single-use-token' }),
      } as Response)

      const url = await createCaptureDownloadUrl('capture-1')

      expect(url).toBe('/api/highlight/download/single-use-token')
      expect(url).not.toContain('test-jwt-token')
      expect(fetch).toHaveBeenCalledWith(
        '/api/highlight/capture/capture-1/download-token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-jwt-token' }),
        })
      )
    })

    it('says the capture is gone when the server no longer has it', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Capture not found' }),
      } as Response)

      await expect(createCaptureDownloadUrl('capture-1')).rejects.toThrow('This capture is no longer available')
    })
  })
})
