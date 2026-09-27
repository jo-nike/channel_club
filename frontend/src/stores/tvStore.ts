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

/**
 * What the live channel's guide lookup came back with:
 * - idle: nothing on live TV
 * - loading: the first lookup for the live channel hasn't answered yet
 * - ok: there's a current programme
 * - empty: the guide answered but has nothing on now for this channel
 * - unavailable: the guide couldn't be reached (e.g. the server's 503)
 */
export type LiveEPGStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'unavailable'

/** What to show for a live channel in place of a programme title. */
export function describeLiveGuide(status: LiveEPGStatus): string {
  if (status === 'unavailable') return 'Guide unavailable'
  if (status === 'idle' || status === 'loading') return 'Loading guide...'
  return 'No guide info'
}

interface TVState {
  // Selected channel (can be Channel 0 or ErsatzTV channel)
  selectedChannel: UnifiedChannel | null

  // Live channel EPG data (for Channel 0)
  liveEPG: EPGResponse | null
  liveEPGLoading: boolean
  liveEPGStatus: LiveEPGStatus
  // Monotonic id used to discard out-of-order loadLiveEPG responses (internal)
  epgRequestId: number

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
    liveEPGStatus: 'idle',
    epgRequestId: 0,

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
      const requestId = get().epgRequestId + 1
      set({ epgRequestId: requestId })

      if (!liveChannel) {
        set({ liveEPG: null, liveEPGLoading: false, liveEPGStatus: 'idle' })
        return
      }
      // A live channel without a guide id can't have guide data
      if (!liveChannel.guideId) {
        set({ liveEPG: null, liveEPGLoading: false, liveEPGStatus: 'empty' })
        return
      }

      const guideId = liveChannel.guideId
      // Periodic refreshes keep the last answer on screen rather than flashing
      // back to loading
      set(get().liveEPGStatus === 'idle' ? { liveEPGLoading: true, liveEPGStatus: 'loading' } : { liveEPGLoading: true })

      // A response is stale if a newer loadLiveEPG has started (epgRequestId
      // moved on, which also orders two in-flight requests for the same guideId)
      // or the live channel changed while this request was in flight.
      const isStale = () =>
        get().epgRequestId !== requestId ||
        useChannelStore.getState().currentChannel?.guideId !== guideId

      try {
        const epg = await fetchNowPlaying(guideId, liveChannel.name)
        if (isStale()) {
          // Don't clobber fresher EPG. Only clear the loading flag if no newer
          // request owns it, otherwise that request clears it when it lands.
          if (get().epgRequestId === requestId) set({ liveEPGLoading: false })
          return
        }
        set({ liveEPG: epg, liveEPGLoading: false, liveEPGStatus: epg.currentProgram ? 'ok' : 'empty' })
      } catch {
        if (isStale()) {
          if (get().epgRequestId === requestId) set({ liveEPGLoading: false })
          return
        }
        set({ liveEPG: null, liveEPGLoading: false, liveEPGStatus: 'unavailable' })
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
  } else {
    selectChannel(channels[0])
  }
}

// Subscribe to live channel changes from WebSocket
let previousChannel = useChannelStore.getState().currentChannel
useChannelStore.subscribe((state) => {
  const currentChannel = state.currentChannel
  // Only react if the channel actually changed
  if (currentChannel !== previousChannel) {
    const liveChannelSwitched = !!currentChannel && currentChannel.id !== previousChannel?.id
    previousChannel = currentChannel
    const { selectedChannel, loadLiveEPG } = useTVStore.getState()

    // If currently viewing Channel 0, follow it to the new channel
    if (selectedChannel?.type === 'live') {
      useTVStore.setState({ selectedChannel: useTVStore.getState().getUnifiedChannels()[0] })
    }

    if (liveChannelSwitched) {
      // A different channel is on live TV: drop the old one's programme now, so
      // row 0 never shows it under the new channel, and look the new one up
      // straight away, whichever channel this viewer is watching
      useTVStore.setState({ liveEPG: null, liveEPGStatus: 'loading' })
      loadLiveEPG()
    } else if (selectedChannel?.type === 'live' || !currentChannel) {
      // Same channel with new details, or live TV stopped (which drops its
      // guide state and any lookup in flight)
      loadLiveEPG()
    }

    logger.debug('TVStore', `Live channel updated: ${currentChannel?.name || 'none'}`)
  }
})
