import { useState, useEffect } from 'react'

/**
 * Detect if the current environment should use TV mode.
 * Checks localStorage override and TV browser user agents (WebOS, Tizen).
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

  // Only detect actual TV browsers, not screen size
  // Desktop users should get popup auth regardless of screen size
  return isWebOS || isTizen
}

/**
 * Custom hook to detect TV browsers (WebOS, Tizen).
 * Enables 10-foot UI mode for better viewing from a distance.
 *
 * Detection order:
 * 1. localStorage override (tv-mode: 'true' | 'false')
 * 2. WebOS user agent detection
 * 3. Tizen user agent detection
 *
 * There is no global `tv-mode` stylesheet or body class: couch (10-foot)
 * sizing lives in the components that read this hook.
 *
 * @returns boolean indicating if TV mode should be active
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
