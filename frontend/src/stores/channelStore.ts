import { create } from 'zustand'
import { logger } from '@/lib/logger'
import { fetchCurrentChannel } from '@/services/api'
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
  // The server has said what's on live TV (over the socket or GET
  // /channels/current); until then a null currentChannel means unknown
  liveKnown: boolean
  // Counts socket updates, so a REST answer that one overtook is dropped (internal)
  liveVersion: number
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
  liveKnown: false,
  liveVersion: 0,
  lastChange: null,
  isLoading: false,
  error: null,
  setChannels: (channels) => {
    logger.debug('Store', `Setting ${channels.length} channels`)
    set({ channels, error: null })
  },
  setCurrentChannel: (currentChannel) => {
    logger.debug('Store', `Current channel: ${currentChannel?.name || 'null'}`)
    set((state) => ({ currentChannel, liveKnown: true, liveVersion: state.liveVersion + 1 }))
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

/**
 * The live channel from GET /channels/current, for when the socket hasn't
 * told us (it hasn't connected yet, or is stuck connecting). A socket update
 * that arrives while this is in flight is newer, so it wins.
 */
export async function loadCurrentChannel(): Promise<void> {
  const version = useChannelStore.getState().liveVersion
  try {
    const currentChannel = await fetchCurrentChannel()
    if (useChannelStore.getState().liveVersion !== version) return
    logger.debug('Store', `Current channel from the server: ${currentChannel?.name || 'null'}`)
    useChannelStore.setState({ currentChannel, liveKnown: true })
  } catch (error) {
    // The socket may still deliver it
    logger.warn('Store', 'Could not load the current channel', error)
  }
}
