import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'
import { useMediaPlayer, useMediaRemote, useMediaState } from '@vidstack/react'
import { useLiveLag, useVidstackLiveLag } from '@/hooks/useLiveLag'

/**
 * How far behind its own live edge, in seconds, either engine may fall
 * before it says so.
 */
export const BEHIND_LIVE_SECONDS = 10
/**
 * Where Jump to live lands on the live engine: this far short of the end of
 * the buffer, so playback doesn't stall at once. liveSync's target latency.
 */
export const LIVE_EDGE_MARGIN_SECONDS = 3

/**
 * What PlayerChrome needs from a playback engine. Volume and the viewer's
 * mute are not here: they live in the audio store, which every engine
 * follows, so the chrome reads and writes them there.
 */
export interface PlayerMediaAdapter {
  /** The element is playing (not paused) */
  isPlaying: boolean
  /**
   * The element is muted, whether or not the viewer asked for it (an autoplay
   * fallback, the clip preview hold, or the saved mute being applied)
   */
  elementMuted: boolean
  /** The stream has loaded enough to start playing */
  canPlay: boolean
  togglePaused: () => void
  /** Unmute the element only; the saved mute is the audio store's */
  unmuteElement: () => void
  /** How a cast receiver should fetch this stream */
  streamType: 'hls' | 'mpegts'
  /**
   * The picture is well behind the stream's live edge (a pause, a stall, a
   * slow buffer). Measured against this player's own stream, never the group.
   */
  isBehindLive: boolean
  /** Back to the live edge, playing */
  jumpToLive: () => void
}

/**
 * The live (mpegts.js) engine's adapter, read from its <video> element. The
 * element must stay the same for the engine's lifetime: the engine is keyed
 * by its stream, so a new stream is a new engine.
 */
export function useLiveAdapter(videoRef: RefObject<HTMLVideoElement | null>): PlayerMediaAdapter {
  const [isPlaying, setIsPlaying] = useState(false)
  const [elementMuted, setElementMuted] = useState(false)
  const [canPlay, setCanPlay] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleVolumeChange = () => setElementMuted(video.muted)
    const handleCanPlay = () => setCanPlay(true)

    video.addEventListener('play', handlePlay)
    video.addEventListener('playing', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('volumechange', handleVolumeChange)
    video.addEventListener('canplay', handleCanPlay)
    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('playing', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('volumechange', handleVolumeChange)
      video.removeEventListener('canplay', handleCanPlay)
    }
  }, [videoRef])

  const togglePaused = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (video.paused) {
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [videoRef])

  const unmuteElement = useCallback(() => {
    const video = videoRef.current
    if (video) video.muted = false
  }, [videoRef])

  // The distance to the end of what the element has buffered
  const lag = useLiveLag(videoRef)
  const isBehindLive = lag !== null && lag > BEHIND_LIVE_SECONDS

  // Just short of the buffer's end, then play: a viewer who paused wants the
  // live picture, not a still one that falls behind again
  const jumpToLive = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    const { buffered } = video
    if (buffered.length > 0) {
      const edge = buffered.end(buffered.length - 1) - LIVE_EDGE_MARGIN_SECONDS
      if (edge > video.currentTime) video.currentTime = edge
    }
    if (video.paused) video.play().catch(() => {})
  }, [videoRef])

  return useMemo(
    () => ({
      isPlaying,
      elementMuted,
      canPlay,
      togglePaused,
      unmuteElement,
      streamType: 'mpegts' as const,
      isBehindLive,
      jumpToLive,
    }),
    [isPlaying, elementMuted, canPlay, togglePaused, unmuteElement, isBehindLive, jumpToLive]
  )
}

/**
 * The ErsatzTV (Vidstack) engine's adapter, read from the nearest MediaPlayer,
 * so it must be called inside one. Vidstack's own volume is never read: it
 * reports 100% until the stream can play, and the audio store is the level.
 */
export function useVidstackAdapter(): PlayerMediaAdapter {
  const paused = useMediaState('paused')
  const elementMuted = useMediaState('muted')
  const canPlay = useMediaState('canPlay')
  // The same player and controller for the player's lifetime
  const player = useMediaPlayer()
  const remote = useMediaRemote()
  // The distance to where hls.js plays the live stream from
  const lag = useVidstackLiveLag(player)
  const isBehindLive = lag !== null && lag > BEHIND_LIVE_SECONDS

  const togglePaused = useCallback(() => remote.togglePaused(), [remote])
  // Asks Vidstack directly: a mute only the element has (an autoplay
  // fallback) leaves the muted prop, which follows the saved mute, unchanged
  const unmuteElement = useCallback(() => remote.unmute(), [remote])
  // Straight to hls.js's live position, through the provider: Vidstack's own
  // seeks (remote.seek, remote.seekToLiveEdge) do nothing on a live stream
  // without DVR, which ErsatzTV's are. Then play, as on the live engine.
  const jumpToLive = useCallback(() => {
    if (!player) return

    const { liveSyncPosition, currentTime } = player.state
    if (liveSyncPosition !== null && Number.isFinite(liveSyncPosition) && liveSyncPosition > currentTime) {
      player.provider?.setCurrentTime(liveSyncPosition)
    }
    if (paused) remote.play()
  }, [player, remote, paused])

  return useMemo(
    () => ({
      isPlaying: !paused,
      elementMuted,
      canPlay,
      togglePaused,
      unmuteElement,
      streamType: 'hls' as const,
      isBehindLive,
      jumpToLive,
    }),
    [paused, elementMuted, canPlay, togglePaused, unmuteElement, isBehindLive, jumpToLive]
  )
}
