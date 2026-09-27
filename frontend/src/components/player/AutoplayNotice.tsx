import { Play, VolumeX } from 'lucide-react'

export type AutoplayNoticeMode = 'sound-off' | 'tap-to-play'

interface AutoplayNoticeProps {
  /**
   * 'sound-off': the browser only allowed muted playback.
   * 'tap-to-play': the browser refused even muted playback.
   */
  mode: AutoplayNoticeMode
  /** Saved level (0..1) the sound comes back at */
  volume: number
  /** Unmute the element. Runs inside the tap, which the browser counts as consent. */
  onUnmute: () => void
  /** Start playback from the tap */
  onPlay: () => void
}

/**
 * Explains a blocked autoplay and offers the one tap that fixes it. Neither
 * mode touches the saved audio preference. Both carry `video-controls` so a
 * tap on them counts as using the player controls, not a tap on the picture.
 */
export function AutoplayNotice({ mode, volume, onUnmute, onPlay }: AutoplayNoticeProps) {
  if (mode === 'tap-to-play') {
    return (
      <button
        type="button"
        onClick={onPlay}
        aria-label="Start playback"
        className="video-controls absolute left-1/2 top-1/2 z-30 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
      >
        <Play className="ml-1 h-9 w-9" fill="currentColor" aria-hidden="true" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onUnmute}
      className="video-controls absolute left-4 top-4 z-30 flex min-h-[44px] items-center gap-3 rounded-full border border-white/15 bg-black/80 py-2 pl-3 pr-4 text-left text-base font-bold text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/80"
    >
      <VolumeX className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
      <span>Sound is off</span>
      <span className="text-sm font-semibold text-white/70">
        Restore {Math.round(volume * 100)}%
      </span>
    </button>
  )
}
