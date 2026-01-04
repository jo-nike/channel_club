import { useState, useEffect, useRef, useCallback, type RefObject } from 'react'
import { logger } from '@/lib/logger'

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
    const result = isSmallScreen && isTouchDevice
    logger.debug('Player', `isMobile check: isSmallScreen=${isSmallScreen}, isTouchDevice=${isTouchDevice}, result=${result}`)
    return result
  }, [])

  // Check if currently in landscape orientation
  const isLandscape = useCallback((): boolean => {
    if (typeof window === 'undefined') return false

    // Try Screen Orientation API first
    if ('orientation' in screen && screen.orientation) {
      const result = screen.orientation.type.startsWith('landscape')
      logger.debug('Player', `isLandscape (Screen Orientation API): ${screen.orientation.type}, result=${result}`)
      return result
    }

    // Fallback to matchMedia
    const result = window.matchMedia('(orientation: landscape)').matches
    logger.debug('Player', `isLandscape (matchMedia fallback): ${result}`)
    return result
  }, [])

  // Request fullscreen on the container with webkit fallback
  const enterFullscreen = useCallback(async () => {
    const container = containerRef.current
    if (!container) {
      logger.debug('Player', 'enterFullscreen: No container ref')
      return
    }

    logger.debug('Player', `enterFullscreen: Attempting fullscreen on container ${container.tagName}`)

    try {
      // Check if we're already in fullscreen (standard or webkit)
      const isAlreadyFullscreen =
        document.fullscreenElement ||
        (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement

      if (isAlreadyFullscreen) {
        logger.debug('Player', 'enterFullscreen: Already in fullscreen')
        return
      }

      // Try standard API first, then webkit fallback
      if (container.requestFullscreen) {
        logger.debug('Player', 'enterFullscreen: Using standard requestFullscreen')
        await container.requestFullscreen()
      } else if ((container as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen) {
        logger.debug('Player', 'enterFullscreen: Using webkitRequestFullscreen')
        await (container as HTMLElement & { webkitRequestFullscreen: () => Promise<void> }).webkitRequestFullscreen()
      } else {
        logger.debug('Player', 'enterFullscreen: Fullscreen not supported')
        return
      }

      logger.debug('Player', 'enterFullscreen: SUCCESS')
      wasTriggeredByOrientationRef.current = true
      setIsOrientationFullscreen(true)
    } catch (error) {
      // Fullscreen request denied (browser policy)
      logger.warn('Player', 'enterFullscreen: FAILED', error)
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
    logger.debug('Player', 'handleOrientationChange called')

    if (!enabled) {
      logger.debug('Player', 'handleOrientationChange: Hook disabled')
      return
    }

    if (!isMobile()) {
      logger.debug('Player', 'handleOrientationChange: Not mobile, ignoring')
      return
    }

    // Clear existing debounce timeout
    if (debounceTimeoutRef.current) {
      window.clearTimeout(debounceTimeoutRef.current)
    }

    // Debounce the orientation change
    debounceTimeoutRef.current = window.setTimeout(() => {
      const landscape = isLandscape()
      logger.debug('Player', `After debounce: landscape=${landscape}, manualExit=${manualExitInLandscapeRef.current}`)

      if (landscape) {
        // Entering landscape
        if (!manualExitInLandscapeRef.current) {
          logger.debug('Player', 'Entering landscape - requesting fullscreen')
          enterFullscreen()
        } else {
          logger.debug('Player', 'Entering landscape - skipping due to manual exit')
        }
      } else {
        // Entering portrait
        // Reset the manual exit flag since we're back to portrait
        manualExitInLandscapeRef.current = false

        // Exit fullscreen if we're currently in orientation-triggered fullscreen
        if (wasTriggeredByOrientationRef.current) {
          logger.debug('Player', 'Entering portrait - exiting fullscreen')
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
    const mobile = isMobile()
    logger.debug('Player', `Setup effect: enabled=${enabled}, isMobile=${mobile}`)

    if (!enabled || !mobile) {
      logger.debug('Player', 'Setup effect: Skipping listener setup')
      return
    }

    logger.debug('Player', 'Setup effect: Attaching orientation listeners')

    // Use Screen Orientation API if available
    if ('orientation' in screen && screen.orientation) {
      logger.debug('Player', 'Using Screen Orientation API')
      screen.orientation.addEventListener('change', handleOrientationChange)
    }

    // Also use matchMedia for broader support
    const landscapeQuery = window.matchMedia('(orientation: landscape)')
    logger.debug('Player', 'Using matchMedia listener')
    landscapeQuery.addEventListener('change', handleOrientationChange)

    // Initial check - if we're already in landscape on mount
    if (isLandscape()) {
      logger.debug('Player', 'Already in landscape on mount, triggering handler')
      handleOrientationChange()
    }

    return () => {
      logger.debug('Player', 'Cleanup: Removing listeners')
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
