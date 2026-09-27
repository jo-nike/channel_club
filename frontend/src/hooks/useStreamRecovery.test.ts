import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useStreamRecovery } from './useStreamRecovery'

describe('useStreamRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts loading, with no reconnect under way', () => {
    const { result } = renderHook(() => useStreamRecovery())
    expect(result.current).toMatchObject({ status: 'loading', attempt: 0, maxRetries: 5, retryKey: 0 })
  })

  it('numbers the reconnects 1 to 5, never 2/5 first or 6/5 last', () => {
    const { result } = renderHook(() => useStreamRecovery())
    const attempts: number[] = []

    for (let i = 0; i < 5; i++) {
      act(() => result.current.fail())
      expect(result.current.status).toBe('reconnecting')
      attempts.push(result.current.attempt)
      act(() => vi.advanceTimersByTime(8000))
    }

    expect(attempts).toEqual([1, 2, 3, 4, 5])
  })

  it('waits 1, 2, 4, 8 and 8 seconds before each reconnect', () => {
    const { result } = renderHook(() => useStreamRecovery())

    for (const [i, delay] of [1000, 2000, 4000, 8000, 8000].entries()) {
      act(() => result.current.fail())
      act(() => vi.advanceTimersByTime(delay - 1))
      expect(result.current.retryKey).toBe(i)
      act(() => vi.advanceTimersByTime(1))
      expect(result.current.retryKey).toBe(i + 1)
    }
  })

  it('stops after the 6th failure, without starting again', () => {
    const { result } = renderHook(() => useStreamRecovery())
    for (let i = 0; i < 5; i++) {
      act(() => result.current.fail())
      act(() => vi.advanceTimersByTime(8000))
    }
    const retryKey = result.current.retryKey

    act(() => result.current.fail())

    expect(result.current.status).toBe('failed')
    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current.retryKey).toBe(retryKey)
    // Further reports of the failure change nothing
    act(() => result.current.fail())
    expect(result.current.status).toBe('failed')
  })

  it('counts several reports of one failure once', () => {
    const { result } = renderHook(() => useStreamRecovery())

    act(() => {
      result.current.fail()
      result.current.fail()
    })
    act(() => result.current.fail())

    expect(result.current.attempt).toBe(1)
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.retryKey).toBe(1)
    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current.retryKey).toBe(1)
  })

  it('succeed() cancels a waiting reconnect and starts the count over', () => {
    const { result } = renderHook(() => useStreamRecovery())
    act(() => result.current.fail())
    act(() => vi.advanceTimersByTime(1000))
    act(() => result.current.fail())

    act(() => result.current.succeed())

    expect(result.current).toMatchObject({ status: 'ready', attempt: 0 })
    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current.retryKey).toBe(1)
    act(() => result.current.fail())
    expect(result.current.attempt).toBe(1)
  })

  it('retryNow() starts again at once with a full set of reconnects', () => {
    const { result } = renderHook(() => useStreamRecovery())
    for (let i = 0; i < 6; i++) {
      act(() => result.current.fail())
      act(() => vi.advanceTimersByTime(8000))
    }
    expect(result.current.status).toBe('failed')
    const retryKey = result.current.retryKey

    act(() => result.current.retryNow())

    expect(result.current).toMatchObject({ status: 'loading', attempt: 0, retryKey: retryKey + 1 })
    act(() => result.current.fail())
    expect(result.current).toMatchObject({ status: 'reconnecting', attempt: 1 })
  })

  it('retryNow() during a wait replaces the scheduled reconnect', () => {
    const { result } = renderHook(() => useStreamRecovery())
    act(() => result.current.fail())

    act(() => result.current.retryNow())
    expect(result.current.retryKey).toBe(1)

    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current.retryKey).toBe(1)
  })

  it('takes its own attempt cap and waits', () => {
    const { result } = renderHook(() => useStreamRecovery({ maxRetries: 2, backoffMs: [100] }))

    act(() => result.current.fail())
    act(() => vi.advanceTimersByTime(100))
    act(() => result.current.fail())
    expect(result.current.attempt).toBe(2)
    act(() => vi.advanceTimersByTime(100))
    expect(result.current.retryKey).toBe(2)
    act(() => result.current.fail())

    expect(result.current.status).toBe('failed')
  })

  it('drops a waiting reconnect on unmount', () => {
    const { result, unmount } = renderHook(() => useStreamRecovery())
    act(() => result.current.fail())

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
