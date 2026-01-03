import { useState, useCallback, useRef, useEffect } from 'react'

const AUTO_HIDE_DELAY_MS = 3000

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
  const timeoutRef = useRef<number | undefined>(undefined)

  const hideControls = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
    setIsVisible(false)
  }, [])

  const showControls = useCallback(() => {
    setIsVisible(true)

    // Clear any existing timeout
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
    }

    // Only auto-hide when playing and not hovering over controls
    if (isPlaying && !isHoveringControls) {
      timeoutRef.current = window.setTimeout(() => {
        setIsVisible(false)
      }, AUTO_HIDE_DELAY_MS)
    }
  }, [isPlaying, isHoveringControls])

  // Toggle controls visibility (for touch devices)
  const toggleControls = useCallback(() => {
    if (isVisible) {
      hideControls()
    } else {
      showControls()
    }
  }, [isVisible, hideControls, showControls])

  // Handle activity events
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleActivity = () => showControls()

    // Mouse events
    container.addEventListener('mousemove', handleActivity)
    container.addEventListener('mouseenter', handleActivity)

    // Touch events
    container.addEventListener('touchstart', handleActivity)

    // Keyboard events (global)
    const handleKeyDown = () => showControls()
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('mousemove', handleActivity)
      container.removeEventListener('mouseenter', handleActivity)
      container.removeEventListener('touchstart', handleActivity)
      window.removeEventListener('keydown', handleKeyDown)

      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [containerRef, showControls])

  // Show controls when paused, auto-hide when playing resumes
  useEffect(() => {
    if (!isPlaying) {
      // When paused, always show controls (only update if not already visible to avoid setState in effect)
      if (!isVisible) {
        setIsVisible(true)
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
        setIsVisible(false)
      }, AUTO_HIDE_DELAY_MS)
    } else if (isHoveringControls && timeoutRef.current) {
      // Started hovering, cancel the hide timer
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
  }, [isHoveringControls, isPlaying, isVisible])

  return { isVisible, showControls, hideControls, toggleControls }
}
