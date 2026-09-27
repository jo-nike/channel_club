import type { HighlightStatusResponse } from '@/services/api'

/** A clip starts as the stretch ending at the press, which is short enough to share. */
export const DEFAULT_CLIP_SECONDS = 20

/** The default selection: the DEFAULT_CLIP_SECONDS that end where the user pressed, or at the capture's end if it stops short of the press. */
export function pressRange(duration: number, press: number): [number, number] {
  const end = Math.min(duration, Math.max(Math.min(duration, 0.1), press))
  return [Math.max(0, end - DEFAULT_CLIP_SECONDS), end]
}

/** The chat message for a posted clip; chat plays a link ending in .mp4 or .webm inline. */
export function clipMessage(channelName: string, seconds: number, caption: string, url: string) {
  const length = Number(seconds.toFixed(1))
  return `Clip from ${channelName} (${length}s)${caption ? `: ${caption}` : ''} ${url}`
}

/** Whether the channel's clip buffer can give a clip: only 'ready' can. */
export type ClipBufferState = 'checking' | 'unavailable' | 'buffering' | 'ready'

/**
 * The clip buffer's state from the latest status poll (`loaded` is false until
 * the first poll answers), and the clip control's label for it. The control
 * and the X key both follow it, so neither captures before the buffer is ready.
 */
export function clipBufferStatus(status: HighlightStatusResponse, loaded: boolean) {
  const seconds = Math.max(0, Math.floor(status.bufferSeconds || 0))
  const maxSeconds = Math.max(0, Math.floor(status.maxBufferSeconds || 0))
  const state: ClipBufferState = !loaded ? 'checking'
    : !status.recording ? 'unavailable'
      : (status.ready ?? seconds > 0) ? 'ready' : 'buffering'
  const label = state === 'ready' ? `Capture clip · ${seconds}s available`
    : state === 'buffering' ? `Buffering clip · ${seconds}s of ${maxSeconds}s`
      : state === 'checking' ? 'Checking clip…' : 'Clip unavailable'
  return { state, label, seconds, maxSeconds }
}
