import { useEffect, useId, useState } from 'react'
import { AlertTriangle, Cast, Square, Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setReceiverVolume, stopCasting, toggleReceiverMute } from '@/hooks/useChromecast'
import { getFullscreenElement } from '@/hooks/useFullscreenState'
import { useCastStore, type CastError } from '@/stores/castStore'
import { usePlayerShell } from './PlayerShellContext'

const CONTROL_BUTTON =
  'control-button flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-ring-media'

/**
 * What the player shows while it casts, in place of the local picture (which
 * is paused and silent underneath): where it is playing, the receiver's own
 * volume and Stop. In the shell, so it shows in fullscreen and theater.
 *
 * It covers the picture, not the player: the shell puts it under the control
 * bar and the info rail, so Exit theater, Exit fullscreen, the channel
 * buttons and the zap feedback stay in reach while casting. The bottom
 * padding keeps its own controls clear of the bar.
 */
export function CastingCard() {
  const deviceName = useCastStore((s) => s.deviceName)
  const volume = useCastStore((s) => s.receiverVolume)
  const muted = useCastStore((s) => s.receiverMuted)
  const titleId = useId()
  const muteLabel = muted ? 'Unmute Chromecast' : 'Mute Chromecast'

  return (
    // video-controls: a tap on the card uses it rather than toggling the controls
    <section
      aria-labelledby={titleId}
      className="video-controls absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black px-6 pb-20 text-center text-white"
    >
      <div className="flex items-center gap-3">
        <Cast className="h-8 w-8 shrink-0 text-primary" aria-hidden="true" />
        <h2 id={titleId} className="font-display text-2xl font-extrabold tracking-wide sm:text-3xl">
          {deviceName ? `Casting to ${deviceName}` : 'Casting'}
        </h2>
      </div>
      <p className="hidden text-sm text-white/70 sm:block">The picture here is paused while it plays there.</p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={toggleReceiverMute} aria-label={muteLabel} className={CONTROL_BUTTON}>
          {muted ? <VolumeX className="h-6 w-6" aria-hidden="true" /> : <Volume2 className="h-6 w-6" aria-hidden="true" />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => setReceiverVolume(parseFloat(e.target.value))}
          aria-label="Chromecast volume"
          className={`mr-2 h-2 w-32 cursor-pointer appearance-none rounded-full bg-white/30 accent-white focus-ring-media ${
            muted ? 'opacity-50' : ''
          }`}
        />
        <Button onClick={() => void stopCasting()} className="min-h-11 focus-ring-media">
          <Square aria-hidden="true" />
          Stop casting
        </Button>
      </div>
    </section>
  )
}

// Long enough to read, short enough not to sit over the picture
const BANNER_MS = 8000

/**
 * A cast failure while the player is fullscreen, where the page's toasts
 * can't show (the cast button toasts the rest). Only failures that happen in
 * fullscreen, and only while it lasts.
 */
export function CastErrorBanner() {
  const { containerRef, isFullscreen } = usePlayerShell()
  const [error, setError] = useState<CastError | null>(null)

  useEffect(
    () =>
      useCastStore.subscribe((state, prev) => {
        const shell = containerRef.current
        if (state.lastError && state.lastError !== prev.lastError && shell && getFullscreenElement() === shell) {
          setError(state.lastError)
        }
      }),
    [containerRef]
  )

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), BANNER_MS)
    return () => window.clearTimeout(timer)
  }, [error])

  if (!error || !isFullscreen) return null

  return (
    <div className="video-controls absolute left-1/2 top-[calc(1rem+var(--player-inset-top,0px))] z-50 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-black/85 py-1 pl-4 pr-1 text-sm font-semibold text-white shadow-lg backdrop-blur-md">
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <p role="alert">{error.message}</p>
      <button
        type="button"
        onClick={() => setError(null)}
        aria-label="Dismiss"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus-ring-media"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
