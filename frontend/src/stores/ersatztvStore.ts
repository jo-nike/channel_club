import { create } from 'zustand'
import { logger } from '@/lib/logger'
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
  loadAllProgrammes: (hours?: number, silent?: boolean) => Promise<void>
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

    logger.debug('Store', 'Loading ErsatzTV channels')
    set({ channelsLoading: true, error: null })
    try {
      const channels = await fetchErsatzTVChannels()
      logger.debug('Store', `Loaded ${channels.length} ErsatzTV channels`)
      set({ channels, channelsLoading: false })
    } catch (error) {
      logger.debug('Store', `Failed to load ErsatzTV channels: ${error}`)
      set({
        error:
          error instanceof Error ? error.message : 'Failed to load channels',
        channelsLoading: false,
      })
    }
  },

  selectChannel: (channel: ErsatzTVChannel) => {
    logger.debug('Store', `Selected ErsatzTV channel: ${channel.name}`)
    set({ selectedChannel: channel })
    // Optionally auto-load current programme
    get().loadCurrentProgramme(channel.id)
  },

  loadProgrammes: async (channelId: string, hours: number = 6) => {
    logger.debug('Store', `Loading programmes for channel: ${channelId}`)
    set({ programmesLoading: true, error: null })
    try {
      const data = await fetchErsatzTVProgrammes(channelId, hours)
      logger.debug('Store', `Loaded ${data.programmes.length} programmes`)
      set({ programmes: data.programmes, programmesLoading: false })
    } catch (error) {
      logger.debug('Store', `Failed to load programmes: ${error}`)
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
      logger.debug('Store', `Current programme: ${data.current?.title || 'none'}`)
      set({
        currentProgramme: data.current,
        nextProgramme: data.nextUp,
      })
    } catch {
      // Silent fail for current programme - not critical
      set({ currentProgramme: null, nextProgramme: null })
    }
  },

  loadAllProgrammes: async (hours: number = 6, silent: boolean = false) => {
    const state = get()
    // Prevent duplicate loads
    if (state.programmesLoading) return
    if (state.channels.length === 0) return

    logger.debug('Store', `Loading all programmes for ${state.channels.length} channels${silent ? ' (silent)' : ''}`)
    // Only show loading state on initial load, not silent refreshes
    if (!silent) {
      set({ programmesLoading: true })
    }

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
      logger.debug('Store', 'All programmes loaded')
      set({ programmesByChannel: programmeData, programmesLoading: false })
    } catch {
      set({ programmesLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
