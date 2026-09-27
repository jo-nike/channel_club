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
