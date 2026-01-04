import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchErsatzTVChannels,
  fetchErsatzTVProgrammes,
  fetchErsatzTVCurrentProgramme,
  getErsatzTVStreamUrl,
  getErsatzTVLogoUrl,
} from './ersatztvApi'
import { fetchWithAuth } from '@/services/api'

// Mock fetchWithAuth
vi.mock('@/services/api', () => ({
  fetchWithAuth: vi.fn(),
}))

describe('ersatztvApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('fetchErsatzTVChannels', () => {
    it('returns channels on success', async () => {
      const mockChannels = [
        {
          id: 'ch1',
          name: 'Test Channel',
          streamUrl: 'http://test/stream',
          logoUrl: 'http://test/logo',
          number: 1,
          group: 'Movies',
        },
      ]
      vi.mocked(fetchWithAuth).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ channels: mockChannels }),
      } as Response)

      const result = await fetchErsatzTVChannels()
      expect(result).toEqual(mockChannels)
      expect(fetchWithAuth).toHaveBeenCalledWith('/ersatztv/channels')
    })

    it('throws on 503 service unavailable', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue({
        ok: false,
        status: 503,
      } as Response)

      await expect(fetchErsatzTVChannels()).rejects.toThrow(
        'ErsatzTV service unavailable'
      )
    })

    it('throws generic error on other failures', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response)

      await expect(fetchErsatzTVChannels()).rejects.toThrow(
        'Failed to fetch channels'
      )
    })
  })

  describe('fetchErsatzTVProgrammes', () => {
    it('returns programmes for a channel', async () => {
      const mockResponse = {
        channelId: 'ch1',
        programmes: [
          {
            id: 'prog1',
            channelId: 'ch1',
            title: 'Test Movie',
            start: '2024-01-01T10:00:00Z',
            stop: '2024-01-01T12:00:00Z',
          },
        ],
      }
      vi.mocked(fetchWithAuth).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)

      const result = await fetchErsatzTVProgrammes('ch1', 6)
      expect(result).toEqual(mockResponse)
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/ersatztv/programmes/ch1?hours=6'
      )
    })

    it('uses default hours value of 6', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ channelId: 'ch1', programmes: [] }),
      } as Response)

      await fetchErsatzTVProgrammes('ch1')
      expect(fetchWithAuth).toHaveBeenCalledWith(
        '/ersatztv/programmes/ch1?hours=6'
      )
    })

    it('throws on failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response)

      await expect(fetchErsatzTVProgrammes('ch1')).rejects.toThrow(
        'Failed to fetch programmes'
      )
    })
  })

  describe('fetchErsatzTVCurrentProgramme', () => {
    it('returns current and next programme', async () => {
      const mockResponse = {
        channelId: 'ch1',
        current: {
          id: 'prog1',
          channelId: 'ch1',
          title: 'Current Movie',
          start: '2024-01-01T10:00:00Z',
          stop: '2024-01-01T12:00:00Z',
        },
        nextUp: {
          id: 'prog2',
          channelId: 'ch1',
          title: 'Next Movie',
          start: '2024-01-01T12:00:00Z',
          stop: '2024-01-01T14:00:00Z',
        },
      }
      vi.mocked(fetchWithAuth).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)

      const result = await fetchErsatzTVCurrentProgramme('ch1')
      expect(result).toEqual(mockResponse)
      expect(fetchWithAuth).toHaveBeenCalledWith('/ersatztv/current/ch1')
    })

    it('throws on failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue({
        ok: false,
        status: 500,
      } as Response)

      await expect(fetchErsatzTVCurrentProgramme('ch1')).rejects.toThrow(
        'Failed to fetch current programme'
      )
    })
  })

  describe('getErsatzTVStreamUrl', () => {
    it('returns proxied URL with token', () => {
      localStorage.setItem('token', 'test-token')
      const url = getErsatzTVStreamUrl('channel-1')
      expect(url).toContain('/ersatztv/stream/channel-1')
      expect(url).toContain('token=test-token')
    })

    it('handles null token', () => {
      const url = getErsatzTVStreamUrl('channel-1')
      expect(url).toContain('/ersatztv/stream/channel-1')
      expect(url).toContain('token=null')
    })
  })

  describe('getErsatzTVLogoUrl', () => {
    it('returns logo URL for channel', () => {
      const url = getErsatzTVLogoUrl('channel-1')
      expect(url).toContain('/ersatztv/logos/channel-1')
    })
  })
})
