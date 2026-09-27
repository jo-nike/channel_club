import { useState, useCallback, useRef, useEffect } from 'react'

const AUTO_HIDE_DELAY_MS = 3000
// Touch viewers need longer to read the bar and reach for a control
const TOUCH_AUTO_HIDE_DELAY_MS = 4000
// A touch that moves further than this is a scroll or drag, not a tap
const TAP_SLOP_PX = 10
// A resting mouse can report tiny moves (sensor noise, a bumped desk); only a
// move at least this far from where the mouse last showed the controls counts
const MOUSE_JITTER_PX = 4

// Read each time a timer is scheduled, so a device that changes pointer
// (a tablet gaining a mouse) gets the right delay
function autoHideDelay(): number {
  return window.matchMedia('(pointer: coarse)').matches ? TOUCH_AUTO_HIDE_DELAY_MS : AUTO_HIDE_DELAY_MS
}

interface UseAutoHideOptions {
  isPlaying: boolean
  containerRef: React.RefObject<HTMLElement | null>
  isHoveringControls?: boolean
}

interface UseAutoHideResult {
  isVisible: boolean
  showControls: () => void
  hideControls: () => void
  toggleControls: () => void
}

export function useAutoHide({ isPlaying, containerRef, isHoveringControls = false }: UseAutoHideOptions): UseAutoHideResult {
  const [isVisible, setIsVisible] = useState(true)
  // Read by toggleControls, so the listeners don't re-register on every show/hide
  const visibleRef = useRef(true)
  const timeoutRef = useRef<number | undefined>(undefined)
  const tapStartRef = useRef<{ x: number; y: number; pointerType: string } | null>(null)
  // Where the mouse was when it last showed the controls
  const mouseAnchorRef = useRef<{ x: number; y: number } | null>(null)

  const setVisible = useCallback((visible: boolean) => {
    visibleRef.current = visible
    setIsVisible(visible)
  }, [])

  const hideControls = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
    setVisible(false)
  }, [setVisible])

  const showControls = useCallback(() => {
    setVisible(true)

    // Clear any existing timeout
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
    }

    // Only auto-hide when playing and not hovering over controls
    if (isPlaying && !isHoveringControls) {
      timeoutRef.current = window.setTimeout(() => {
        setVisible(false)
      }, autoHideDelay())
    }
  }, [isPlaying, isHoveringControls, setVisible])

  // Toggle controls visibility (a tap on touch devices). A paused video keeps
  // its controls, so a tap never leaves it with none.
  const toggleControls = useCallback(() => {
    if (visibleRef.current && isPlaying) {
      hideControls()
    } else {
      showControls()
    }
  }, [isPlaying, hideControls, showControls])

  // Handle activity events. Pointer events tell a mouse from a finger or pen:
  // mouse movement shows the controls, a tap toggles them exactly once. The
  // compatibility mouse events a tap fires afterwards are not pointer events,
  // so they can't undo the toggle.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseActivity = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const anchor = mouseAnchorRef.current
      if (
        e.type === 'pointermove' &&
        anchor &&
        Math.hypot(e.clientX - anchor.x, e.clientY - anchor.y) < MOUSE_JITTER_PX
      ) {
        return
      }
      mouseAnchorRef.current = { x: e.clientX, y: e.clientY }
      showControls()
    }

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      tapStartRef.current = { x: e.clientX, y: e.clientY, pointerType: e.pointerType }
    }

    // A scroll or pan cancels the pointer
    const handlePointerCancel = () => {
      tapStartRef.current = null
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      const start = tapStartRef.current
      tapStartRef.current = null
      if (!start || start.pointerType !== e.pointerType) return
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) return

      // Using a control never dismisses the bar; it restarts the timer
      if (e.target instanceof Element && e.target.closest('.video-controls')) {
        showControls()
      } else {
        toggleControls()
      }
    }

    container.addEventListener('pointermove', handleMouseActivity)
    container.addEventListener('pointerenter', handleMouseActivity)
    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('pointerup', handlePointerUp)
    container.addEventListener('pointercancel', handlePointerCancel)

    // Keyboard events (global)
    const handleKeyDown = () => {
      const activeElement = document.activeElement
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement
      ) {
        return
      }
      showControls()
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('pointermove', handleMouseActivity)
      container.removeEventListener('pointerenter', handleMouseActivity)
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('pointerup', handlePointerUp)
      container.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('keydown', handleKeyDown)

      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [containerRef, showControls, toggleControls])

  // Show controls when paused, auto-hide when playing resumes
  useEffect(() => {
    if (!isPlaying) {
      // When paused, always show controls (only update if not already visible to avoid setState in effect)
      if (!isVisible) {
        setVisible(true)
      }
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = undefined
      }
    } else {
      // When playing, start the hide timer
      showControls()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // Handle hover state changes - restart timer when leaving controls area
  useEffect(() => {
    if (isPlaying && !isHoveringControls && isVisible) {
      // Just stopped hovering, restart the auto-hide timer
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = window.setTimeout(() => {
        setVisible(false)
      }, autoHideDelay())
    } else if (isHoveringControls && timeoutRef.current) {
      // Started hovering, cancel the hide timer
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
  }, [isHoveringControls, isPlaying, isVisible, setVisible])

  return { isVisible, showControls, hideControls, toggleControls }
}
