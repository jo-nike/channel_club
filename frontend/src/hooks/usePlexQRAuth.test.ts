import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlexQRAuth } from './usePlexQRAuth'
import * as plexAuth from '@/services/plexAuth'

vi.mock('@/services/plexAuth', () => ({
  createPlexPin: vi.fn(),
  checkPlexPin: vi.fn(),
  getPlexAuthUrl: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

describe('usePlexQRAuth', () => {
  const mockStrongPin = { id: 123, code: 'strong-code-abc123', authToken: null }
  const mockShortPin = { id: 456, code: 'ABCD', authToken: null }
  const mockAuthUrl = 'https://app.plex.tv/auth#?code=strong-code-abc123'
  const mockAuthToken = 'plex-auth-token-123'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Mock createPlexPin to return different PINs based on strong parameter
    vi.mocked(plexAuth.createPlexPin).mockImplementation((strong = true) =>
      Promise.resolve(strong ? mockStrongPin : mockShortPin)
    )
    vi.mocked(plexAuth.getPlexAuthUrl).mockReturnValue(mockAuthUrl)
    vi.mocked(plexAuth.checkPlexPin).mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initialization', () => {
    it('should start in idle state', () => {
      const { result } = renderHook(() => usePlexQRAuth())

      expect(result.current.status).toBe('idle')
      expect(result.current.pin).toBeNull()
      expect(result.current.shortPin).toBeNull()
      expect(result.current.authUrl).toBeNull()
      expect(result.current.error).toBeNull()
    })

    it('should have default timeout of 5 minutes', () => {
      const { result } = renderHook(() => usePlexQRAuth())

      expect(result.current.timeRemaining).toBe(300) // 5 * 60 seconds
    })
  })

  describe('start', () => {
    it('should create both PINs and generate auth URL on start', async () => {
      const { result } = renderHook(() => usePlexQRAuth())

      await act(async () => {
        await result.current.start()
      })

      // Should create both strong and short PINs
      expect(plexAuth.createPlexPin).toHaveBeenCalledTimes(2)
      expect(plexAuth.createPlexPin).toHaveBeenCalledWith(true) // strong PIN
      expect(plexAuth.createPlexPin).toHaveBeenCalledWith(false) // short PIN
      expect(plexAuth.getPlexAuthUrl).toHaveBeenCalledWith(mockStrongPin)
      expect(result.current.pin).toEqual(mockStrongPin)
      expect(result.current.shortPin).toEqual(mockShortPin)
      expect(result.current.authUrl).toBe(mockAuthUrl)
      expect(result.current.status).toBe('polling')
    })

    it('should set error status on PIN creation failure', async () => {
      const error = new Error('Network error')
      vi.mocked(plexAuth.createPlexPin).mockRejectedValue(error)

      const onError = vi.fn()
      const { result } = renderHook(() => usePlexQRAuth({ onError }))

      await act(async () => {
        await result.current.start()
      })

      expect(result.current.status).toBe('error')
      expect(result.current.error).toEqual(error)
      expect(onError).toHaveBeenCalledWith(error)
    })
  })

  describe('polling', () => {
    it('should poll both PINs every 2 seconds by default', async () => {
      const { result } = renderHook(() => usePlexQRAuth())

      await act(async () => {
        await result.current.start()
      })

      expect(plexAuth.checkPlexPin).not.toHaveBeenCalled()

      // Advance 2 seconds - first poll (checks both PINs)
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(plexAuth.checkPlexPin).toHaveBeenCalledTimes(2)
      expect(plexAuth.checkPlexPin).toHaveBeenCalledWith(mockStrongPin.id)
      expect(plexAuth.checkPlexPin).toHaveBeenCalledWith(mockShortPin.id)

      // Advance another 2 seconds - second poll
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      expect(plexAuth.checkPlexPin).toHaveBeenCalledTimes(4) // 2 PINs x 2 polls
    })

    it('should respect custom poll interval', async () => {
      const { result } = renderHook(() => usePlexQRAuth({ pollInterval: 5000 }))

      await act(async () => {
        await result.current.start()
      })

      // Advance 2 seconds - no poll yet
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })
      expect(plexAuth.checkPlexPin).not.toHaveBeenCalled()

      // Advance to 5 seconds - first poll (both PINs)
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })
      expect(plexAuth.checkPlexPin).toHaveBeenCalledTimes(2) // 2 PINs
    })

    it('should call onSuccess when strong PIN auth token is received', async () => {
      vi.mocked(plexAuth.checkPlexPin).mockImplementation((pinId) =>
        Promise.resolve(pinId === mockStrongPin.id ? mockAuthToken : null)
      )
      const onSuccess = vi.fn()

      const { result } = renderHook(() => usePlexQRAuth({ onSuccess }))

      await act(async () => {
        await result.current.start()
      })

      // Advance timer and flush promises
      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
      })

      expect(result.current.status).toBe('success')
      expect(onSuccess).toHaveBeenCalledWith(mockAuthToken)
    })

    it('should call onSuccess when short PIN auth token is received', async () => {
      vi.mocked(plexAuth.checkPlexPin).mockImplementation((pinId) =>
        Promise.resolve(pinId === mockShortPin.id ? mockAuthToken : null)
      )
      const onSuccess = vi.fn()

      const { result } = renderHook(() => usePlexQRAuth({ onSuccess }))

      await act(async () => {
        await result.current.start()
      })

      // Advance timer and flush promises
      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
      })

      expect(result.current.status).toBe('success')
      expect(onSuccess).toHaveBeenCalledWith(mockAuthToken)
    })

    it('should stop polling on success', async () => {
      vi.mocked(plexAuth.checkPlexPin).mockResolvedValue(mockAuthToken)

      const { result } = renderHook(() => usePlexQRAuth())

      await act(async () => {
        await result.current.start()
      })

      // Advance timer and flush promises
      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
      })

      expect(result.current.status).toBe('success')

      // Reset mock to track new calls
      vi.mocked(plexAuth.checkPlexPin).mockClear()

      // Advance time - should not poll again
      await act(async () => {
        vi.advanceTimersByTime(4000)
      })

      expect(plexAuth.checkPlexPin).not.toHaveBeenCalled()
    })

    it('should continue polling on transient errors', async () => {
      let callCount = 0
      vi.mocked(plexAuth.checkPlexPin).mockImplementation(() => {
        callCount++
        // First poll (2 calls) - errors
        if (callCount <= 2) {
          return Promise.reject(new Error('Network error'))
        }
        // Second poll (2 calls) - null
        if (callCount <= 4) {
          return Promise.resolve(null)
        }
        // Third poll - success
        return Promise.resolve(mockAuthToken)
      })

      const { result } = renderHook(() => usePlexQRAuth())

      await act(async () => {
        await result.current.start()
      })

      // First poll - error, should continue
      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
      })
      expect(result.current.status).toBe('polling')

      // Second poll - null, should continue
      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
      })
      expect(result.current.status).toBe('polling')

      // Third poll - success
      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
      })

      expect(result.current.status).toBe('success')
    })
  })

  describe('timeout', () => {
    it('should timeout after configured duration', async () => {
      const onError = vi.fn()
      const { result } = renderHook(() =>
        usePlexQRAuth({ timeout: 10000, onError })
      )

      await act(async () => {
        await result.current.start()
      })

      expect(result.current.status).toBe('polling')

      // Advance past timeout
      await act(async () => {
        vi.advanceTimersByTime(10000)
      })

      expect(result.current.status).toBe('timeout')
      expect(result.current.error?.message).toBe('Authentication timed out')
      expect(onError).toHaveBeenCalled()
    })

    it('should update timeRemaining countdown', async () => {
      const { result } = renderHook(() => usePlexQRAuth({ timeout: 10000 }))

      await act(async () => {
        await result.current.start()
      })

      expect(result.current.timeRemaining).toBe(10)

      await act(async () => {
        vi.advanceTimersByTime(3000)
      })

      expect(result.current.timeRemaining).toBe(7)
    })

    it('should stop countdown at 0', async () => {
      const { result } = renderHook(() => usePlexQRAuth({ timeout: 5000 }))

      await act(async () => {
        await result.current.start()
      })

      await act(async () => {
        vi.advanceTimersByTime(6000)
      })

      expect(result.current.timeRemaining).toBe(0)
    })
  })

  describe('cancel', () => {
    it('should reset state on cancel', async () => {
      const { result } = renderHook(() => usePlexQRAuth())

      await act(async () => {
        await result.current.start()
      })

      expect(result.current.status).toBe('polling')
      expect(result.current.pin).not.toBeNull()
      expect(result.current.shortPin).not.toBeNull()

      act(() => {
        result.current.cancel()
      })

      expect(result.current.status).toBe('idle')
      expect(result.current.pin).toBeNull()
      expect(result.current.shortPin).toBeNull()
      expect(result.current.authUrl).toBeNull()
    })

    it('should stop polling on cancel', async () => {
      const { result } = renderHook(() => usePlexQRAuth())

      await act(async () => {
        await result.current.start()
      })

      act(() => {
        result.current.cancel()
      })

      vi.mocked(plexAuth.checkPlexPin).mockClear()

      await act(async () => {
        vi.advanceTimersByTime(4000)
      })

      expect(plexAuth.checkPlexPin).not.toHaveBeenCalled()
    })

    it('should reset timeRemaining on cancel', async () => {
      const { result } = renderHook(() => usePlexQRAuth({ timeout: 10000 }))

      await act(async () => {
        await result.current.start()
      })

      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      expect(result.current.timeRemaining).toBe(5)

      act(() => {
        result.current.cancel()
      })

      expect(result.current.timeRemaining).toBe(10)
    })
  })

  describe('cleanup', () => {
    it('should cleanup on unmount', async () => {
      const { result, unmount } = renderHook(() => usePlexQRAuth())

      await act(async () => {
        await result.current.start()
      })

      unmount()

      vi.mocked(plexAuth.checkPlexPin).mockClear()

      await act(async () => {
        vi.advanceTimersByTime(4000)
      })

      expect(plexAuth.checkPlexPin).not.toHaveBeenCalled()
    })

    it('should cleanup previous timers on restart', async () => {
      const { result } = renderHook(() => usePlexQRAuth({ timeout: 10000 }))

      await act(async () => {
        await result.current.start()
      })

      // Advance halfway
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      // Restart
      await act(async () => {
        await result.current.start()
      })

      // Should be reset to 10 seconds
      expect(result.current.timeRemaining).toBe(10)

      // Wait another 5 seconds - should still have 5 remaining (not timeout)
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      expect(result.current.status).toBe('polling')
      expect(result.current.timeRemaining).toBe(5)
    })
  })
})
