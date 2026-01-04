import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTVMode, detectTVMode } from './useTVMode'

describe('useTVMode', () => {
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
    setUserAgent('Mozilla/5.0 Chrome/120.0.0.0')
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: originalUserAgent,
    })
    vi.restoreAllMocks()
    localStorage.clear()
  })

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
    it('returns false for standard desktop browser', () => {
      setUserAgent('Mozilla/5.0 Chrome/120.0.0.0')
      expect(detectTVMode()).toBe(false)
    })

    it('returns false for large desktop screens (no longer triggers TV mode)', () => {
      // Screen size no longer affects TV mode - only TV browsers matter
      setUserAgent('Mozilla/5.0 Chrome/120.0.0.0')
      expect(detectTVMode()).toBe(false)
    })

    it('detects WebOS browser via user agent (Web0S)', () => {
      setUserAgent('Mozilla/5.0 (Web0S; Linux) AppleWebKit/537.36 LG Browser/8.00.00')
      expect(detectTVMode()).toBe(true)
    })

    it('detects webos (lowercase) browser via user agent', () => {
      setUserAgent('Mozilla/5.0 (webOS; Linux) AppleWebKit/537.36 LG Browser/7.00.00')
      expect(detectTVMode()).toBe(true)
    })

    it('detects Tizen browser via user agent', () => {
      setUserAgent('Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36 Samsung Browser')
      expect(detectTVMode()).toBe(true)
    })

    it('respects localStorage override to enable TV mode', () => {
      localStorage.setItem('tv-mode', 'true')
      expect(detectTVMode()).toBe(true)
    })

    it('respects localStorage override to disable TV mode on TV browser', () => {
      localStorage.setItem('tv-mode', 'false')
      setUserAgent('Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36')
      expect(detectTVMode()).toBe(false)
    })

    it('prioritizes localStorage over user agent detection', () => {
      localStorage.setItem('tv-mode', 'false')
      setUserAgent('Mozilla/5.0 (webOS; Linux) AppleWebKit/537.36')
      expect(detectTVMode()).toBe(false)
    })
  })

  describe('useTVMode hook', () => {
    it('returns false for standard desktop browser', () => {
      setUserAgent('Mozilla/5.0 Chrome/120.0.0.0')
      const { result } = renderHook(() => useTVMode())
      expect(result.current).toBe(false)
    })

    it('returns true for TV browser (WebOS)', () => {
      setUserAgent('Mozilla/5.0 (webOS; Linux) AppleWebKit/537.36 LG Browser/8.00.00')
      const { result } = renderHook(() => useTVMode())
      expect(result.current).toBe(true)
    })

    it('returns true for TV browser (Tizen)', () => {
      setUserAgent('Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36')
      const { result } = renderHook(() => useTVMode())
      expect(result.current).toBe(true)
    })

    it('responds to localStorage changes via resize event', () => {
      const { result } = renderHook(() => useTVMode())
      expect(result.current).toBe(false)

      act(() => {
        localStorage.setItem('tv-mode', 'true')
        triggerResize()
      })

      expect(result.current).toBe(true)
    })

    it('cleans up resize listener on unmount', () => {
      const { unmount } = renderHook(() => useTVMode())
      expect(resizeListeners.length).toBe(1)

      unmount()
      expect(resizeListeners.length).toBe(0)
    })
  })
})
