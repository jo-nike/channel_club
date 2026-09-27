import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const AUDIO_STORAGE_KEY = 'audio-storage'
// uiStore used to persist `volume`; it is read once to seed this store.
const LEGACY_UI_STORAGE_KEY = 'ui-storage'

// Below this level the player is silent, so it is treated as a mute.
const MUTE_THRESHOLD = 0.01
// Unmuting at a barely audible level would still sound like a mute.
const UNMUTE_FLOOR = 0.1
const UNMUTE_VOLUME = 0.25
// A legacy stored level of 0 meant "muted"; unmuting it gives this level.
const LEGACY_MUTED_VOLUME = 0.5

interface AudioLevels {
  volume: number
  muted: boolean
}

interface AudioState extends AudioLevels {
  /**
   * This page load started from a saved mute that the viewer has not acted on
   * yet, so the player should say the sound is off. Never saved.
   */
  savedMuteNotice: boolean
  /** Set the level (clamped to 0..1, snapped to hundredths). Below 0.01 mutes and keeps the previous level. */
  setVolume: (value: number) => void
  /** Mute or unmute. Unmuting below 0.1 raises the level to 0.25 so it is audible. */
  setMuted: (value: boolean) => void
  /** The saved-mute notice has been shown; don't show it again this page load. */
  dismissSavedMuteNotice: () => void
}

function snapVolume(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

/** The level unmuting gives: a saved level below 0.1 comes back at 0.25. */
export function unmutedVolume(volume: number): number {
  return volume < UNMUTE_FLOOR ? UNMUTE_VOLUME : volume
}

// Read the level uiStore used to persist, but only before this store has ever been saved.
function readLegacySeed(): AudioLevels | null {
  try {
    if (localStorage.getItem(AUDIO_STORAGE_KEY) !== null) return null
    const stored = localStorage.getItem(LEGACY_UI_STORAGE_KEY)
    if (!stored) return null
    const volume: unknown = JSON.parse(stored)?.state?.volume
    if (typeof volume !== 'number' || !Number.isFinite(volume)) return null
    if (volume < MUTE_THRESHOLD) return { volume: LEGACY_MUTED_VOLUME, muted: true }
    return { volume: snapVolume(volume), muted: false }
  } catch {
    return null
  }
}

const legacySeed = readLegacySeed()

/**
 * Volume and mute shared by every player, persisted on their own so channel
 * switches, stream retries and reloads all start from the viewer's choice.
 * Only user actions (mute button, M key, slider, arrow keys) write here;
 * temporary element mutes such as the clip preview duck never do.
 */
export const useAudioStore = create<AudioState>()(
  persist(
    (set) => ({
      volume: 1,
      muted: false,
      savedMuteNotice: false,
      // Any choice the viewer makes this session replaces the saved one
      setVolume: (value) => {
        const volume = snapVolume(value)
        if (volume < MUTE_THRESHOLD) set({ muted: true, savedMuteNotice: false })
        else set({ volume, muted: false, savedMuteNotice: false })
      },
      setMuted: (muted) =>
        set((s) => ({ muted, volume: muted ? s.volume : unmutedVolume(s.volume), savedMuteNotice: false })),
      dismissSavedMuteNotice: () => set({ savedMuteNotice: false }),
    }),
    {
      name: AUDIO_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({ volume: state.volume, muted: state.muted }),
    }
  )
)

// zustand's persist only writes on set(), so write the seed now: once uiStore
// saves without its old `volume` field, the legacy level is gone.
if (legacySeed) useAudioStore.setState(legacySeed)

// A reload can start muted (the mute is saved), which is easy to miss on a
// phone without a slider or on a TV, so the player points it out once.
if (useAudioStore.getState().muted) useAudioStore.setState({ savedMuteNotice: true })

// Another window (the PWA plus a tab) saved a change: pick it up so this
// window's next write doesn't overwrite it with a stale level.
window.addEventListener('storage', (e) => {
  if (e.key === AUDIO_STORAGE_KEY) void useAudioStore.persist.rehydrate()
})
