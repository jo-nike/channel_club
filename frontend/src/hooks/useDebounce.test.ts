import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebounce } from './useDebounce'

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 300))

    expect(result.current).toBe('initial')
  })

  it('does not update value before delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 300 } }
    )

    rerender({ value: 'updated', delay: 300 })

    // Value should still be 'initial' before delay
    expect(result.current).toBe('initial')
  })

  it('updates value after delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 300 } }
    )

    rerender({ value: 'updated', delay: 300 })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current).toBe('updated')
  })

  it('resets timer on rapid value changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 300 } }
    )

    // First change
    rerender({ value: 'change1', delay: 300 })
    act(() => {
      vi.advanceTimersByTime(100)
    })

    // Second change before delay
    rerender({ value: 'change2', delay: 300 })
    act(() => {
      vi.advanceTimersByTime(100)
    })

    // Third change before delay
    rerender({ value: 'change3', delay: 300 })
    act(() => {
      vi.advanceTimersByTime(100)
    })

    // Value should still be 'initial' - timer keeps resetting
    expect(result.current).toBe('initial')

    // Wait for full delay after last change
    act(() => {
      vi.advanceTimersByTime(200)
    })

    // Now it should be the latest value
    expect(result.current).toBe('change3')
  })

  it('works with different delay values', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 500 } }
    )

    rerender({ value: 'updated', delay: 500 })

    act(() => {
      vi.advanceTimersByTime(400)
    })

    // Should not have updated yet
    expect(result.current).toBe('initial')

    act(() => {
      vi.advanceTimersByTime(100)
    })

    // Now it should update
    expect(result.current).toBe('updated')
  })

  it('works with non-string values', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 0, delay: 300 } }
    )

    rerender({ value: 42, delay: 300 })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current).toBe(42)
  })

  it('handles object values', () => {
    const initialObj = { count: 0 }
    const updatedObj = { count: 1 }

    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: initialObj, delay: 300 } }
    )

    rerender({ value: updatedObj, delay: 300 })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current).toEqual({ count: 1 })
  })
})
