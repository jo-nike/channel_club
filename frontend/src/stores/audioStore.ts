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
  /** Set the level (clamped to 0..1, snapped to hundredths). Below 0.01 mutes and keeps the previous level. */
  setVolume: (value: number) => void
  /** Mute or unmute. Unmuting below 0.1 raises the level to 0.25 so it is audible. */
  setMuted: (value: boolean) => void
}

function snapVolume(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
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
      setVolume: (value) => {
        const volume = snapVolume(value)
        if (volume < MUTE_THRESHOLD) set({ muted: true })
        else set({ volume, muted: false })
      },
      setMuted: (muted) =>
        set((s) => (!muted && s.volume < UNMUTE_FLOOR ? { muted, volume: UNMUTE_VOLUME } : { muted })),
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

// Another window (the PWA plus a tab) saved a change: pick it up so this
// window's next write doesn't overwrite it with a stale level.
window.addEventListener('storage', (e) => {
  if (e.key === AUDIO_STORAGE_KEY) void useAudioStore.persist.rehydrate()
})
