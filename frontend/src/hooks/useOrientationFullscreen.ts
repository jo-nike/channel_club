import { useState, useEffect, useRef, useCallback, type RefObject } from 'react'

const DEBOUNCE_MS = 100

interface UseOrientationFullscreenOptions {
  containerRef: RefObject<HTMLElement | null>
  enabled?: boolean
}

interface UseOrientationFullscreenReturn {
  isOrientationFullscreen: boolean
}

/**
 * Hook that automatically enters fullscreen when a mobile device rotates to landscape
 * and exits when rotating back to portrait.
 *
 * Features:
 * - Only activates on mobile devices (max-width: 768px AND touch capable)
 * - Uses Screen Orientation API with matchMedia fallback
 * - Tracks manual fullscreen exits to prevent unwanted auto-re-entry
 * - Debounces rapid orientation changes
 */
export function useOrientationFullscreen({
  containerRef,
  enabled = true,
}: UseOrientationFullscreenOptions): UseOrientationFullscreenReturn {
  const [isOrientationFullscreen, setIsOrientationFullscreen] = useState(false)

  // Track if fullscreen was triggered by orientation change
  const wasTriggeredByOrientationRef = useRef(false)

  // Track if user manually exited fullscreen while in landscape (prevents auto-re-entry)
  const manualExitInLandscapeRef = useRef(false)

  // Debounce timeout ref
  const debounceTimeoutRef = useRef<number | undefined>(undefined)

  // Check if device is mobile (small screen + touch capable)
  const isMobile = useCallback((): boolean => {
    if (typeof window === 'undefined') return false
    const isSmallScreen = window.matchMedia('(max-width: 768px)').matches
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches
    return isSmallScreen && isTouchDevice
  }, [])

  // Check if currently in landscape orientation
  const isLandscape = useCallback((): boolean => {
    if (typeof window === 'undefined') return false

    // Try Screen Orientation API first
    if ('orientation' in screen && screen.orientation) {
      return screen.orientation.type.startsWith('landscape')
    }

    // Fallback to matchMedia
    return window.matchMedia('(orientation: landscape)').matches
  }, [])

  // Request fullscreen on the container with webkit fallback
  const enterFullscreen = useCallback(async () => {
    const container = containerRef.current
    if (!container) return

    try {
      // Check if we're already in fullscreen (standard or webkit)
      const isAlreadyFullscreen =
        document.fullscreenElement ||
        (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement

      if (isAlreadyFullscreen) return

      // Try standard API first, then webkit fallback
      if (container.requestFullscreen) {
        await container.requestFullscreen()
      } else if ((container as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen) {
        await (container as HTMLElement & { webkitRequestFullscreen: () => Promise<void> }).webkitRequestFullscreen()
      } else {
        // Fullscreen not supported
        return
      }

      wasTriggeredByOrientationRef.current = true
      setIsOrientationFullscreen(true)
    } catch {
      // Fullscreen request denied (browser policy) - silently fail
    }
  }, [containerRef])

  // Exit fullscreen with webkit fallback
  const exitFullscreen = useCallback(async () => {
    const isInFullscreen =
      document.fullscreenElement ||
      (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement

    if (!isInFullscreen) return

    try {
      if (document.exitFullscreen) {
        await document.exitFullscreen()
      } else if ((document as Document & { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen) {
        await (document as Document & { webkitExitFullscreen: () => Promise<void> }).webkitExitFullscreen()
      }
      setIsOrientationFullscreen(false)
      wasTriggeredByOrientationRef.current = false
    } catch {
      // Exit fullscreen failed - silently fail
    }
  }, [])

  // Handle orientation change (debounced)
  const handleOrientationChange = useCallback(() => {
    if (!enabled || !isMobile()) return

    // Clear existing debounce timeout
    if (debounceTimeoutRef.current) {
      window.clearTimeout(debounceTimeoutRef.current)
    }

    // Debounce the orientation change
    debounceTimeoutRef.current = window.setTimeout(() => {
      const landscape = isLandscape()

      if (landscape) {
        // Entering landscape
        if (!manualExitInLandscapeRef.current) {
          enterFullscreen()
        }
      } else {
        // Entering portrait
        // Reset the manual exit flag since we're back to portrait
        manualExitInLandscapeRef.current = false

        // Exit fullscreen if we're currently in orientation-triggered fullscreen
        if (wasTriggeredByOrientationRef.current) {
          exitFullscreen()
        }
      }
    }, DEBOUNCE_MS)
  }, [enabled, isMobile, isLandscape, enterFullscreen, exitFullscreen])

  // Listen for fullscreen changes to detect manual exits (with webkit fallback)
  useEffect(() => {
    if (!enabled) return

    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen =
        !!document.fullscreenElement ||
        !!(document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement

      if (!isCurrentlyFullscreen && wasTriggeredByOrientationRef.current) {
        // User manually exited fullscreen while it was orientation-triggered
        if (isLandscape() && isMobile()) {
          // Still in landscape - mark as manual exit to prevent auto-re-entry
          manualExitInLandscapeRef.current = true
        }
        wasTriggeredByOrientationRef.current = false
        setIsOrientationFullscreen(false)
      }
    }

    // Listen to both standard and webkit events
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
    }
  }, [enabled, isLandscape, isMobile])

  // Set up orientation change listeners
  useEffect(() => {
    if (!enabled || !isMobile()) return

    // Use Screen Orientation API if available
    if ('orientation' in screen && screen.orientation) {
      screen.orientation.addEventListener('change', handleOrientationChange)
    }

    // Also use matchMedia for broader support
    const landscapeQuery = window.matchMedia('(orientation: landscape)')
    landscapeQuery.addEventListener('change', handleOrientationChange)

    // Initial check - if we're already in landscape on mount
    if (isLandscape()) {
      handleOrientationChange()
    }

    return () => {
      if ('orientation' in screen && screen.orientation) {
        screen.orientation.removeEventListener('change', handleOrientationChange)
      }
      landscapeQuery.removeEventListener('change', handleOrientationChange)

      if (debounceTimeoutRef.current) {
        window.clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [enabled, isMobile, isLandscape, handleOrientationChange])

  return { isOrientationFullscreen }
}
