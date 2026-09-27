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
