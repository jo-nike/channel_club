import { create } from 'zustand'

interface ChannelState {
  currentChannel: string | null
  setCurrentChannel: (channel: string | null) => void
}

export const useChannelStore = create<ChannelState>((set) => ({
  currentChannel: null,
  setCurrentChannel: (channel) => set({ currentChannel: channel }),
}))
