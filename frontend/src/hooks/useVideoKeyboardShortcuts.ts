import { useEffect, useCallback } from 'react'
import type { RefObject } from 'react'

interface UseVideoKeyboardShortcutsOptions {
  containerRef: RefObject<HTMLElement | null>
  onPlayPause: () => void
  onMuteToggle: () => void
  onFullscreenToggle: () => void
  onTheaterModeToggle: () => void
  onVolumeChange: (volume: number) => void
  /** Unmute at the saved level (volume up while muted) */
  onUnmute: () => void
  /** Saved level, kept while muted */
  volume: number
  isMuted: boolean
  /** Leave ArrowUp/ArrowDown alone (TV mode, where they belong to channel changes) */
  ignoreVerticalArrows?: boolean
}

const VOLUME_STEP = 0.1

// Focus on these keeps every key: text entry, sliders, links and composite widgets
const NATIVE_KEYS_SELECTOR =
  'a[href], input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"], [role="textbox"], [role="combobox"], [role="spinbutton"]'
// Buttons keep Space and Enter for activation; other shortcuts still apply
const BUTTON_SELECTOR = 'button, [role="button"]'
const ACTIVATION_KEYS = new Set([' ', 'Enter'])

function matches(target: EventTarget | null, selector: string) {
  return target instanceof Element && Boolean(target.closest(selector))
}

export function useVideoKeyboardShortcuts({
  containerRef,
  onPlayPause,
  onMuteToggle,
  onFullscreenToggle,
  onTheaterModeToggle,
  onVolumeChange,
  onUnmute,
  volume,
  isMuted,
  ignoreVerticalArrows = false,
}: UseVideoKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Only handle shortcuts when video player container or its children are focused
      // or when no specific element is focused (body)
      const container = containerRef.current
      const activeElement = document.activeElement

      const focusMatches = (selector: string) =>
        matches(e.target, selector) || matches(activeElement, selector)

      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey ||
        focusMatches(NATIVE_KEYS_SELECTOR) || focusMatches('[role="dialog"]')) return

      // Check if event target is within video container or is the body
      const isWithinContainer =
        container?.contains(activeElement) || activeElement === document.body

      if (!isWithinContainer) return

      // A focused player button keeps its native Space/Enter activation
      if (ACTIVATION_KEYS.has(e.key) && focusMatches(BUTTON_SELECTOR)) return

      if (ignoreVerticalArrows && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return

      switch (e.key) {
        case ' ': // Space - Play/Pause
          e.preventDefault()
          onPlayPause()
          break

        case 'm':
        case 'M': // M - Mute toggle
          onMuteToggle()
          break

        case 'f':
        case 'F': // F - Fullscreen toggle
          onFullscreenToggle()
          break

        case 't':
        case 'T': // T - Theater mode toggle
          onTheaterModeToggle()
          break

        case 'ArrowUp': // Arrow Up - Volume up
        case 'ArrowRight': // Arrow Right - Volume up (alias)
          e.preventDefault()
          // From mute, come back at the saved level rather than stepping up from zero
          if (isMuted) onUnmute()
          else onVolumeChange(Math.min(1, volume + VOLUME_STEP))
          break

        case 'ArrowDown': // Arrow Down - Volume down
        case 'ArrowLeft': // Arrow Left - Volume down (alias)
          e.preventDefault()
          // Already silent: keep the mute and the saved level
          if (!isMuted) onVolumeChange(Math.max(0, volume - VOLUME_STEP))
          break

        default:
          break
      }
    },
    [
      containerRef,
      onPlayPause,
      onMuteToggle,
      onFullscreenToggle,
      onTheaterModeToggle,
      onVolumeChange,
      onUnmute,
      volume,
      isMuted,
      ignoreVerticalArrows,
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
