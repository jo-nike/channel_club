import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { logger } from '@/lib/logger'
import { useChannelStore } from './channelStore'
import { useErsatztvStore } from './ersatztvStore'
import { useUIStore } from './uiStore'
import { fetchNowPlaying } from '@/services/api'
import type { UnifiedChannel, ErsatzTVChannel, EPGResponse } from '@/types'

// Constants
export const LIVE_CHANNEL_ID = 'live-channel-0'

interface TVState {
  // Selected channel (can be Channel 0 or ErsatzTV channel)
  selectedChannel: UnifiedChannel | null

  // Live channel EPG data (for Channel 0)
  liveEPG: EPGResponse | null
  liveEPGLoading: boolean

  // Actions
  selectChannel: (channel: UnifiedChannel) => void
  loadLiveEPG: () => Promise<void>

  // Helpers
  getUnifiedChannels: () => UnifiedChannel[]
  isLiveChannelActive: () => boolean
}

// Helper to convert ErsatzTVChannel to UnifiedChannel
function ersatzTVToUnified(channel: ErsatzTVChannel): UnifiedChannel {
  return {
    id: channel.id,
    name: channel.name,
    number: channel.number,
    streamUrl: channel.streamUrl,
    type: 'ersatztv',
    logoUrl: channel.logoUrl,
    group: channel.group,
  }
}

export const useTVStore = create<TVState>()(
  subscribeWithSelector((set, get) => ({
    selectedChannel: null,
    liveEPG: null,
    liveEPGLoading: false,

    selectChannel: (channel: UnifiedChannel) => {
      logger.debug('TVStore', `Selected channel: ${channel.name} (${channel.type})`)
      set({ selectedChannel: channel })

      // Save to UI store for persistence
      if (channel.type === 'ersatztv') {
        useUIStore.getState().setLastTVChannelId(channel.id)
      } else {
        // For live channel, save special marker
        useUIStore.getState().setLastTVChannelId(LIVE_CHANNEL_ID)
      }

      // If selecting live channel, load EPG
      if (channel.type === 'live') {
        get().loadLiveEPG()
      }
    },

    loadLiveEPG: async () => {
      const liveChannel = useChannelStore.getState().currentChannel
      if (!liveChannel?.guideId) {
        set({ liveEPG: null, liveEPGLoading: false })
        return
      }

      set({ liveEPGLoading: true })
      try {
        const epg = await fetchNowPlaying(liveChannel.guideId)
        set({ liveEPG: epg, liveEPGLoading: false })
      } catch {
        set({ liveEPG: null, liveEPGLoading: false })
      }
    },

    getUnifiedChannels: () => {
      const liveChannel = useChannelStore.getState().currentChannel
      const ersatzTVChannels = useErsatztvStore.getState().channels

      const unified: UnifiedChannel[] = []

      // Channel 0 (Live) - always present as a slot, even if no live channel selected
      unified.push({
        id: LIVE_CHANNEL_ID,
        name: liveChannel?.name || 'Live',
        number: 0,
        streamUrl: liveChannel?.streamUrl || '',
        type: 'live',
        guideId: liveChannel?.guideId,
        backendId: liveChannel?.id, // Real backend ID for highlight recording
      })

      // ErsatzTV channels (1+)
      ersatzTVChannels.forEach((ch) => {
        unified.push(ersatzTVToUnified(ch))
      })

      return unified
    },

    isLiveChannelActive: () => {
      const liveChannel = useChannelStore.getState().currentChannel
      return liveChannel !== null
    },
  }))
)

// Initialize selected channel on first load
export function initializeTVStore() {
  const { getUnifiedChannels, selectChannel } = useTVStore.getState()
  const lastChannelId = useUIStore.getState().lastTVChannelId

  // Wait for channels to be loaded
  const channels = getUnifiedChannels()
  if (channels.length === 0) return

  // Try to restore last channel
  if (lastChannelId) {
    const lastChannel = channels.find((ch) => ch.id === lastChannelId)
    if (lastChannel) {
      selectChannel(lastChannel)
      return
    }
  }

  // Default to first ErsatzTV channel (not Channel 0)
  const firstErsatzTV = channels.find((ch) => ch.type === 'ersatztv')
  if (firstErsatzTV) {
    selectChannel(firstErsatzTV)
  }
}

// Subscribe to live channel changes from WebSocket
let previousChannel = useChannelStore.getState().currentChannel
useChannelStore.subscribe((state) => {
  const currentChannel = state.currentChannel
  // Only react if the channel actually changed
  if (currentChannel !== previousChannel) {
    previousChannel = currentChannel
    const { selectedChannel, loadLiveEPG } = useTVStore.getState()

    // If currently viewing Channel 0, update the EPG
    if (selectedChannel?.type === 'live') {
      loadLiveEPG()
    }

    logger.debug('TVStore', `Live channel updated: ${currentChannel?.name || 'none'}`)
  }
})
