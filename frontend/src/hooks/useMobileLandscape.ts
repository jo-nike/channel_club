import { useState, useEffect, useCallback } from 'react'

/**
 * Hook that detects when a mobile device is in landscape orientation.
 * Used to trigger CSS-based pseudo-fullscreen for video players.
 *
 * Returns true when:
 * - Screen width <= 926px (max phone width in landscape)
 * - Device has touch capability (pointer: coarse)
 * - Orientation is landscape
 */
export function useMobileLandscape(): boolean {
  const [isMobileLandscape, setIsMobileLandscape] = useState(false)

  const checkMobileLandscape = useCallback(() => {
    if (typeof window === 'undefined') return false

    // Check for mobile device (touch capable)
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches
    if (!isTouchDevice) return false

    // Check for landscape orientation
    const isLandscape = window.matchMedia('(orientation: landscape)').matches
    if (!isLandscape) return false

    // Check screen width - phones in landscape are typically <= 926px wide
    // (iPhone 14 Pro Max landscape = 926px)
    const isPhoneSize = window.matchMedia('(max-width: 926px)').matches

    return isPhoneSize
  }, [])

  useEffect(() => {
    // Initial check
    setIsMobileLandscape(checkMobileLandscape())

    // Listen for orientation changes
    const handleChange = () => {
      setIsMobileLandscape(checkMobileLandscape())
    }

    // Use multiple listeners for broad compatibility
    const orientationQuery = window.matchMedia('(orientation: landscape)')
    orientationQuery.addEventListener('change', handleChange)

    // Also listen for resize (fallback)
    window.addEventListener('resize', handleChange)

    // Screen Orientation API
    if ('orientation' in screen && screen.orientation) {
      screen.orientation.addEventListener('change', handleChange)
    }

    return () => {
      orientationQuery.removeEventListener('change', handleChange)
      window.removeEventListener('resize', handleChange)
      if ('orientation' in screen && screen.orientation) {
        screen.orientation.removeEventListener('change', handleChange)
      }
    }
  }, [checkMobileLandscape])

  return isMobileLandscape
}
