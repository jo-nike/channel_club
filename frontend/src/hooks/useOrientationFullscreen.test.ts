import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useOrientationFullscreen } from './useOrientationFullscreen'

describe('useOrientationFullscreen', () => {
  let originalMatchMedia: typeof window.matchMedia
  let mockOrientationListeners: ((event: Event) => void)[]

  const createContainerRef = () => {
    const container = document.createElement('div')
    container.requestFullscreen = vi.fn().mockResolvedValue(undefined)
    document.body.appendChild(container)
    return { current: container }
  }

  const mockMatchMedia = (matches: Record<string, boolean>) => {
    const listeners: Record<string, ((event: MediaQueryListEvent) => void)[]> = {}

    window.matchMedia = vi.fn().mockImplementation((query: string) => {
      if (!listeners[query]) {
        listeners[query] = []
      }

      return {
        matches: matches[query] ?? false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event: string, cb: (event: MediaQueryListEvent) => void) => {
          if (event === 'change') {
            listeners[query].push(cb)
          }
        }),
        removeEventListener: vi.fn((event: string, cb: (event: MediaQueryListEvent) => void) => {
          if (event === 'change') {
            const idx = listeners[query].indexOf(cb)
            if (idx > -1) listeners[query].splice(idx, 1)
          }
        }),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList
    })

    return {
      triggerChange: (query: string, newMatches: boolean) => {
        matches[query] = newMatches
        listeners[query]?.forEach(cb => cb({ matches: newMatches } as MediaQueryListEvent))
      }
    }
  }

  // Shared state object so the hook can read current orientation
  let currentOrientationType = 'portrait-primary'

  const mockScreenOrientation = (type: 'portrait-primary' | 'landscape-primary') => {
    mockOrientationListeners = []
    currentOrientationType = type

    const mockOrientation = {
      get type() {
        return currentOrientationType
      },
      get angle() {
        return currentOrientationType.startsWith('landscape') ? 90 : 0
      },
      addEventListener: vi.fn((event: string, cb: (event: Event) => void) => {
        if (event === 'change') {
          mockOrientationListeners.push(cb)
        }
      }),
      removeEventListener: vi.fn((event: string, cb: (event: Event) => void) => {
        if (event === 'change') {
          const idx = mockOrientationListeners.indexOf(cb)
          if (idx > -1) mockOrientationListeners.splice(idx, 1)
        }
      }),
      lock: vi.fn(),
      unlock: vi.fn(),
    }

    Object.defineProperty(window.screen, 'orientation', {
      value: mockOrientation,
      writable: true,
      configurable: true,
    })

    return {
      changeOrientation: (newType: 'portrait-primary' | 'landscape-primary') => {
        currentOrientationType = newType
        mockOrientationListeners.forEach(cb => cb(new Event('change')))
      }
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    originalMatchMedia = window.matchMedia

    // Mock document.fullscreenElement
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      writable: true,
      configurable: true,
    })

    // Mock document.exitFullscreen
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    window.matchMedia = originalMatchMedia
    vi.restoreAllMocks()
  })

  it('should not enable on desktop (>768px)', () => {
    mockMatchMedia({
      '(max-width: 768px)': false,
      '(pointer: coarse)': false,
      '(orientation: landscape)': false,
    })
    mockScreenOrientation('portrait-primary')

    const containerRef = createContainerRef()
    const { result } = renderHook(() =>
      useOrientationFullscreen({ containerRef })
    )

    expect(result.current.isOrientationFullscreen).toBe(false)
    // Should not have attached orientation listeners on desktop
  })

  it('should not enable on non-touch devices', () => {
    mockMatchMedia({
      '(max-width: 768px)': true,
      '(pointer: coarse)': false, // Not a touch device
      '(orientation: landscape)': false,
    })
    mockScreenOrientation('portrait-primary')

    const containerRef = createContainerRef()
    const { result } = renderHook(() =>
      useOrientationFullscreen({ containerRef })
    )

    expect(result.current.isOrientationFullscreen).toBe(false)
  })

  it('should request fullscreen on landscape orientation', async () => {
    const mediaControl = mockMatchMedia({
      '(max-width: 768px)': true,
      '(pointer: coarse)': true,
      '(orientation: landscape)': false,
    })
    const orientationControl = mockScreenOrientation('portrait-primary')

    const containerRef = createContainerRef()
    renderHook(() => useOrientationFullscreen({ containerRef }))

    // Simulate rotation to landscape
    await act(async () => {
      mediaControl.triggerChange('(orientation: landscape)', true)
      orientationControl.changeOrientation('landscape-primary')
      await vi.advanceTimersByTimeAsync(100) // Allow debounce
    })

    expect(containerRef.current!.requestFullscreen).toHaveBeenCalled()
  })

  it('should exit fullscreen on portrait orientation', async () => {
    const mediaControl = mockMatchMedia({
      '(max-width: 768px)': true,
      '(pointer: coarse)': true,
      '(orientation: landscape)': false, // Start in portrait
    })
    const orientationControl = mockScreenOrientation('portrait-primary')

    const containerRef = createContainerRef()

    renderHook(() => useOrientationFullscreen({ containerRef }))

    // First, rotate to landscape to trigger orientation-based fullscreen
    await act(async () => {
      mediaControl.triggerChange('(orientation: landscape)', true)
      orientationControl.changeOrientation('landscape-primary')
      await vi.advanceTimersByTimeAsync(100)
    })

    // Verify fullscreen was requested
    expect(containerRef.current!.requestFullscreen).toHaveBeenCalled()

    // Simulate entering fullscreen (set fullscreenElement)
    Object.defineProperty(document, 'fullscreenElement', {
      value: containerRef.current,
      writable: true,
      configurable: true,
    })

    // Now rotate back to portrait
    await act(async () => {
      mediaControl.triggerChange('(orientation: landscape)', false)
      orientationControl.changeOrientation('portrait-primary')
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(document.exitFullscreen).toHaveBeenCalled()
  })

  it('should not re-enter fullscreen if user manually exited', async () => {
    const mediaControl = mockMatchMedia({
      '(max-width: 768px)': true,
      '(pointer: coarse)': true,
      '(orientation: landscape)': false, // Start portrait
    })
    const orientationControl = mockScreenOrientation('portrait-primary')

    const containerRef = createContainerRef()
    renderHook(() => useOrientationFullscreen({ containerRef }))

    // First: rotate to landscape - enters fullscreen
    await act(async () => {
      mediaControl.triggerChange('(orientation: landscape)', true)
      orientationControl.changeOrientation('landscape-primary')
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(containerRef.current!.requestFullscreen).toHaveBeenCalled()

    // Simulate actually entering fullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      value: containerRef.current,
      writable: true,
      configurable: true,
    })

    // Clear the mock to track new calls
    vi.mocked(containerRef.current!.requestFullscreen).mockClear()

    // Second: Simulate user manually exiting fullscreen while still in landscape
    await act(async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
        configurable: true,
      })
      // Dispatch fullscreenchange event to notify the hook
      document.dispatchEvent(new Event('fullscreenchange'))
      await vi.advanceTimersByTimeAsync(10)
    })

    // Third: simulate some time passing - shouldn't re-enter since user manually exited
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    // Should NOT have re-requested fullscreen
    expect(containerRef.current!.requestFullscreen).not.toHaveBeenCalled()

    // Fourth: go back to portrait to reset the manual exit flag
    await act(async () => {
      mediaControl.triggerChange('(orientation: landscape)', false)
      orientationControl.changeOrientation('portrait-primary')
      await vi.advanceTimersByTimeAsync(100)
    })

    // Clear again
    vi.mocked(containerRef.current!.requestFullscreen).mockClear()

    // Fifth: go to landscape again - should NOW enter fullscreen since we went to portrait first
    await act(async () => {
      mediaControl.triggerChange('(orientation: landscape)', true)
      orientationControl.changeOrientation('landscape-primary')
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(containerRef.current!.requestFullscreen).toHaveBeenCalled()
  })

  it('should handle missing Screen Orientation API gracefully', async () => {
    const mediaControl = mockMatchMedia({
      '(max-width: 768px)': true,
      '(pointer: coarse)': true,
      '(orientation: landscape)': false,
    })

    // Remove screen.orientation to simulate older browser
    Object.defineProperty(window.screen, 'orientation', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    const containerRef = createContainerRef()
    renderHook(() => useOrientationFullscreen({ containerRef }))

    // Should still work via matchMedia fallback
    await act(async () => {
      mediaControl.triggerChange('(orientation: landscape)', true)
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(containerRef.current!.requestFullscreen).toHaveBeenCalled()
  })

  it('should not activate when disabled', () => {
    mockMatchMedia({
      '(max-width: 768px)': true,
      '(pointer: coarse)': true,
      '(orientation: landscape)': true,
    })
    mockScreenOrientation('landscape-primary')

    const containerRef = createContainerRef()
    const { result } = renderHook(() =>
      useOrientationFullscreen({ containerRef, enabled: false })
    )

    expect(result.current.isOrientationFullscreen).toBe(false)
    expect(containerRef.current!.requestFullscreen).not.toHaveBeenCalled()
  })

  it('should debounce rapid orientation changes', async () => {
    const mediaControl = mockMatchMedia({
      '(max-width: 768px)': true,
      '(pointer: coarse)': true,
      '(orientation: landscape)': false,
    })
    const orientationControl = mockScreenOrientation('portrait-primary')

    const containerRef = createContainerRef()
    renderHook(() => useOrientationFullscreen({ containerRef }))

    // Rapidly toggle orientation - should debounce
    await act(async () => {
      mediaControl.triggerChange('(orientation: landscape)', true)
      orientationControl.changeOrientation('landscape-primary')
      await vi.advanceTimersByTimeAsync(20) // Less than debounce time

      mediaControl.triggerChange('(orientation: landscape)', false)
      orientationControl.changeOrientation('portrait-primary')
      await vi.advanceTimersByTimeAsync(20) // Less than debounce time

      mediaControl.triggerChange('(orientation: landscape)', true)
      orientationControl.changeOrientation('landscape-primary')
      await vi.advanceTimersByTimeAsync(150) // Enough time for debounce to complete
    })

    // Should only have requested fullscreen once after debounce settles
    expect(containerRef.current!.requestFullscreen).toHaveBeenCalledTimes(1)
  })
})
