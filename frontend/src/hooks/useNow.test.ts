import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNow } from './useNow'

describe('useNow', () => {
  const start = new Date('2026-01-08T12:00:00Z').getTime()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(start)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the current time on mount', () => {
    const { result } = renderHook(() => useNow(30_000))
    expect(result.current).toBe(start)
  })

  it('holds its value between ticks', () => {
    const { result } = renderHook(() => useNow(30_000))
    act(() => { vi.advanceTimersByTime(29_999) })
    expect(result.current).toBe(start)
  })

  it('moves to the current time on each tick', () => {
    const { result } = renderHook(() => useNow(30_000))
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(result.current).toBe(start + 30_000)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(result.current).toBe(start + 60_000)
  })

  it('does not tick while disabled', () => {
    const { result } = renderHook(() => useNow(30_000, false))
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(90_000) })
    expect(result.current).toBe(start)
  })

  it('catches up at once when enabled again, then ticks', () => {
    const { result, rerender } = renderHook(({ enabled }) => useNow(30_000, enabled), {
      initialProps: { enabled: true },
    })
    rerender({ enabled: false })
    expect(vi.getTimerCount()).toBe(0)

    act(() => { vi.advanceTimersByTime(10 * 60_000) })
    expect(result.current).toBe(start)

    rerender({ enabled: true })
    act(() => { vi.advanceTimersByTime(0) })
    expect(result.current).toBe(start + 10 * 60_000)
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(result.current).toBe(start + 10 * 60_000 + 30_000)
  })

  it('stops ticking once unmounted', () => {
    const { unmount } = renderHook(() => useNow(30_000))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
