import { useEffect, useCallback } from 'react'
import type { RefObject } from 'react'

/**
 * Every action is optional, so the playback keys can live with the engine
 * that plays and the channel keys with the shell, which is there even when no
 * engine is (the empty live slot). A key with no action is left alone.
 */
interface UseVideoKeyboardShortcutsOptions {
  containerRef: RefObject<HTMLElement | null>
  onPlayPause?: () => void
  onMuteToggle?: () => void
  onFullscreenToggle?: () => void
  onTheaterModeToggle?: () => void
  /** Start the stream again (R), as the player's Reload does */
  onRetry?: () => void
  onVolumeChange?: (volume: number) => void
  /** Unmute at the saved level (volume up while muted) */
  onUnmute?: () => void
  /** Saved level, kept while muted */
  volume?: number
  isMuted?: boolean
  /** Channel up (+1: PageUp, ]) or down (-1: PageDown, [) */
  onChannelStep?: (dir: 1 | -1) => void
  /** Back to the channel watched before this one (L) */
  onLastChannel?: () => void
  /** A digit of a channel number ('0'-'9') */
  onDigit?: (digit: string) => void
  /** Enter: commit the number being typed; returns false when none is */
  onDigitCommit?: () => boolean
  /** Open the list of shortcuts (?) */
  onShortcutSheet?: () => void
  /** Open or close chat (C) */
  onChatToggle?: () => void
  /** Show or hide the NHL scores (N) */
  onNHLToggle?: () => void
  /** Focus the channel search (/) */
  onFocusSearch?: () => void
  /** Leave ArrowUp/ArrowDown alone (TV mode, where they belong to channel changes) */
  ignoreVerticalArrows?: boolean
}

const VOLUME_STEP = 0.1

// Focus on these keeps every key: text entry, sliders, links and composite
// widgets (their items, and the containers that move focus between them)
const NATIVE_KEYS_SELECTOR =
  'a[href], input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"], [role="textbox"], [role="combobox"], [role="spinbutton"], [role="grid"], [role="treegrid"], [role="listbox"], [role="menu"], [role="menubar"], [role="radiogroup"], [role="tablist"], [role="tree"]'
// Buttons keep Space and Enter for activation; other shortcuts still apply
const BUTTON_SELECTOR = 'button, [role="button"]'
const ACTIVATION_KEYS = new Set([' ', 'Enter'])
// Space and the arrows act on the player itself, so they need focus in the
// player or on nothing: elsewhere they scroll the page or move focus in a list.
// Every other shortcut is a single key that nothing else on the page uses, so
// it also works with focus on a channel button just clicked.
const PLAYER_KEYS = new Set([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

function matches(target: EventTarget | null, selector: string) {
  return target instanceof Element && Boolean(target.closest(selector))
}

export function useVideoKeyboardShortcuts({
  containerRef,
  onPlayPause,
  onMuteToggle,
  onFullscreenToggle,
  onTheaterModeToggle,
  onRetry,
  onVolumeChange,
  onUnmute,
  volume = 0,
  isMuted = false,
  onChannelStep,
  onLastChannel,
  onDigit,
  onDigitCommit,
  onShortcutSheet,
  onChatToggle,
  onNHLToggle,
  onFocusSearch,
  ignoreVerticalArrows = false,
}: UseVideoKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const container = containerRef.current
      const activeElement = document.activeElement

      const focusMatches = (selector: string) =>
        matches(e.target, selector) || matches(activeElement, selector)

      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey ||
        focusMatches(NATIVE_KEYS_SELECTOR) || focusMatches('[role="dialog"]')) return

      // Space and the arrows only with focus in the player container or on
      // nothing (body)
      const isWithinContainer =
        container?.contains(activeElement) || activeElement === document.body

      if (PLAYER_KEYS.has(e.key) && !isWithinContainer) return

      // A focused button keeps its native Space/Enter activation
      if (ACTIVATION_KEYS.has(e.key) && focusMatches(BUTTON_SELECTOR)) return

      if (ignoreVerticalArrows && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return

      switch (e.key) {
        case ' ': // Space - Play/Pause
          if (!onPlayPause) break
          e.preventDefault()
          onPlayPause()
          break

        case 'm':
        case 'M': // M - Mute toggle
          onMuteToggle?.()
          break

        case 'f':
        case 'F': // F - Fullscreen toggle
          onFullscreenToggle?.()
          break

        case 't':
        case 'T': // T - Theater mode toggle
          onTheaterModeToggle?.()
          break

        case 'r':
        case 'R': // R - Reload the stream
          onRetry?.()
          break

        case 'ArrowUp': // Arrow Up - Volume up
        case 'ArrowRight': // Arrow Right - Volume up (alias)
          if (!onVolumeChange) break
          e.preventDefault()
          // From mute, come back at the saved level rather than stepping up from zero
          if (isMuted) onUnmute?.()
          else onVolumeChange(Math.min(1, volume + VOLUME_STEP))
          break

        case 'ArrowDown': // Arrow Down - Volume down
        case 'ArrowLeft': // Arrow Left - Volume down (alias)
          if (!onVolumeChange) break
          e.preventDefault()
          // Already silent: keep the mute and the saved level
          if (!isMuted) onVolumeChange(Math.max(0, volume - VOLUME_STEP))
          break

        case 'PageUp': // PageUp or ] - Channel up (webOS CH+ arrives as PageUp)
        case ']':
        case 'PageDown': // PageDown or [ - Channel down
        case '[':
          if (!onChannelStep) break
          // Not a page scroll as well
          e.preventDefault()
          onChannelStep(e.key === 'PageUp' || e.key === ']' ? 1 : -1)
          break

        case 'l':
        case 'L': // L - Last channel
          onLastChannel?.()
          break

        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9': // 0-9 - Type a channel number
          onDigit?.(e.key)
          break

        case 'Enter': // Enter - Tune the number typed so far (a focused button keeps it)
          if (onDigitCommit?.()) e.preventDefault()
          break

        case '?': // ? - The list of shortcuts
          onShortcutSheet?.()
          break

        case 'c':
        case 'C': // C - Chat
          onChatToggle?.()
          break

        case 'n':
        case 'N': // N - NHL scores
          onNHLToggle?.()
          break

        case '/': // / - Channel search
          if (!onFocusSearch) break
          // Not typed into the box it focuses, nor the browser's quick find
          e.preventDefault()
          onFocusSearch()
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
      onRetry,
      onVolumeChange,
      onUnmute,
      volume,
      isMuted,
      onChannelStep,
      onLastChannel,
      onDigit,
      onDigitCommit,
      onShortcutSheet,
      onChatToggle,
      onNHLToggle,
      onFocusSearch,
      ignoreVerticalArrows,
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
