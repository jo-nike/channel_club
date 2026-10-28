import { renderHook, act } from '@/test/utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  useTVMode,
  detectTVMode,
  applyTVModeQueryParam,
  readTVModeOverride,
  setTVModeOverride,
  watchTVModeClass,
} from './useTVMode'

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

describe('TV layout override', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('reads Auto, On and Off from the stored value', () => {
    expect(readTVModeOverride()).toBe('auto')
    localStorage.setItem('tv-mode', 'true')
    expect(readTVModeOverride()).toBe('on')
    localStorage.setItem('tv-mode', 'false')
    expect(readTVModeOverride()).toBe('off')
  })

  it('stores On and Off, and Auto clears the stored value', () => {
    setTVModeOverride('on')
    expect(localStorage.getItem('tv-mode')).toBe('true')
    setTVModeOverride('off')
    expect(localStorage.getItem('tv-mode')).toBe('false')
    setTVModeOverride('auto')
    expect(localStorage.getItem('tv-mode')).toBeNull()
  })

  it('switches mounted hooks straight away', () => {
    const { result } = renderHook(() => useTVMode())
    expect(result.current).toBe(false)

    act(() => setTVModeOverride('on'))
    expect(result.current).toBe(true)

    act(() => setTVModeOverride('auto'))
    expect(result.current).toBe(false)
  })

  it('stops listening on unmount', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useTVMode())

    unmount()

    expect(removeEventListener).toHaveBeenCalledWith('tv-mode-change', expect.any(Function))
    removeEventListener.mockRestore()
  })
  it('marks <html> with tv while TV mode is on, so index.css can scale the page', () => {
    localStorage.setItem('tv-mode', 'true')
    watchTVModeClass()
    expect(document.documentElement).toHaveClass('tv')

    setTVModeOverride('off')
    expect(document.documentElement).not.toHaveClass('tv')

    setTVModeOverride('on')
    expect(document.documentElement).toHaveClass('tv')

    setTVModeOverride('auto')
    expect(document.documentElement).not.toHaveClass('tv')
  })
})

describe('TV mode with blocked storage', () => {
  const realStorage = window.localStorage
  const blocked = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  }
  const goTo = (path: string) => window.history.replaceState(null, '', path)
  const address = () => window.location.pathname + window.location.search + window.location.hash

  // A fresh copy of the module, so a page-only choice from one test can't leak into the next
  const freshModule = async () => {
    vi.resetModules()
    return import('./useTVMode')
  }

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked },
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', { value: realStorage, writable: true })
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: 'Mozilla/5.0 Chrome/120.0.0.0',
    })
    goTo('/')
  })

  it('the startup module still loads with ?tv=1, and the layout is on for this page load', async () => {
    goTo('/?tv=1')
    vi.resetModules()

    await expect(import('@/tvModeParam')).resolves.toBeDefined()

    const { detectTVMode, readTVModeOverride } = await import('./useTVMode')
    expect(detectTVMode()).toBe(true)
    expect(readTVModeOverride()).toBe('on')
    expect(address()).toBe('/')
  })

  it('?tv=0 turns it off for this page load, even on a TV browser', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: 'Mozilla/5.0 (webOS; Linux) AppleWebKit/537.36 LG Browser/8.00.00',
    })
    goTo('/?tv=0')
    const { applyTVModeQueryParam, detectTVMode } = await freshModule()

    expect(() => applyTVModeQueryParam()).not.toThrow()
    expect(detectTVMode()).toBe(false)
  })

  it('without a choice, falls back to the user agent check', async () => {
    const { detectTVMode, readTVModeOverride } = await freshModule()
    expect(detectTVMode()).toBe(false)
    expect(readTVModeOverride()).toBe('auto')

    Object.defineProperty(navigator, 'userAgent', {
      writable: true,
      configurable: true,
      value: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/537.36',
    })
    expect(detectTVMode()).toBe(true)
  })

  it('the account menu choice applies for this page load instead of throwing', async () => {
    const { setTVModeOverride, readTVModeOverride, detectTVMode } = await freshModule()

    expect(() => setTVModeOverride('on')).not.toThrow()
    expect(readTVModeOverride()).toBe('on')
    expect(detectTVMode()).toBe(true)

    setTVModeOverride('auto')
    expect(readTVModeOverride()).toBe('auto')
    expect(detectTVMode()).toBe(false)
  })

  it('once storage works again, a stored choice replaces the page-only one', async () => {
    goTo('/?tv=1')
    const { applyTVModeQueryParam, setTVModeOverride, readTVModeOverride } = await freshModule()
    applyTVModeQueryParam()
    expect(readTVModeOverride()).toBe('on')

    Object.defineProperty(window, 'localStorage', { value: realStorage, writable: true })
    realStorage.clear()
    setTVModeOverride('off')

    expect(realStorage.getItem('tv-mode')).toBe('false')
    expect(readTVModeOverride()).toBe('off')
    realStorage.clear()
  })
})
