import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery } from './useMediaQuery'

describe('useMediaQuery', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    // Reset matchMedia mock
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    })
  })

  it('returns false when query does not match', () => {
    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'))
    expect(result.current).toBe(false)
  })

  it('returns true when query matches', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'))
    expect(result.current).toBe(true)
  })

  it('updates when media query changes', () => {
    let changeHandler: ((e: MediaQueryListEvent) => void) | null = null

    const mockMediaQueryList = {
      matches: false,
      media: '(max-width: 768px)',
      addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
        if (event === 'change') {
          changeHandler = handler
        }
      }),
      removeEventListener: vi.fn(),
    }

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => mockMediaQueryList),
    })

    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'))
    expect(result.current).toBe(false)

    // Simulate media query change
    act(() => {
      if (changeHandler) {
        changeHandler({ matches: true } as MediaQueryListEvent)
      }
    })

    // Note: Due to useSyncExternalStore, we need to update the mock matches value
    // and trigger a re-render through the subscription
    mockMediaQueryList.matches = true
    act(() => {
      if (changeHandler) {
        changeHandler({ matches: true } as MediaQueryListEvent)
      }
    })

    expect(result.current).toBe(true)
  })

  it('cleans up event listener on unmount', () => {
    const removeEventListener = vi.fn()
    const addEventListener = vi.fn()

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener,
        removeEventListener,
      })),
    })

    const { unmount } = renderHook(() => useMediaQuery('(max-width: 768px)'))

    expect(addEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    unmount()

    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('handles different queries correctly', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('768'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    const { result: result1 } = renderHook(() => useMediaQuery('(max-width: 768px)'))
    const { result: result2 } = renderHook(() => useMediaQuery('(max-width: 1024px)'))

    expect(result1.current).toBe(true)
    expect(result2.current).toBe(false)
  })
})
