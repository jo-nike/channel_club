import { create } from 'zustand'
import { logger } from '@/lib/logger'
import type { Channel } from '@/types'

/** The most recent change to the live channel (channel 0), as announced by the server. */
export interface LiveChannelChange {
  /** Username of whoever made the change; null for system changes or older servers */
  by: string | null
  /** When this client received the change (ms since epoch) */
  at: number
  /** The new live channel's name; null when live TV was stopped */
  channelName: string | null
}

/**
 * How a live change reads everywhere it is told (the toast, the info rail,
 * the TV channel banner): 'jon put on TSN 5', 'Live channel set to TSN 5'
 * when nobody is named, and 'jon stopped live TV' for a stop.
 */
export function describeLiveChange(channelName: string | null, by: string | null): string {
  if (channelName) return by ? `${by} put on ${channelName}` : `Live channel set to ${channelName}`
  return by ? `${by} stopped live TV` : 'Live TV stopped'
}

interface ChannelState {
  channels: Channel[]
  currentChannel: Channel | null
  lastChange: LiveChannelChange | null
  isLoading: boolean
  error: string | null
  setChannels: (channels: Channel[]) => void
  setCurrentChannel: (channel: Channel | null) => void
  setLastChange: (change: LiveChannelChange | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  currentChannel: null,
  lastChange: null,
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
  setLastChange: (lastChange) => set({ lastChange }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => {
    if (error) {
      logger.debug('Store', `Channel error: ${error}`)
    }
    set({ error, isLoading: false })
  },
}))
