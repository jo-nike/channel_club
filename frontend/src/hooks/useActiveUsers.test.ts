import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@/test/utils'
import { useActiveUsers } from './useActiveUsers'

// Mock useAuth hook
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ token: 'test-token' }),
}))

describe('useActiveUsers', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('should start with loading state', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useActiveUsers())

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('should fetch active users data successfully', async () => {
    const mockData = {
      liveUsers: [
        {
          username: 'user1',
          channel: 'Channel 1',
          connectedSince: '2026-01-04T10:00:00Z',
        },
      ],
      ersatztvUsers: [
        {
          username: 'user2',
          channel: 'Movie Channel',
          connectedSince: '2026-01-04T11:00:00Z',
        },
      ],
      totals: {
        liveCount: 1,
        ersatztvCount: 1,
      },
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const { result } = renderHook(() => useActiveUsers())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toEqual(mockData)
    expect(result.current.error).toBeNull()
    expect(global.fetch).toHaveBeenCalledWith('/api/admin/active-users', {
      headers: { Authorization: 'Bearer test-token' },
    })
  })

  it('should handle fetch errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })

    const { result } = renderHook(() => useActiveUsers())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('Failed to fetch: 500')
  })

  it('should handle network errors', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useActiveUsers())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe('Network error')
  })

  it('should poll at 5 second intervals', async () => {
    const mockData = {
      liveUsers: [],
      ersatztvUsers: [],
      totals: {
        liveCount: 0,
        ersatztvCount: 0,
      },
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    renderHook(() => useActiveUsers())

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    // Advance timer by 5 seconds
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

  it('should provide refetch function', async () => {
    const mockData = {
      liveUsers: [],
      ersatztvUsers: [],
      totals: {
        liveCount: 0,
        ersatztvCount: 0,
      },
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const { result } = renderHook(() => useActiveUsers())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
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
      liveUsers: [],
      ersatztvUsers: [],
      totals: {
        liveCount: 0,
        ersatztvCount: 0,
      },
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const { unmount } = renderHook(() => useActiveUsers())

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
})
