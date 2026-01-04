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

  // EPG grid data (all channels' programmes)
  programmesByChannel: Record<string, ErsatzTVProgramme[]>

  // Granular loading states
  channelsLoading: boolean
  programmesLoading: boolean

  // Legacy loading getter for backward compatibility
  loading: boolean

  error: string | null

  // Actions
  loadChannels: () => Promise<void>
  selectChannel: (channel: ErsatzTVChannel) => void
  loadProgrammes: (channelId: string, hours?: number) => Promise<void>
  loadCurrentProgramme: (channelId: string) => Promise<void>
  loadAllProgrammes: (hours?: number) => Promise<void>
  clearError: () => void
}

export const useErsatztvStore = create<ErsatztvState>((set, get) => ({
  // Initial state
  channels: [],
  selectedChannel: null,
  programmes: [],
  currentProgramme: null,
  nextProgramme: null,
  programmesByChannel: {},
  channelsLoading: false,
  programmesLoading: false,

  // Computed loading state for backward compatibility
  get loading() {
    const state = get()
    return state.channelsLoading || state.programmesLoading
  },

  error: null,

  // Actions
  loadChannels: async () => {
    const state = get()
    // Prevent duplicate loads
    if (state.channelsLoading) return
    if (state.channels.length > 0) return // Already loaded

    set({ channelsLoading: true, error: null })
    try {
      const channels = await fetchErsatzTVChannels()
      set({ channels, channelsLoading: false })
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to load channels',
        channelsLoading: false,
      })
    }
  },

  selectChannel: (channel: ErsatzTVChannel) => {
    set({ selectedChannel: channel })
    // Optionally auto-load current programme
    get().loadCurrentProgramme(channel.id)
  },

  loadProgrammes: async (channelId: string, hours: number = 6) => {
    set({ programmesLoading: true, error: null })
    try {
      const data = await fetchErsatzTVProgrammes(channelId, hours)
      set({ programmes: data.programmes, programmesLoading: false })
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to load programmes',
        programmesLoading: false,
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

  loadAllProgrammes: async (hours: number = 6) => {
    const state = get()
    // Prevent duplicate loads
    if (state.programmesLoading) return
    if (state.channels.length === 0) return

    set({ programmesLoading: true })

    try {
      const programmeData: Record<string, ErsatzTVProgramme[]> = {}
      await Promise.all(
        state.channels.map(async (channel) => {
          try {
            const data = await fetchErsatzTVProgrammes(channel.id, hours)
            programmeData[channel.id] = data.programmes
          } catch {
            programmeData[channel.id] = []
          }
        })
      )
      set({ programmesByChannel: programmeData, programmesLoading: false })
    } catch {
      set({ programmesLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
