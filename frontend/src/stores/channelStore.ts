import { create } from 'zustand'
import { logger } from '@/lib/logger'
import type { Channel } from '@/types'

interface ChannelState {
  channels: Channel[]
  currentChannel: Channel | null
  isLoading: boolean
  error: string | null
  setChannels: (channels: Channel[]) => void
  setCurrentChannel: (channel: Channel | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  currentChannel: null,
  isLoading: false,
  error: null,
  setChannels: (channels) => {
    logger.debug('Store', `Setting ${channels.length} channels`)
    set({ channels, error: null })
  },
  setCurrentChannel: (currentChannel) => {
    logger.debug('Store', `Current channel: ${currentChannel?.name || 'null'}`)
    set({ currentChannel })
  },
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => {
    if (error) {
      logger.debug('Store', `Channel error: ${error}`)
    }
    set({ error, isLoading: false })
  },
}))
