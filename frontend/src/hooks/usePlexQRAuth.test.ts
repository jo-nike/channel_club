import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { usePlexQRAuth, MAX_AUTO_RESTARTS } from './usePlexQRAuth'
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

  describe('autoRestart', () => {
    /** Resolves PIN creation with a fresh pair each time, so restarts are visible. */
    function freshPinsEachStart() {
      let n = 0
      vi.mocked(plexAuth.createPlexPin).mockImplementation((strong = true) => {
        if (strong) n += 1
        return Promise.resolve(strong
          ? { id: 100 + n, code: `strong-${n}`, authToken: null }
          : { id: 200 + n, code: `CODE${n}`, authToken: null })
      })
    }

    async function timeOut(ms: number) {
      await act(async () => {
        vi.advanceTimersByTime(ms)
      })
    }

    it('starts over with fresh PINs on timeout instead of stopping', async () => {
      freshPinsEachStart()
      const onError = vi.fn()
      const { result } = renderHook(() =>
        usePlexQRAuth({ timeout: 10000, autoRestart: true, onError })
      )

      await act(async () => {
        await result.current.start()
      })
      expect(result.current.shortPin?.code).toBe('CODE1')

      await timeOut(10000)

      expect(plexAuth.createPlexPin).toHaveBeenCalledTimes(4)
      expect(result.current.status).toBe('polling')
      expect(result.current.shortPin?.code).toBe('CODE2')
      expect(result.current.timeRemaining).toBe(10)
      expect(result.current.error).toBeNull()
      expect(onError).not.toHaveBeenCalled()
    })

    it(`restarts at most ${MAX_AUTO_RESTARTS} times, then times out for Try Again`, async () => {
      freshPinsEachStart()
      const onError = vi.fn()
      const { result } = renderHook(() =>
        usePlexQRAuth({ timeout: 10000, autoRestart: true, onError })
      )

      await act(async () => {
        await result.current.start()
      })
      for (let i = 0; i < MAX_AUTO_RESTARTS; i++) {
        await timeOut(10000)
        expect(result.current.status).toBe('polling')
      }
      expect(result.current.shortPin?.code).toBe(`CODE${MAX_AUTO_RESTARTS + 1}`)

      await timeOut(10000)

      expect(result.current.status).toBe('timeout')
      expect(result.current.error?.message).toBe('Authentication timed out')
      expect(onError).toHaveBeenCalledTimes(1)
      // One pair of PINs per attempt: the first plus three restarts
      expect(plexAuth.createPlexPin).toHaveBeenCalledTimes(2 * (MAX_AUTO_RESTARTS + 1))

      // Nothing more happens while the TV sits on Try Again
      vi.mocked(plexAuth.checkPlexPin).mockClear()
      await timeOut(60000)
      expect(plexAuth.createPlexPin).toHaveBeenCalledTimes(2 * (MAX_AUTO_RESTARTS + 1))
      expect(plexAuth.checkPlexPin).not.toHaveBeenCalled()
    })

    it('stops polling the expired PINs once it restarts', async () => {
      freshPinsEachStart()
      const { result } = renderHook(() =>
        usePlexQRAuth({ timeout: 10000, pollInterval: 2000, autoRestart: true })
      )

      await act(async () => {
        await result.current.start()
      })
      await timeOut(10000)
      vi.mocked(plexAuth.checkPlexPin).mockClear()

      await timeOut(2000)

      const polledIds = vi.mocked(plexAuth.checkPlexPin).mock.calls.map(([id]) => id)
      expect(polledIds.sort()).toEqual([102, 202])
    })

    it('gives a manual Try Again a fresh restart budget', async () => {
      freshPinsEachStart()
      const { result } = renderHook(() =>
        usePlexQRAuth({ timeout: 10000, autoRestart: true })
      )

      await act(async () => {
        await result.current.start()
      })
      for (let i = 0; i <= MAX_AUTO_RESTARTS; i++) await timeOut(10000)
      expect(result.current.status).toBe('timeout')

      await act(async () => {
        await result.current.start()
      })
      await timeOut(10000)

      expect(result.current.status).toBe('polling')
    })

    it('does not restart without the option', async () => {
      const { result } = renderHook(() => usePlexQRAuth({ timeout: 10000 }))

      await act(async () => {
        await result.current.start()
      })
      await timeOut(10000)

      expect(result.current.status).toBe('timeout')
      expect(plexAuth.createPlexPin).toHaveBeenCalledTimes(2)
    })

    it('does not restart after cancel', async () => {
      const { result } = renderHook(() =>
        usePlexQRAuth({ timeout: 10000, autoRestart: true })
      )

      await act(async () => {
        await result.current.start()
      })
      act(() => {
        result.current.cancel()
      })
      await timeOut(30000)

      expect(result.current.status).toBe('idle')
      expect(plexAuth.createPlexPin).toHaveBeenCalledTimes(2)
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

describe('FE-03 attempt ownership', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers() })
  afterEach(() => vi.useRealTimers())
  it.each(['cancel', 'unmount', 'timeout', 'retry'])('ignores creation completing after %s', async (action) => {
    let resolve!: (pin: plexAuth.PlexPin) => void
    const pending = new Promise<plexAuth.PlexPin>((done) => { resolve = done })
    vi.mocked(plexAuth.createPlexPin).mockReturnValue(pending)
    const onSuccess = vi.fn()
    const { result, unmount } = renderHook(() => usePlexQRAuth({ timeout: 1000, onSuccess }))
    let starting!: Promise<void>
    act(() => { starting = result.current.start() })
    if (action === 'unmount') unmount()
    else if (action === 'timeout') await act(() => vi.advanceTimersByTimeAsync(1000))
    else act(() => result.current.cancel())
    if (action === 'retry') {
      vi.mocked(plexAuth.createPlexPin).mockResolvedValue({ id: 2, code: 'new', authToken: null })
      await act(() => result.current.start())
    }
    await act(async () => { resolve({ id: 1, code: 'old', authToken: null }); await starting })
    expect(onSuccess).not.toHaveBeenCalled()
    if (action === 'retry') expect(result.current.pin?.id).toBe(2)
    else expect(vi.getTimerCount()).toBe(0)
    unmount()
  })
  it('serializes slow polls and ignores late authentication after cancellation', async () => {
    vi.mocked(plexAuth.createPlexPin).mockResolvedValue({ id: 1, code: 'pin', authToken: null })
    let resolve!: (token: string) => void
    vi.mocked(plexAuth.checkPlexPin).mockReturnValue(new Promise((done) => { resolve = done }))
    const onSuccess = vi.fn()
    const { result } = renderHook(() => usePlexQRAuth({ onSuccess }))
    await act(() => result.current.start())
    await act(() => vi.advanceTimersByTimeAsync(10000))
    expect(plexAuth.checkPlexPin).toHaveBeenCalledTimes(2)
    act(() => result.current.cancel())
    await act(async () => resolve('abandoned'))
    expect(onSuccess).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['timeout', 'retry', 'unmount'])('invalidates an in-flight PIN poll on %s', async (action) => {
    vi.mocked(plexAuth.createPlexPin).mockResolvedValue({ id: 1, code: 'pin', authToken: null })
    let finish!: (token: string) => void
    vi.mocked(plexAuth.checkPlexPin).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const onSuccess = vi.fn()
    const { result, unmount } = renderHook(() => usePlexQRAuth({ onSuccess, timeout: 5000, pollInterval: 1000 }))
    await act(() => result.current.start())
    await act(() => vi.advanceTimersByTimeAsync(1000))
    if (action === 'timeout') await act(() => vi.advanceTimersByTimeAsync(4000))
    else if (action === 'unmount') unmount()
    else {
      vi.mocked(plexAuth.createPlexPin).mockResolvedValue({ id: 2, code: 'replacement', authToken: null })
      vi.mocked(plexAuth.checkPlexPin).mockResolvedValue('replacement-token')
      await act(() => result.current.start())
    }
    await act(async () => finish('abandoned-token'))
    expect(onSuccess).not.toHaveBeenCalled()
    if (action === 'retry') {
      await act(() => vi.advanceTimersByTimeAsync(1000))
      expect(onSuccess).toHaveBeenCalledExactlyOnceWith('replacement-token')
    } else expect(vi.getTimerCount()).toBe(0)
    unmount()
  })

})
