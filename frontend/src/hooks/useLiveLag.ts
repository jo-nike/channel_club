import { useEffect, useState, type RefObject } from 'react'
import type { MediaPlayerInstance, MediaState } from '@vidstack/react'

/** How often the lag is measured */
const LIVE_LAG_CHECK_MS = 1000

/**
 * How far, in seconds, the picture is behind the end of what this element has
 * buffered; null while nothing is buffered.
 */
export function measureLiveLag(video: HTMLVideoElement): number | null {
  const { buffered } = video
  if (buffered.length === 0) return null
  return Math.max(0, buffered.end(buffered.length - 1) - video.currentTime)
}

/**
 * The live (mpegts.js) engine's distance from its own live edge, in whole
 * seconds, measured every second and after every seek; null while nothing
 * is buffered.
 *
 * This is the local buffer only: a viewer who reconnected 30s behind their
 * friends measures close to 0 here. It says nothing about the group.
 */
export function useLiveLag(videoRef: RefObject<HTMLVideoElement | null>): number | null {
  const [lag, setLag] = useState<number | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Whole seconds, so steady playback doesn't re-render every second
    const measure = () => {
      const seconds = measureLiveLag(video)
      setLag(seconds === null ? null : Math.round(seconds))
    }
    const timer = window.setInterval(measure, LIVE_LAG_CHECK_MS)
    // At once after a seek, so a jump to live shows without waiting a tick
    video.addEventListener('seeked', measure)
    return () => {
      window.clearInterval(timer)
      video.removeEventListener('seeked', measure)
    }
  }, [videoRef])

  return lag
}

/**
 * How far, in seconds, a Vidstack (HLS) picture is behind the position hls.js
 * plays a live stream from: its liveSyncPosition, the playlist's end less
 * hls.js's target latency (about three segments). Null when that isn't
 * known: not a live stream, not ready yet, or not played through hls.js
 * (Safari's native HLS reports no sync position).
 *
 * Not buffered.end, as on the live engine: hls.js buffers to the end of the
 * playlist, about three segments past a picture that is at live, so a viewer
 * at live would read as well behind. Not Vidstack's liveEdge either: without
 * DVR (an ErsatzTV playlist is a plain sliding window) Vidstack can't seek,
 * and it then reports every live picture as at the edge.
 */
export function measureVidstackLiveLag(
  state: Pick<MediaState, 'live' | 'canPlay' | 'currentTime' | 'liveSyncPosition'>
): number | null {
  const { live, canPlay, currentTime, liveSyncPosition } = state
  if (!live || !canPlay || liveSyncPosition === null || !Number.isFinite(liveSyncPosition)) return null
  return Math.max(0, liveSyncPosition - currentTime)
}

/**
 * The ErsatzTV (Vidstack) engine's distance from hls.js's live position, in
 * whole seconds, measured every second and after every seek; null while it
 * isn't known (see measureVidstackLiveLag). Read from the player's state
 * rather than subscribed to: the picture's time changes every frame.
 *
 * Like useLiveLag, this is this viewer's own stream only, never the group.
 */
export function useVidstackLiveLag(player: MediaPlayerInstance | null): number | null {
  const [lag, setLag] = useState<number | null>(null)

  useEffect(() => {
    if (!player) return

    const measure = () => {
      const seconds = measureVidstackLiveLag(player.state)
      setLag(seconds === null ? null : Math.round(seconds))
    }
    const timer = window.setInterval(measure, LIVE_LAG_CHECK_MS)
    // At once after a seek, so a jump to live shows without waiting a tick
    const stopListening = player.listen('seeked', measure)
    return () => {
      window.clearInterval(timer)
      stopListening()
    }
  }, [player])

  return lag
}
