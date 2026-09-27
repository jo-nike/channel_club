import { useSyncExternalStore } from 'react'

let canSetVolume: boolean | null = null
let detection: Promise<boolean> | null = null
const listeners = new Set<() => void>()

/**
 * Detect, once per page, whether script can change media volume. iOS and
 * iPadOS Safari ignore `video.volume` (it always reads 1), leaving Mute as the
 * only working control. Same check as Vidstack's canChangeVolume: set the
 * volume on a detached video and read it back after a tick.
 */
export function detectCanSetVolume(): Promise<boolean> {
  detection ??= new Promise<boolean>((resolve) => {
    const video = document.createElement('video')
    video.volume = 0.5
    setTimeout(() => resolve(video.volume === 0.5), 0)
  }).then((result) => {
    canSetVolume = result
    listeners.forEach((listener) => listener())
    return result
  })
  return detection
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  void detectCanSetVolume()
  return () => {
    listeners.delete(listener)
  }
}

// Assume settable until detection says otherwise, so desktop never flashes a missing slider
const getSnapshot = () => canSetVolume ?? true

/**
 * Whether a volume slider does anything in this browser. Deliberately not
 * Vidstack's useMediaState('canSetVolume'), which starts false and resolves
 * again on every provider change, so the slider would flash on each channel.
 */
export function useCanSetVolume(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
