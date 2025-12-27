import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTVMode, detectTVMode, TV_MODE_THRESHOLD } from './useTVMode'

describe('useTVMode', () => {
  const originalInnerWidth = window.innerWidth
  const originalUserAgent = navigator.userAgent
  let resizeListeners: (() => void)[] = []

  beforeEach(() => {
    localStorage.clear()
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

    // Reset to default values
    setWindowWidth(1024)
    setUserAgent('Mozilla/5.0 Chrome/120.0.0.0')
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    })
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: originalUserAgent,
    })
    vi.restoreAllMocks()
    localStorage.clear()
  })

  const setWindowWidth = (width: number) => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: width,
    })
  }

  const setUserAgent = (userAgent: string) => {
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: userAgent,
    })
  }

  const triggerResize = () => {
    resizeListeners.forEach((listener) => listener())
  }

  describe('detectTVMode function', () => {
    it('returns false for small screens (< 1280px) with standard browser', () => {
      setWindowWidth(1024)
      expect(detectTVMode()).toBe(false)
    })

    it('returns true for screens at threshold (1280px)', () => {
      setWindowWidth(TV_MODE_THRESHOLD)
      expect(detectTVMode()).toBe(true)
    })

    it('returns true for screens larger than threshold', () => {
      setWindowWidth(1920)
      expect(detectTVMode()).toBe(true)
    })

    it('detects WebOS browser via user agent (Web0S)', () => {
      setUserAgent('Mozilla/5.0 (Web0S; Linux) AppleWebKit/537.36 LG Browser/8.00.00')
      setWindowWidth(800)
      expect(detectTVMode()).toBe(true)
    })

    it('detects webos (lowercase) browser via user agent', () => {
      setUserAgent('Mozilla/5.0 (webOS; Linux) AppleWebKit/537.36 LG Browser/7.00.00')
      setWindowWidth(800)
      expect(detectTVMode()).toBe(true)
    })

    it('detects Tizen browser via user agent', () => {
      setUserAgent('Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 Samsung Browser')
      setWindowWidth(800)
      expect(detectTVMode()).toBe(true)
    })

    it('respects localStorage override to enable TV mode', () => {
      localStorage.setItem('tv-mode', 'true')
      setWindowWidth(800)
      expect(detectTVMode()).toBe(true)
    })

    it('respects localStorage override to disable TV mode on large screen', () => {
      localStorage.setItem('tv-mode', 'false')
      setWindowWidth(1920)
      expect(detectTVMode()).toBe(false)
    })

    it('respects localStorage override to disable TV mode on TV browser', () => {
      localStorage.setItem('tv-mode', 'false')
      setUserAgent('Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36')
      expect(detectTVMode()).toBe(false)
    })

    it('prioritizes localStorage over user agent detection', () => {
      localStorage.setItem('tv-mode', 'false')
      setUserAgent('Mozilla/5.0 (webOS; Linux) AppleWebKit/537.36')
      setWindowWidth(1920)
      expect(detectTVMode()).toBe(false)
    })

    it('prioritizes user agent over screen size', () => {
      setUserAgent('Mozilla/5.0 (Tizen; Linux) AppleWebKit/537.36')
      setWindowWidth(800) // Small screen but TV browser
      expect(detectTVMode()).toBe(true)
    })
  })

  describe('useTVMode hook', () => {
    it('returns initial value based on current environment', () => {
      setWindowWidth(1024)
      const { result } = renderHook(() => useTVMode())
      expect(result.current).toBe(false)
    })

    it('returns true for large screens initially', () => {
      setWindowWidth(1400)
      const { result } = renderHook(() => useTVMode())
      expect(result.current).toBe(true)
    })

    it('updates on window resize from small to large screen', () => {
      setWindowWidth(1024)
      const { result } = renderHook(() => useTVMode())
      expect(result.current).toBe(false)

      act(() => {
        setWindowWidth(1400)
        triggerResize()
      })

      expect(result.current).toBe(true)
    })

    it('updates on window resize from large to small screen', () => {
      setWindowWidth(1400)
      const { result } = renderHook(() => useTVMode())
      expect(result.current).toBe(true)

      act(() => {
        setWindowWidth(1024)
        triggerResize()
      })

      expect(result.current).toBe(false)
    })

    it('cleans up resize listener on unmount', () => {
      setWindowWidth(1024)
      const { unmount } = renderHook(() => useTVMode())
      expect(resizeListeners.length).toBe(1)

      unmount()
      expect(resizeListeners.length).toBe(0)
    })
  })

  describe('constants', () => {
    it('exports the TV_MODE_THRESHOLD constant as 1280', () => {
      expect(TV_MODE_THRESHOLD).toBe(1280)
    })
  })
})
