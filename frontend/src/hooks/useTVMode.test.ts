import { renderHook, act } from '@/test/utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { useTVMode, detectTVMode, applyTVModeQueryParam } from './useTVMode'

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

  describe('applyTVModeQueryParam', () => {
    const goTo = (path: string) => window.history.replaceState(null, '', path)
    const address = () => window.location.pathname + window.location.search + window.location.hash

    afterEach(() => {
      goTo('/')
    })

    it('?tv=1 turns the TV layout on and drops the parameter', () => {
      goTo('/?tv=1')
      applyTVModeQueryParam()

      expect(localStorage.getItem('tv-mode')).toBe('true')
      expect(detectTVMode()).toBe(true)
      expect(address()).toBe('/')
    })

    it('?tv=0 turns it off, even on a TV browser', () => {
      setUserAgent('Mozilla/5.0 (webOS; Linux) AppleWebKit/537.36 LG Browser/8.00.00')
      goTo('/?tv=0')
      applyTVModeQueryParam()

      expect(localStorage.getItem('tv-mode')).toBe('false')
      expect(detectTVMode()).toBe(false)
      expect(address()).toBe('/')
    })

    it('keeps the rest of the address when it drops the parameter', () => {
      goTo('/tv?a=1&tv=1&b=two#guide')
      applyTVModeQueryParam()

      expect(address()).toBe('/tv?a=1&b=two#guide')
    })

    it('leaves the stored choice and the address alone without the parameter', () => {
      localStorage.setItem('tv-mode', 'true')
      goTo('/?a=1')
      const replaceState = vi.spyOn(window.history, 'replaceState')

      applyTVModeQueryParam()

      expect(localStorage.getItem('tv-mode')).toBe('true')
      expect(replaceState).not.toHaveBeenCalled()
      expect(address()).toBe('/?a=1')
    })

    it('ignores values other than 1 and 0', () => {
      goTo('/?tv=yes')
      applyTVModeQueryParam()

      expect(localStorage.getItem('tv-mode')).toBeNull()
      expect(address()).toBe('/?tv=yes')
    })

    it('runs when the startup module loads', async () => {
      goTo('/?tv=1')
      vi.resetModules()
      await import('@/tvModeParam')

      expect(localStorage.getItem('tv-mode')).toBe('true')
      expect(address()).toBe('/')
    })

    it('is imported by main.tsx before the router, which reads the address when it is created', () => {
      const main = readFileSync('src/main.tsx', 'utf8')
      const param = main.indexOf("import './tvModeParam'")

      expect(param).toBeGreaterThan(-1)
      expect(param).toBeLessThan(main.indexOf("from '@/router'"))
    })
  })
})
