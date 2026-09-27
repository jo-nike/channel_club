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
 * Turn a `?tv=1` / `?tv=0` link into the stored TV layout override
 * (localStorage 'tv-mode' = 'true' / 'false'), then drop the parameter from
 * the address bar so a bookmark or reload doesn't carry it. For TV browsers
 * the user agent check misses (Android TV, Fire TV) and for testing.
 * Any other value, or no parameter, changes nothing.
 *
 * Runs before the router and the stores are created (see tvModeParam.ts), so
 * everything that reads TV mode at startup already sees the override.
 */
export function applyTVModeQueryParam(): void {
  const url = new URL(window.location.href)
  const value = url.searchParams.get('tv')
  if (value !== '1' && value !== '0') return

  localStorage.setItem('tv-mode', value === '1' ? 'true' : 'false')
  url.searchParams.delete('tv')
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
}

/**
 * Custom hook to detect TV browsers (WebOS, Tizen).
 * Enables 10-foot UI mode for better viewing from a distance.
 *
 * Detection order:
 * 1. localStorage override (tv-mode: 'true' | 'false'), also set by ?tv=1 / ?tv=0
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
