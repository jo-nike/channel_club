import { create } from 'zustand'
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
  setChannels: (channels) => set({ channels, error: null }),
  setCurrentChannel: (currentChannel) => set({ currentChannel }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error, isLoading: false }),
}))
