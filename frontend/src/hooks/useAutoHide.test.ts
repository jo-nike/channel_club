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
})
