import { Play, VolumeX } from 'lucide-react'
import { useCanSetVolume } from '@/hooks/useCanSetVolume'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/uiStore'

export type AutoplayNoticeMode = 'sound-off' | 'tap-to-play'

interface AutoplayNoticeProps {
  /**
   * 'sound-off': the browser only allowed muted playback, or this page load
   * started from a saved mute.
   * 'tap-to-play': the browser refused even muted playback.
   */
  mode: AutoplayNoticeMode
  /** Level (0..1) the sound comes back at */
  volume: number
  /** Unmute (the element, or the saved mute). Runs inside the tap, which the browser counts as consent. */
  onUnmute: () => void
  /** Start playback from the tap */
  onPlay: () => void
  /** The player's info rail is up: sit under it rather than on top of it */
  belowRail?: boolean
}

/**
 * Explains a blocked autoplay or a saved mute and offers the one tap that
 * fixes it; the caller decides what that tap changes. Both modes carry
 * `video-controls` so a tap on them counts as using the player controls, not
 * a tap on the picture.
 */
export function AutoplayNotice({ mode, volume, onUnmute, onPlay, belowRail = false }: AutoplayNoticeProps) {
  const canSetVolume = useCanSetVolume()
  // The NHL strip takes the same top band (under the rail, or at the top)
  const isNHLOverlayVisible = useUIStore((s) => s.isNHLOverlayVisible)

  if (mode === 'tap-to-play') {
    return (
      <button
        type="button"
        onClick={onPlay}
        aria-label="Start playback"
        className="video-controls absolute left-1/2 top-1/2 z-30 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-ring-media"
      >
        <Play className="ml-1 h-9 w-9" fill="currentColor" aria-hidden="true" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onUnmute}
      className={cn(
        // Top-centre, clear of the rail's channel block and the bottom control bar
        'video-controls absolute left-1/2 z-30 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 min-h-[44px] items-center gap-3 rounded-full border border-white/15 bg-black/80 py-2 pl-3 pr-4 text-left text-base font-bold text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/90 focus-ring-media',
        // The rail's height (0.75rem above its 3rem row, plus the shell's top inset) and a gap.
        // With the NHL strip open, also its height (about 4.5rem: NHLScoresOverlay's 0.5rem
        // wrapper padding, a padded card around a 2rem row), so the pill sits under it
        belowRail
          ? isNHLOverlayVisible
            ? 'top-[calc(8.75rem+var(--player-inset-top,0px))]'
            : 'top-[calc(4.25rem+var(--player-inset-top,0px))]'
          : isNHLOverlayVisible
            ? 'top-[5rem]'
            : 'top-4'
      )}
    >
      <VolumeX className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
      <span>Sound is off</span>
      <span className="text-sm font-semibold text-white/70">
        {soundOnLabel(volume, canSetVolume)}
      </span>
    </button>
  )
}

// A level is only worth naming when it is audible and the browser honours it
// (iOS/iPadOS ignore script volume, so any stored level there is meaningless)
function soundOnLabel(volume: number, canSetVolume: boolean): string {
  const percent = Math.round(volume * 100)
  return percent > 0 && canSetVolume ? `Restore ${percent}%` : 'Turn sound on'
}
