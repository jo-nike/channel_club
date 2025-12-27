import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useBreakpoint } from './useBreakpoint'

describe('useBreakpoint', () => {
  const originalInnerWidth = window.innerWidth
  let resizeListeners: (() => void)[] = []

  beforeEach(() => {
    resizeListeners = []
    vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'resize' && typeof handler === 'function') {
        resizeListeners.push(handler as () => void)
      }
    })
    vi.spyOn(window, 'removeEventListener').mockImplementation((event, handler) => {
      if (event === 'resize' && typeof handler === 'function') {
        resizeListeners = resizeListeners.filter((h) => h !== handler)
      }
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    })
    vi.restoreAllMocks()
  })

  const setWindowWidth = (width: number) => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    })
  }

  const triggerResize = () => {
    resizeListeners.forEach((listener) => listener())
  }

  it('returns "mobile" for viewport width < 768px', () => {
    setWindowWidth(767)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('mobile')
  })

  it('returns "mobile" for viewport width = 320px', () => {
    setWindowWidth(320)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('mobile')
  })

  it('returns "tablet" for viewport width = 768px', () => {
    setWindowWidth(768)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('tablet')
  })

  it('returns "tablet" for viewport width = 1023px', () => {
    setWindowWidth(1023)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('tablet')
  })

  it('returns "desktop" for viewport width = 1024px', () => {
    setWindowWidth(1024)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')
  })

  it('returns "desktop" for viewport width > 1024px', () => {
    setWindowWidth(1920)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')
  })

  it('updates breakpoint on window resize', () => {
    setWindowWidth(1920)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')

    act(() => {
      setWindowWidth(800)
      triggerResize()
    })
    expect(result.current).toBe('tablet')

    act(() => {
      setWindowWidth(500)
      triggerResize()
    })
    expect(result.current).toBe('mobile')
  })

  it('cleans up resize listener on unmount', () => {
    setWindowWidth(1024)
    const { unmount } = renderHook(() => useBreakpoint())
    expect(resizeListeners.length).toBe(1)

    unmount()
    expect(resizeListeners.length).toBe(0)
  })

  it('provides isMobile helper correctly', () => {
    setWindowWidth(500)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('mobile')
  })

  it('provides isTablet helper correctly', () => {
    setWindowWidth(900)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('tablet')
  })

  it('provides isDesktop helper correctly', () => {
    setWindowWidth(1200)
    const { result } = renderHook(() => useBreakpoint())
    expect(result.current).toBe('desktop')
  })
})
