import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@/test/utils'
import { useAutoHide } from './useAutoHide'

describe('useAutoHide', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const createContainerRef = () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    return { current: container }
  }

  const pointer = (
    target: Element,
    type: 'pointerdown' | 'pointerup' | 'pointermove' | 'pointercancel',
    pointerType: string,
    x = 50,
    y = 50
  ) => {
    act(() => {
      target.dispatchEvent(
        new PointerEvent(type, { bubbles: true, pointerType, clientX: x, clientY: y })
      )
    })
  }

  // A tap: pointerdown then pointerup at (nearly) the same spot
  const tap = (target: Element, pointerType = 'touch', drift = 0) => {
    pointer(target, 'pointerdown', pointerType)
    pointer(target, 'pointerup', pointerType, 50 + drift, 50)
  }

  // What a browser fires after a tap for pages that only listen to mouse
  // events, each a separate discrete event
  const compatMouseEvents = (target: Element) => {
    for (const type of ['mousemove', 'mousedown', 'mouseup', 'click']) {
      act(() => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true }))
      })
    }
  }

  const hideByTimeout = () => {
    act(() => {
      vi.advanceTimersByTime(3000)
    })
  }

  it('starts with controls visible', () => {
    const containerRef = createContainerRef()
    const { result } = renderHook(() =>
      useAutoHide({ isPlaying: false, containerRef })
    )

    expect(result.current.isVisible).toBe(true)
  })

  it('keeps controls visible when paused', () => {
    const containerRef = createContainerRef()
    const { result } = renderHook(() =>
      useAutoHide({ isPlaying: false, containerRef })
    )

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.isVisible).toBe(true)
  })

  it('hides controls after 3 seconds when playing', () => {
    const containerRef = createContainerRef()
    const { result } = renderHook(() =>
      useAutoHide({ isPlaying: true, containerRef })
    )

    expect(result.current.isVisible).toBe(true)

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current.isVisible).toBe(false)
  })

  it('shows controls when showControls is called', () => {
    const containerRef = createContainerRef()
    const { result } = renderHook(() =>
      useAutoHide({ isPlaying: true, containerRef })
    )

    // Wait for controls to hide
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.isVisible).toBe(false)

    // Show controls again
    act(() => {
      result.current.showControls()
    })

    expect(result.current.isVisible).toBe(true)
  })

  it('resets timer when showControls is called', () => {
    const containerRef = createContainerRef()
    const { result } = renderHook(() =>
      useAutoHide({ isPlaying: true, containerRef })
    )

    // Wait 2 seconds
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    // Show controls (resets timer)
    act(() => {
      result.current.showControls()
    })

    // Wait 2 more seconds - should still be visible
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current.isVisible).toBe(true)

    // Wait 1 more second (3 total from last showControls) - should hide
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.isVisible).toBe(false)
  })

  it('shows controls when transitioning from playing to paused', () => {
    const containerRef = createContainerRef()
    const { result, rerender } = renderHook(
      ({ isPlaying }) => useAutoHide({ isPlaying, containerRef }),
      { initialProps: { isPlaying: true } }
    )

    // Wait for controls to hide
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.isVisible).toBe(false)

    // Pause - should show controls
    rerender({ isPlaying: false })

    expect(result.current.isVisible).toBe(true)
  })

  describe('hover override', () => {
    it('prevents auto-hide when hovering over controls', () => {
      const containerRef = createContainerRef()
      const { result, rerender } = renderHook(
        ({ isPlaying, isHoveringControls }) =>
          useAutoHide({ isPlaying, containerRef, isHoveringControls }),
        { initialProps: { isPlaying: true, isHoveringControls: false } }
      )

      // Start hovering
      rerender({ isPlaying: true, isHoveringControls: true })

      // Wait beyond the normal hide timeout
      act(() => {
        vi.advanceTimersByTime(5000)
      })

      // Should still be visible because we're hovering
      expect(result.current.isVisible).toBe(true)
    })

    it('starts auto-hide timer when mouse leaves controls', () => {
      const containerRef = createContainerRef()
      const { result, rerender } = renderHook(
        ({ isPlaying, isHoveringControls }) =>
          useAutoHide({ isPlaying, containerRef, isHoveringControls }),
        { initialProps: { isPlaying: true, isHoveringControls: true } }
      )

      // Controls should be visible while hovering
      expect(result.current.isVisible).toBe(true)

      // Stop hovering
      rerender({ isPlaying: true, isHoveringControls: false })

      // Wait for auto-hide
      act(() => {
        vi.advanceTimersByTime(3000)
      })

      // Should be hidden now
      expect(result.current.isVisible).toBe(false)
    })

    it('cancels pending timer when starting to hover', () => {
      const containerRef = createContainerRef()
      const { result, rerender } = renderHook(
        ({ isPlaying, isHoveringControls }) =>
          useAutoHide({ isPlaying, containerRef, isHoveringControls }),
        { initialProps: { isPlaying: true, isHoveringControls: false } }
      )

      // Wait partway through timeout
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      // Start hovering - should cancel timer
      rerender({ isPlaying: true, isHoveringControls: true })

      // Wait beyond original timeout
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      // Should still be visible
      expect(result.current.isVisible).toBe(true)
    })
  })

  describe('toggleControls', () => {
    it('hides controls when visible and toggleControls is called', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() =>
        useAutoHide({ isPlaying: true, containerRef })
      )

      expect(result.current.isVisible).toBe(true)

      act(() => {
        result.current.toggleControls()
      })

      expect(result.current.isVisible).toBe(false)
    })

    it('shows controls when hidden and toggleControls is called', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() =>
        useAutoHide({ isPlaying: true, containerRef })
      )

      // Wait for controls to hide
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(result.current.isVisible).toBe(false)

      // Toggle to show
      act(() => {
        result.current.toggleControls()
      })

      expect(result.current.isVisible).toBe(true)
    })

    it('starts auto-hide timer after toggling controls on', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() =>
        useAutoHide({ isPlaying: true, containerRef })
      )

      // Hide controls
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(result.current.isVisible).toBe(false)

      // Toggle to show
      act(() => {
        result.current.toggleControls()
      })
      expect(result.current.isVisible).toBe(true)

      // Wait for auto-hide
      act(() => {
        vi.advanceTimersByTime(3000)
      })

      expect(result.current.isVisible).toBe(false)
    })
  })

  describe('hideControls', () => {
    it('immediately hides controls when hideControls is called', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() =>
        useAutoHide({ isPlaying: true, containerRef })
      )

      expect(result.current.isVisible).toBe(true)

      act(() => {
        result.current.hideControls()
      })

      expect(result.current.isVisible).toBe(false)
    })

    it('clears any pending timeout when hideControls is called', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() =>
        useAutoHide({ isPlaying: true, containerRef })
      )

      // Hide immediately
      act(() => {
        result.current.hideControls()
      })
      expect(result.current.isVisible).toBe(false)

      // Show controls
      act(() => {
        result.current.showControls()
      })
      expect(result.current.isVisible).toBe(true)

      // Advance time - should hide after 3 seconds as normal
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(result.current.isVisible).toBe(false)
    })
  })

  describe('pointer input', () => {
    it('a tap after auto-hide shows the controls, and the compat mouse events after it do not hide them', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))
      hideByTimeout()
      expect(result.current.isVisible).toBe(false)

      tap(containerRef.current)
      compatMouseEvents(containerRef.current)

      expect(result.current.isVisible).toBe(true)
    })

    it('a second tap hides the controls again', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))
      hideByTimeout()

      tap(containerRef.current)
      expect(result.current.isVisible).toBe(true)

      tap(containerRef.current)
      expect(result.current.isVisible).toBe(false)
    })

    it('a pen tap toggles like a finger', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))
      hideByTimeout()

      tap(containerRef.current, 'pen')

      expect(result.current.isVisible).toBe(true)
    })

    it('ignores a touch that moves more than 10px (a scroll or drag)', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))
      hideByTimeout()

      tap(containerRef.current, 'touch', 11)
      expect(result.current.isVisible).toBe(false)

      tap(containerRef.current, 'touch', 10)
      expect(result.current.isVisible).toBe(true)
    })

    it('ignores a touch the browser cancelled', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))
      hideByTimeout()

      pointer(containerRef.current, 'pointerdown', 'touch')
      pointer(containerRef.current, 'pointercancel', 'touch')
      pointer(containerRef.current, 'pointerup', 'touch')

      expect(result.current.isVisible).toBe(false)
    })

    it('a tap on a control keeps the controls up and restarts the timer', () => {
      const containerRef = createContainerRef()
      const controls = document.createElement('div')
      controls.className = 'video-controls'
      const muteButton = document.createElement('button')
      controls.appendChild(muteButton)
      containerRef.current.appendChild(controls)
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      tap(muteButton)
      expect(result.current.isVisible).toBe(true)

      // 2s after the tap the original timer would have fired
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(result.current.isVisible).toBe(true)
    })

    it('mouse movement shows the controls; finger movement does not', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))
      hideByTimeout()

      pointer(containerRef.current, 'pointermove', 'touch')
      expect(result.current.isVisible).toBe(false)

      pointer(containerRef.current, 'pointermove', 'mouse')
      expect(result.current.isVisible).toBe(true)
    })

    it('a mouse move of less than 4px does not bring hidden controls back; 4px or more does', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))
      pointer(containerRef.current, 'pointermove', 'mouse', 50, 50)
      hideByTimeout()
      expect(result.current.isVisible).toBe(false)

      pointer(containerRef.current, 'pointermove', 'mouse', 53, 50)
      pointer(containerRef.current, 'pointermove', 'mouse', 52, 52)
      expect(result.current.isVisible).toBe(false)

      pointer(containerRef.current, 'pointermove', 'mouse', 54, 50)
      expect(result.current.isVisible).toBe(true)
    })

    it('measures from where the mouse last showed the controls, so slow drift adds up', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))
      pointer(containerRef.current, 'pointermove', 'mouse', 50, 50)
      hideByTimeout()

      pointer(containerRef.current, 'pointermove', 'mouse', 52, 50)
      expect(result.current.isVisible).toBe(false)
      pointer(containerRef.current, 'pointermove', 'mouse', 53, 53)
      expect(result.current.isVisible).toBe(true)

      // The show re-anchors at (53, 53): jitter around it is ignored again
      hideByTimeout()
      pointer(containerRef.current, 'pointermove', 'mouse', 55, 54)
      expect(result.current.isVisible).toBe(false)
    })

    it('jitter while the controls are up does not keep them up', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))
      pointer(containerRef.current, 'pointermove', 'mouse', 50, 50)

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      pointer(containerRef.current, 'pointermove', 'mouse', 51, 51)
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(result.current.isVisible).toBe(false)
    })

    it('a mouse click on the picture does not toggle the controls', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))

      tap(containerRef.current, 'mouse')

      expect(result.current.isVisible).toBe(true)
    })
  })

  describe('paused', () => {
    it('a tap on a paused video leaves the controls up', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: false, containerRef }))

      tap(containerRef.current)
      expect(result.current.isVisible).toBe(true)

      tap(containerRef.current)
      expect(result.current.isVisible).toBe(true)
    })

    it('toggleControls never hides the controls of a paused video', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: false, containerRef }))

      act(() => {
        result.current.toggleControls()
      })

      expect(result.current.isVisible).toBe(true)
    })
  })

  describe('touch delay', () => {
    const setupMatchMedia = window.matchMedia

    afterEach(() => {
      Object.defineProperty(window, 'matchMedia', { writable: true, configurable: true, value: setupMatchMedia })
    })

    const reportCoarsePointer = () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: (query: string) => ({
          matches: query === '(pointer: coarse)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }),
      })
    }

    it('keeps the controls up for 4 seconds on a coarse pointer', () => {
      reportCoarsePointer()
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))

      act(() => {
        vi.advanceTimersByTime(3999)
      })
      expect(result.current.isVisible).toBe(true)

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(result.current.isVisible).toBe(false)
    })

    it('a tap brings them back for 4 seconds too', () => {
      reportCoarsePointer()
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))
      act(() => {
        vi.advanceTimersByTime(4000)
      })

      tap(containerRef.current)
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(result.current.isVisible).toBe(true)

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(result.current.isVisible).toBe(false)
    })

    it('stays at 3 seconds for a fine pointer', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() => useAutoHide({ isPlaying: true, containerRef }))

      act(() => {
        vi.advanceTimersByTime(3000)
      })

      expect(result.current.isVisible).toBe(false)
    })
  })
  describe('pointerOnly (the couch)', () => {
    const keyDown = () => {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))
      })
    }

    it('starts hidden, and a key press leaves the controls hidden', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() =>
        useAutoHide({ isPlaying: true, containerRef, pointerOnly: true })
      )
      expect(result.current.isVisible).toBe(false)

      keyDown()

      expect(result.current.isVisible).toBe(false)
    })

    it('a key press still shows them without pointerOnly', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() =>
        useAutoHide({ isPlaying: true, containerRef })
      )
      hideByTimeout()

      keyDown()

      expect(result.current.isVisible).toBe(true)
    })

    it('neither playback starting nor stopping raises them', () => {
      const containerRef = createContainerRef()
      const { result, rerender } = renderHook(
        ({ isPlaying }) => useAutoHide({ isPlaying, containerRef, pointerOnly: true }),
        { initialProps: { isPlaying: false } }
      )
      expect(result.current.isVisible).toBe(false)

      rerender({ isPlaying: true })
      expect(result.current.isVisible).toBe(false)

      rerender({ isPlaying: false })
      expect(result.current.isVisible).toBe(false)
    })

    it('a mouse move shows them and they hide again 3s later', () => {
      const containerRef = createContainerRef()
      const { result } = renderHook(() =>
        useAutoHide({ isPlaying: true, containerRef, pointerOnly: true })
      )

      pointer(containerRef.current, 'pointermove', 'mouse')
      expect(result.current.isVisible).toBe(true)

      hideByTimeout()
      expect(result.current.isVisible).toBe(false)
    })

    it('controls the pointer brought up stay up while paused, and hide once playback resumes', () => {
      const containerRef = createContainerRef()
      const { result, rerender } = renderHook(
        ({ isPlaying }) => useAutoHide({ isPlaying, containerRef, pointerOnly: true }),
        { initialProps: { isPlaying: true } }
      )
      pointer(containerRef.current, 'pointermove', 'mouse')

      rerender({ isPlaying: false })
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(result.current.isVisible).toBe(true)

      rerender({ isPlaying: true })
      hideByTimeout()
      expect(result.current.isVisible).toBe(false)
    })
  })
})
