import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Built once: the guide formats a time for every one of its ~1,400 blocks
const clockTimeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/**
 * A clock time in the viewer's locale with no leading zero on the hour:
 * '1:52 PM' in en-US, '13:52' in a 24-hour locale. Every clock time in the
 * app uses this, so the guide, the channel lists, the programme dialog and
 * chat all read the same.
 */
export function formatClockTime(time: Date | number): string {
  return clockTimeFormat.format(time)
}

export function formatDuration(isoDate: string): string {
  const start = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - start.getTime()

  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`
  }
  return `${minutes}m`
}

/**
 * Check if the browser can play WebM video with VP9 codec.
 * Used for graceful degradation when WebM is not supported.
 */
export function isWebMSupported(): boolean {
  const video = document.createElement('video')
  // Check VP9 codec support (primary WebM video codec)
  return video.canPlayType('video/webm; codecs="vp9"') !== ''
}
