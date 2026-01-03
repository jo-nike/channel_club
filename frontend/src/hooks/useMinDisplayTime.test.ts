import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMinDisplayTime } from './useMinDisplayTime'

describe('useMinDisplayTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should show loading state immediately when loading starts', () => {
    const { result } = renderHook(() => useMinDisplayTime(true))
    expect(result.current).toBe(true)
  })

  it('should not show loading state when not loading', () => {
    const { result } = renderHook(() => useMinDisplayTime(false))
    expect(result.current).toBe(false)
  })

  it('should keep showing loading state for minimum time after loading stops', () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useMinDisplayTime(isLoading, 300),
      { initialProps: { isLoading: true } }
    )

    expect(result.current).toBe(true)

    // Stop loading after 100ms (less than minTime)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender({ isLoading: false })

    // Should still show loading (minimum time not elapsed)
    expect(result.current).toBe(true)

    // Advance remaining time
    act(() => {
      vi.advanceTimersByTime(200)
    })

    // Now should hide loading
    expect(result.current).toBe(false)
  })

  it('should hide loading immediately if minimum time already elapsed', () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useMinDisplayTime(isLoading, 300),
      { initialProps: { isLoading: true } }
    )

    expect(result.current).toBe(true)

    // Stop loading after 400ms (more than minTime)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    rerender({ isLoading: false })

    // Should hide immediately since minTime elapsed
    expect(result.current).toBe(false)
  })

  it('should use custom minimum time', () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useMinDisplayTime(isLoading, 500),
      { initialProps: { isLoading: true } }
    )

    act(() => {
      vi.advanceTimersByTime(200)
    })
    rerender({ isLoading: false })

    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current).toBe(false)
  })

  it('should reset timer if loading restarts', () => {
    const { result, rerender } = renderHook(
      ({ isLoading }) => useMinDisplayTime(isLoading, 300),
      { initialProps: { isLoading: true } }
    )

    // Stop loading
    act(() => {
      vi.advanceTimersByTime(100)
    })
    rerender({ isLoading: false })

    // Start loading again
    rerender({ isLoading: true })
    expect(result.current).toBe(true)

    // Stop loading again
    act(() => {
      vi.advanceTimersByTime(50)
    })
    rerender({ isLoading: false })

    // Should still show (new timer started)
    expect(result.current).toBe(true)
  })
})
