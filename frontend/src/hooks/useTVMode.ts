import { useState, useEffect } from 'react'

/**
 * TV mode detection threshold - screens >= 1280px are considered TV/10-foot UI
 */
export const TV_MODE_THRESHOLD = 1280

/**
 * Detect if the current environment should use TV mode.
 * Checks localStorage override, TV browser user agents, and screen size.
 * Exported for testing purposes.
 */
export function detectTVMode(): boolean {
  // Check localStorage override first
  // Note: Using == null to also handle undefined (JSDOM returns undefined for missing keys)
  const storedPreference = localStorage.getItem('tv-mode')
  if (storedPreference != null) {
    return storedPreference === 'true'
  }

  // Check for TV browser user agents
  const userAgent = navigator.userAgent.toLowerCase()
  const isWebOS = /webos|web0s/i.test(userAgent)
  const isTizen = /tizen/i.test(userAgent)

  if (isWebOS || isTizen) {
    return true
  }

  // Check for large screen (TV-sized display)
  return window.innerWidth >= TV_MODE_THRESHOLD
}

/**
 * Custom hook to detect TV browsers (WebOS, Tizen) or large screens (>= 1280px).
 * Enables 10-foot UI mode for better viewing from a distance.
 *
 * Detection order:
 * 1. localStorage override (tv-mode: 'true' | 'false')
 * 2. WebOS user agent detection
 * 3. Tizen user agent detection
 * 4. Large screen detection (>= 1280px)
 *
 * @returns boolean indicating if TV mode should be active
 *
 * @example
 * const isTVMode = useTVMode()
 * // Apply tv-mode class to body for CSS targeting
 * useEffect(() => {
 *   document.body.classList.toggle('tv-mode', isTVMode)
 * }, [isTVMode])
 */
export function useTVMode(): boolean {
  const [isTVMode, setIsTVMode] = useState(() => detectTVMode())

  useEffect(() => {
    const handleResize = () => {
      setIsTVMode(detectTVMode())
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return isTVMode
}
