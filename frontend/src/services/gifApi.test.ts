import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getGifFeatureEnabled, fetchTrending, searchGifs } from './gifApi'

// Mock the fetchWithAuth function
vi.mock('./api', () => ({
  fetchWithAuth: vi.fn(),
}))

import { fetchWithAuth } from './api'

describe('gifApi service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getGifFeatureEnabled', () => {
    it('returns true when feature is enabled', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ enabled: true }),
      } as Response)

      const result = await getGifFeatureEnabled()

      expect(fetchWithAuth).toHaveBeenCalledWith('/gif/feature')
      expect(result).toBe(true)
    })

    it('returns false when feature is disabled', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ enabled: false }),
      } as Response)

      const result = await getGifFeatureEnabled()

      expect(result).toBe(false)
    })

    it('returns false on request error', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response)

      const result = await getGifFeatureEnabled()

      expect(result).toBe(false)
    })
  })

  describe('fetchTrending', () => {
    it('fetches trending GIFs with default limit', async () => {
      const mockResponse = {
        gifs: [
          { id: 'gif1', url: 'https://giphy.com/gif1.gif', previewUrl: 'https://giphy.com/gif1_small.gif', width: 480, height: 360, title: 'Test' },
        ],
        pagination: { totalCount: 100, count: 1, offset: 0 },
      }

      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)

      const result = await fetchTrending()

      expect(fetchWithAuth).toHaveBeenCalledWith('/gif/trending?limit=25')
      expect(result.gifs).toHaveLength(1)
      expect(result.gifs[0].id).toBe('gif1')
    })

    it('fetches trending GIFs with custom limit', async () => {
      const mockResponse = {
        gifs: [],
        pagination: { totalCount: 0, count: 0, offset: 0 },
      }

      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)

      await fetchTrending(10)

      expect(fetchWithAuth).toHaveBeenCalledWith('/gif/trending?limit=10')
    })

    it('throws error on request failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ detail: 'Service unavailable' }),
      } as Response)

      await expect(fetchTrending()).rejects.toThrow('Service unavailable')
    })

    it('throws default error when no detail provided', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('JSON parse error')),
      } as Response)

      await expect(fetchTrending()).rejects.toThrow('Failed to fetch trending GIFs')
    })
  })

  describe('searchGifs', () => {
    it('searches for GIFs with query', async () => {
      const mockResponse = {
        gifs: [
          { id: 'cat1', url: 'https://giphy.com/cat1.gif', previewUrl: 'https://giphy.com/cat1_small.gif', width: 480, height: 360, title: 'Cat' },
        ],
        pagination: { totalCount: 50, count: 1, offset: 0 },
      }

      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)

      const result = await searchGifs('cats')

      expect(fetchWithAuth).toHaveBeenCalledWith('/gif/search?q=cats&offset=0&limit=25')
      expect(result.gifs).toHaveLength(1)
      expect(result.gifs[0].title).toBe('Cat')
    })

    it('searches with pagination parameters', async () => {
      const mockResponse = {
        gifs: [],
        pagination: { totalCount: 0, count: 0, offset: 25 },
      }

      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)

      await searchGifs('dogs', 25, 10)

      expect(fetchWithAuth).toHaveBeenCalledWith('/gif/search?q=dogs&offset=25&limit=10')
    })

    it('encodes special characters in query', async () => {
      const mockResponse = {
        gifs: [],
        pagination: { totalCount: 0, count: 0, offset: 0 },
      }

      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response)

      await searchGifs('hello world')

      expect(fetchWithAuth).toHaveBeenCalledWith('/gif/search?q=hello+world&offset=0&limit=25')
    })

    it('throws error on request failure', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ detail: 'Search failed' }),
      } as Response)

      await expect(searchGifs('test')).rejects.toThrow('Search failed')
    })
  })
})
