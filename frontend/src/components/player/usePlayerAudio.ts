import { useCallback } from 'react'
import { useCanSetVolume } from '@/hooks/useCanSetVolume'
import { useAudioStore } from '@/stores/audioStore'
import type { PlayerMediaAdapter } from './mediaAdapters'

/**
 * The viewer's volume and mute for one engine, shared by its control bar and
 * its keyboard shortcuts. The saved levels are the audio store's; the
 * element's own mute (an autoplay fallback, the clip preview hold) counts as
 * muted for display and for what Mute does next, but is never saved.
 */
export function usePlayerAudio({ elementMuted, unmuteElement }: Pick<PlayerMediaAdapter, 'elementMuted' | 'unmuteElement'>) {
  const volume = useAudioStore((s) => s.volume)
  const isStoreMuted = useAudioStore((s) => s.muted)
  const setStoredVolume = useAudioStore((s) => s.setVolume)
  const setStoredMuted = useAudioStore((s) => s.setMuted)
  const canSetVolume = useCanSetVolume()
  const isMuted = isStoreMuted || elementMuted

  const changeVolume = useCallback(
    (next: number) => {
      // A level the browser ignores (iOS/iPadOS) would only save a meaningless value
      if (!canSetVolume) return
      setStoredVolume(next)
      // Choosing an audible level also clears a mute that only the element had
      if (!useAudioStore.getState().muted) unmuteElement()
    },
    [canSetVolume, setStoredVolume, unmuteElement]
  )

  const toggleMute = useCallback(() => {
    const next = !(useAudioStore.getState().muted || elementMuted)
    setStoredMuted(next)
    // An element-only mute leaves the store unchanged, so unmute the element too
    if (!next) unmuteElement()
  }, [elementMuted, setStoredMuted, unmuteElement])

  // Clears the saved mute (the store brings back the saved level) and any
  // mute only the element had
  const unmute = useCallback(() => {
    setStoredMuted(false)
    unmuteElement()
  }, [setStoredMuted, unmuteElement])

  return { volume, isStoreMuted, isMuted, canSetVolume, changeVolume, toggleMute, unmute }
}
