import { useState, useEffect } from 'react'

const STORAGE_KEY = 'tv-mode'

// A TV layout choice this browser wouldn't store (blocked site data, a
// locked-down TV browser). It applies for this page load only. undefined:
// none; null: Auto.
let pageOnlyPreference: string | null | undefined

/** The stored 'tv-mode' value, or null when there is none or storage is blocked. */
function readStoredPreference(): string | null {
  if (pageOnlyPreference !== undefined) return pageOnlyPreference
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Store the 'tv-mode' value (null clears it). When storage throws, keep the
 * value in memory for this page load instead of stopping the app.
 */
function storePreference(value: string | null): void {
  try {
    if (value == null) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, value)
    }
    pageOnlyPreference = undefined
  } catch {
    pageOnlyPreference = value
  }
}

/**
 * Detect if the current environment should use TV mode.
 * Checks localStorage override and TV browser user agents (WebOS, Tizen).
 * Exported for testing purposes.
 */
export function detectTVMode(): boolean {
  // Check localStorage override first
  // Note: Using == null to also handle undefined (JSDOM returns undefined for missing keys)
  const storedPreference = readStoredPreference()
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

/** The stored TV layout choice: 'auto' follows the user agent check. */
export type TVModeOverride = 'auto' | 'on' | 'off'

// Tells mounted useTVMode hooks that the stored choice changed
const TV_MODE_CHANGE_EVENT = 'tv-mode-change'

/** The TV layout choice stored in this browser ('auto' when there is none). */
export function readTVModeOverride(): TVModeOverride {
  const storedPreference = readStoredPreference()
  if (storedPreference == null) return 'auto'
  return storedPreference === 'true' ? 'on' : 'off'
}

/**
 * Store the TV layout choice ('auto' clears it) and switch the layout now,
 * without a reload.
 */
export function setTVModeOverride(mode: TVModeOverride): void {
  storePreference(mode === 'auto' ? null : mode === 'on' ? 'true' : 'false')
  window.dispatchEvent(new Event(TV_MODE_CHANGE_EVENT))
}

/**
 * Turn a `?tv=1` / `?tv=0` link into the stored TV layout override
 * (localStorage 'tv-mode' = 'true' / 'false'), then drop the parameter from
 * the address bar so a bookmark or reload doesn't carry it. For TV browsers
 * the user agent check misses (Android TV, Fire TV) and for testing.
 * Any other value, or no parameter, changes nothing. Where storage is
 * blocked the choice applies for this page load only.
 *
 * Runs before the router and the stores are created (see tvModeParam.ts), so
 * everything that reads TV mode at startup already sees the override.
 */
export function applyTVModeQueryParam(): void {
  const url = new URL(window.location.href)
  const value = url.searchParams.get('tv')
  if (value !== '1' && value !== '0') return

  storePreference(value === '1' ? 'true' : 'false')
  url.searchParams.delete('tv')
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
}

/**
 * Custom hook to detect TV browsers (WebOS, Tizen).
 * Enables 10-foot UI mode for better viewing from a distance.
 *
 * Detection order:
 * 1. localStorage override (tv-mode: 'true' | 'false'), set by ?tv=1 / ?tv=0
 *    or the account menu's TV layout choice (setTVModeOverride)
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
    const recheck = () => {
      setIsTVMode(detectTVMode())
    }

    window.addEventListener('resize', recheck)
    window.addEventListener(TV_MODE_CHANGE_EVENT, recheck)
    return () => {
      window.removeEventListener('resize', recheck)
      window.removeEventListener(TV_MODE_CHANGE_EVENT, recheck)
    }
  }, [])

  return isTVMode
}
