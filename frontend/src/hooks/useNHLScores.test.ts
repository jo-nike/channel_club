import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@/test/utils'
import { useNHLScores } from './useNHLScores'

describe('useNHLScores', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('should start with loading state when enabled', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useNHLScores(true))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('should not fetch when disabled', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useNHLScores(false))

    expect(result.current.isLoading).toBe(false)
    expect(result.current.data).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('should fetch NHL scores successfully', async () => {
    const mockData = {
      games: [
        {
          id: 2024020123,
          status: 'live',
          homeTeam: {
            name: 'Boston Bruins',
            abbreviation: 'BOS',
            score: 2,
            logo: 'https://test.com/bos_light.svg',
            logoDark: 'https://test.com/bos_dark.svg',
          },
          awayTeam: {
            name: 'Montreal Canadiens',
            abbreviation: 'MTL',
            score: 1,
            logo: 'https://test.com/mtl_light.svg',
            logoDark: 'https://test.com/mtl_dark.svg',
          },
          startTime: '2026-01-15T00:00:00Z',
          gameCenterLink: 'https://nhl.com/gamecenter/test',
          period: '2nd',
          timeRemaining: '08:45',
          isIntermission: false,
        },
      ],
      date: '2026-01-15',
      liveGameCount: 1,
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const { result } = renderHook(() => useNHLScores(true))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toEqual(mockData)
    expect(result.current.error).toBeNull()
    expect(global.fetch).toHaveBeenCalledWith('/api/nhl/scores', expect.anything())
  })

  it('should send the signed-in token with the request', async () => {
    localStorage.setItem('token', 'test-token')
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ games: [], date: '2026-01-15', liveGameCount: 0 }),
    })

    try {
      const { result } = renderHook(() => useNHLScores(true))

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/nhl/scores',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      )
    } finally {
      localStorage.removeItem('token')
    }
  })

  it('should handle fetch errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    })

    const { result } = renderHook(() => useNHLScores(true))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toContain('503')
  })

  it('should handle network errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useNHLScores(true))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('Network error')
  })

  it('should poll at 5 second intervals when live games exist', async () => {
    const mockData = {
      games: [
        {
          id: 1,
          status: 'live',
          homeTeam: { name: 'A', abbreviation: 'A', score: 1, logo: '', logoDark: '' },
          awayTeam: { name: 'B', abbreviation: 'B', score: 0, logo: '', logoDark: '' },
          startTime: '2026-01-15T00:00:00Z',
          gameCenterLink: '',
          period: '2nd',
          timeRemaining: '10:00',
        },
      ],
      date: '2026-01-15',
      liveGameCount: 1, // Live game triggers fast polling
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    renderHook(() => useNHLScores(true))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    // Advance timer by 5 seconds - should poll because live games exist
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    // Advance timer by another 5 seconds
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3)
    })
  })

  it('should stop polling when disabled', async () => {
    const mockData = {
      games: [],
      date: '2026-01-15',
      liveGameCount: 0,
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const { rerender } = renderHook(({ enabled }) => useNHLScores(enabled), {
      initialProps: { enabled: true },
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    // Disable the hook
    rerender({ enabled: false })

    // Advance timer - fetch should not be called again
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('should resume polling when re-enabled', async () => {
    const mockData = {
      games: [],
      date: '2026-01-15',
      liveGameCount: 0,
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const { rerender } = renderHook(({ enabled }) => useNHLScores(enabled), {
      initialProps: { enabled: true },
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    // Disable the hook
    rerender({ enabled: false })

    // Re-enable the hook
    rerender({ enabled: true })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  it('should provide refetch function', async () => {
    const mockData = {
      games: [],
      date: '2026-01-15',
      liveGameCount: 0,
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const { result } = renderHook(() => useNHLScores(true))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.refetch()
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })

  it('should clear interval on unmount', async () => {
    const mockData = {
      games: [],
      date: '2026-01-15',
      liveGameCount: 0,
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const { unmount } = renderHook(() => useNHLScores(true))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    unmount()

    // Advance timer - fetch should not be called again
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('should handle empty games array', async () => {
    const mockData = {
      games: [],
      date: '2026-07-15',
      liveGameCount: 0,
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const { result } = renderHook(() => useNHLScores(true))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data?.games).toEqual([])
    expect(result.current.data?.liveGameCount).toBe(0)
  })

  it('should use slower polling when no live games', async () => {
    const mockData = {
      games: [
        {
          id: 1,
          status: 'final',
          homeTeam: { name: 'A', abbreviation: 'A', score: 1, logo: '', logoDark: '' },
          awayTeam: { name: 'B', abbreviation: 'B', score: 0, logo: '', logoDark: '' },
          startTime: '2026-01-15T00:00:00Z',
          gameCenterLink: '',
        },
      ],
      date: '2026-01-15',
      liveGameCount: 0, // No live games
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    renderHook(() => useNHLScores(true))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    // With no live games, should poll at 30 second intervals instead of 5
    // Advance by 5 seconds - should NOT trigger another fetch
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    // Still only 1 call because we're now on slow polling
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // Advance by 25 more seconds (total 30s) - should trigger fetch
    await act(async () => {
      vi.advanceTimersByTime(25000)
    })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })
})
