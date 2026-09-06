import { useEffect, useCallback } from 'react'
import type { RefObject } from 'react'

interface UseVideoKeyboardShortcutsOptions {
  containerRef: RefObject<HTMLElement | null>
  onPlayPause: () => void
  onMuteToggle: () => void
  onFullscreenToggle: () => void
  onTheaterModeToggle: () => void
  onVolumeChange: (volume: number) => void
  volume: number
}

const VOLUME_STEP = 0.1

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    'button, a[href], input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"], [role="textbox"], [role="combobox"], [role="spinbutton"]'
  ))
}

export function useVideoKeyboardShortcuts({
  containerRef,
  onPlayPause,
  onMuteToggle,
  onFullscreenToggle,
  onTheaterModeToggle,
  onVolumeChange,
  volume,
}: UseVideoKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Only handle shortcuts when video player container or its children are focused
      // or when no specific element is focused (body)
      const container = containerRef.current
      const activeElement = document.activeElement

      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey ||
        isInteractiveTarget(e.target) || isInteractiveTarget(activeElement)) return

      // Check if event target is within video container or is the body
      const isWithinContainer =
        container?.contains(activeElement) || activeElement === document.body

      if (!isWithinContainer) return

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

        case 'ArrowRight': // Arrow Right - Volume up
          e.preventDefault()
          onVolumeChange(Math.min(1, volume + VOLUME_STEP))
          break

        case 'ArrowLeft': // Arrow Left - Volume down
          e.preventDefault()
          onVolumeChange(Math.max(0, volume - VOLUME_STEP))
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
      volume,
    ]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
