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

  it('stops ticking once unmounted', () => {
    const { unmount } = renderHook(() => useNow(30_000))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
