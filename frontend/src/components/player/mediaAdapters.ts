import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react'

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

  return useMemo(
    () => ({ isPlaying, elementMuted, canPlay, togglePaused, unmuteElement, streamType: 'mpegts' as const }),
    [isPlaying, elementMuted, canPlay, togglePaused, unmuteElement]
  )
}
