import { create } from 'zustand'
import type { ErsatzTVChannel, ErsatzTVProgramme } from '@/types'
import {
  fetchErsatzTVChannels,
  fetchErsatzTVProgrammes,
  fetchErsatzTVCurrentProgramme,
} from '@/services/ersatztvApi'

interface ErsatztvState {
  // State
  channels: ErsatzTVChannel[]
  selectedChannel: ErsatzTVChannel | null
  programmes: ErsatzTVProgramme[]
  currentProgramme: ErsatzTVProgramme | null
  nextProgramme: ErsatzTVProgramme | null
  loading: boolean
  error: string | null

  // Actions
  loadChannels: () => Promise<void>
  selectChannel: (channel: ErsatzTVChannel) => void
  loadProgrammes: (channelId: string, hours?: number) => Promise<void>
  loadCurrentProgramme: (channelId: string) => Promise<void>
  clearError: () => void
}

export const useErsatztvStore = create<ErsatztvState>((set, get) => ({
  // Initial state
  channels: [],
  selectedChannel: null,
  programmes: [],
  currentProgramme: null,
  nextProgramme: null,
  loading: false,
  error: null,

  // Actions
  loadChannels: async () => {
    set({ loading: true, error: null })
    try {
      const channels = await fetchErsatzTVChannels()
      set({ channels, loading: false })
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to load channels',
        loading: false,
      })
    }
  },

  selectChannel: (channel: ErsatzTVChannel) => {
    set({ selectedChannel: channel })
    // Optionally auto-load current programme
    get().loadCurrentProgramme(channel.id)
  },

  loadProgrammes: async (channelId: string, hours: number = 6) => {
    set({ loading: true, error: null })
    try {
      const data = await fetchErsatzTVProgrammes(channelId, hours)
      set({ programmes: data.programmes, loading: false })
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to load programmes',
        loading: false,
      })
    }
  },

  loadCurrentProgramme: async (channelId: string) => {
    try {
      const data = await fetchErsatzTVCurrentProgramme(channelId)
      set({
        currentProgramme: data.current,
        nextProgramme: data.nextUp,
      })
    } catch {
      // Silent fail for current programme - not critical
      set({ currentProgramme: null, nextProgramme: null })
    }
  },

  clearError: () => set({ error: null }),
}))
