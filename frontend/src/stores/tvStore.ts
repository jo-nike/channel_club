import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { logger } from '@/lib/logger'
import { useChannelStore } from './channelStore'
import { useErsatztvStore } from './ersatztvStore'
import { useUIStore } from './uiStore'
import { useChannelPrefsStore } from './channelPrefsStore'
import { useSettingsStore } from './settingsStore'
import { currentSources } from '@/hooks/useSources'
import { fetchLiveProgrammes, fetchNowPlaying } from '@/services/api'
import type { Channel, UnifiedChannel, ErsatzTVChannel, ErsatzTVProgramme, EPGResponse, Program } from '@/types'

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

// One empty schedule, so clearing an already empty one doesn't re-render its readers
const NO_PROGRAMMES: ErsatzTVProgramme[] = []

/**
 * A live guide programme in the shape the guide grid draws: an ErsatzTV
 * programme on the live slot, with an id from its start time.
 */
export function toLiveProgramme(programme: Program): ErsatzTVProgramme {
  return {
    id: `live-${programme.startTime}`,
    channelId: LIVE_CHANNEL_ID,
    title: programme.title,
    description: programme.description,
    start: programme.startTime,
    stop: programme.endTime,
  }
}

/** What to show for a live channel in place of a programme title. */
export function describeLiveGuide(status: LiveEPGStatus): string {
  if (status === 'unavailable') return 'Guide unavailable'
  if (status === 'idle' || status === 'loading') return 'Loading guide...'
  return 'No guide info'
}

interface TVState {
  // Selected channel (can be Channel 0 or ErsatzTV channel)
  selectedChannel: UnifiedChannel | null
  // The channel this viewer picked before the current one, for 'Back to' when
  // a stream stops. Only selectChannel writes it: live TV following a new
  // channel is the same pick, not a new one.
  previousChannelId: string | null

  // Live channel EPG data (for Channel 0)
  liveEPG: EPGResponse | null
  liveEPGLoading: boolean
  liveEPGStatus: LiveEPGStatus
  // Monotonic id used to discard out-of-order loadLiveEPG responses (internal)
  epgRequestId: number

  // The live channel's schedule (the guide's row 0), as grid programmes
  liveProgrammes: ErsatzTVProgramme[]
  // Monotonic id used to discard out-of-order loadLiveProgrammes responses (internal)
  programmesRequestId: number

  // The guide id the latest now-playing and schedule lookups were started
  // for, null for none (internal): loadLiveGuideOnce skips a channel
  // that's already been looked up
  epgLookupGuideId: string | null
  programmesLookupGuideId: string | null

  // Actions
  selectChannel: (channel: UnifiedChannel) => void
  loadLiveEPG: () => Promise<void>
  loadLiveProgrammes: () => Promise<void>
  // The first lookups for the live channel on air, each only if it hasn't
  // been looked up yet
  loadLiveGuideOnce: () => void

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
    // ErsatzTV plays through a stream session, so the channel has no URL of its own
    streamUrl: '',
    type: 'ersatztv',
    // Our logo route, which proxies wherever ErsatzTV's logo is, so every
    // UnifiedChannel.logoUrl is an /api/ path ChannelLogo can load
    logoUrl: channel.logoUrl ? `/api/ersatztv/logos/${channel.id}` : undefined,
    group: channel.group,
  }
}

/**
 * Channel 0 (the live slot, present even with nothing on live TV) followed by
 * the ErsatzTV channels. Without Dispatcharr there is no live slot: Live only
 * ever carries its channels. Pure, so a component can memoise the list on the
 * store values it's built from.
 */
export function buildUnifiedChannels(
  liveChannel: Channel | null,
  ersatzTVChannels: ErsatzTVChannel[],
  withLiveSlot: boolean
): UnifiedChannel[] {
  const unified: UnifiedChannel[] = []

  // Channel 0 (Live) - present as a slot even with nothing on, while Dispatcharr is set up
  if (withLiveSlot) unified.push({
    id: LIVE_CHANNEL_ID,
    name: liveChannel?.name || 'Live',
    number: 0,
    streamUrl: liveChannel?.streamUrl || '',
    type: 'live',
    guideId: liveChannel?.guideId,
    backendId: liveChannel?.id, // Real backend ID for highlight recording
    // The live channel's Dispatcharr logo, when it has one
    logoUrl: liveChannel?.logoUrl ?? undefined,
  })

  // ErsatzTV channels (1+)
  ersatzTVChannels.forEach((ch) => {
    unified.push(ersatzTVToUnified(ch))
  })

  return unified
}

export const useTVStore = create<TVState>()(
  subscribeWithSelector((set, get) => ({
    selectedChannel: null,
    previousChannelId: null,
    liveEPG: null,
    liveEPGLoading: false,
    liveEPGStatus: 'idle',
    epgRequestId: 0,
    liveProgrammes: NO_PROGRAMMES,
    programmesRequestId: 0,
    epgLookupGuideId: null,
    programmesLookupGuideId: null,

    selectChannel: (channel: UnifiedChannel) => {
      logger.debug('TVStore', `Selected channel: ${channel.name} (${channel.type})`)
      const current = get().selectedChannel
      set(
        current && current.id !== channel.id
          ? { selectedChannel: channel, previousChannelId: current.id }
          : { selectedChannel: channel }
      )

      // Save to UI store for persistence
      if (channel.type === 'ersatztv') {
        useUIStore.getState().setLastTVChannelId(channel.id)
        // The live slot isn't a recent: it's always the list's first row
        useChannelPrefsStore.getState().pushRecent(channel.id)
      } else {
        // For live channel, save special marker
        useUIStore.getState().setLastTVChannelId(LIVE_CHANNEL_ID)
      }

      // Tuning to the live slot looks its programme up if nothing has yet.
      // After that the live-switch subscription and the view's refresh keep
      // it current, so this doesn't send a second request for the same one.
      if (channel.type === 'live') {
        const guideId = useChannelStore.getState().currentChannel?.guideId || null
        if (get().epgLookupGuideId !== guideId) get().loadLiveEPG()
      }
    },

    loadLiveEPG: async () => {
      const liveChannel = useChannelStore.getState().currentChannel
      const requestId = get().epgRequestId + 1
      set({ epgRequestId: requestId, epgLookupGuideId: liveChannel?.guideId || null })

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

    loadLiveProgrammes: async () => {
      const liveChannel = useChannelStore.getState().currentChannel
      // Its own request id: the one-minute now-playing refreshes would
      // otherwise discard every schedule lookup in flight
      const requestId = get().programmesRequestId + 1
      set({ programmesRequestId: requestId, programmesLookupGuideId: liveChannel?.guideId || null })

      // Nothing on live TV, or a channel without a guide id: no schedule
      if (!liveChannel?.guideId) {
        set({ liveProgrammes: NO_PROGRAMMES })
        return
      }

      const guideId = liveChannel.guideId
      // Stale like a loadLiveEPG response: a newer lookup started, or the live
      // channel changed while this one was in flight
      const isStale = () =>
        get().programmesRequestId !== requestId ||
        useChannelStore.getState().currentChannel?.guideId !== guideId

      try {
        const { programmes } = await fetchLiveProgrammes(guideId, liveChannel.name)
        if (isStale()) return
        set({ liveProgrammes: programmes.length > 0 ? programmes.map(toLiveProgramme) : NO_PROGRAMMES })
      } catch {
        // Like the now-playing lookup, a failure clears the schedule rather
        // than leaving an old one up; liveEPGStatus says the guide is down
        if (isStale()) return
        set({ liveProgrammes: NO_PROGRAMMES })
      }
    },

    // The live-switch subscription below looks each new live channel up as
    // it arrives, which can be before the view that shows it mounts; this
    // covers a channel it didn't (the same channel coming back with a guide
    // id), without a second request for one it did
    loadLiveGuideOnce: () => {
      const guideId = useChannelStore.getState().currentChannel?.guideId
      if (!guideId) return
      const { epgLookupGuideId, programmesLookupGuideId, loadLiveEPG, loadLiveProgrammes } = get()
      if (epgLookupGuideId !== guideId) loadLiveEPG()
      if (programmesLookupGuideId !== guideId) loadLiveProgrammes()
    },

    getUnifiedChannels: () =>
      buildUnifiedChannels(
        useChannelStore.getState().currentChannel,
        useErsatztvStore.getState().channels,
        currentSources().dispatcharr
      ),

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
    const { selectedChannel, loadLiveEPG, loadLiveProgrammes } = useTVStore.getState()

    // If currently viewing Channel 0, follow it to the new channel
    if (selectedChannel?.type === 'live') {
      useTVStore.setState({ selectedChannel: useTVStore.getState().getUnifiedChannels()[0] })
    }

    if (liveChannelSwitched) {
      // A different channel is on live TV: drop the old one's programme now, so
      // row 0 never shows it under the new channel, and look the new one up
      // straight away, whichever channel this viewer is watching. The same
      // goes for its schedule.
      useTVStore.setState({ liveEPG: null, liveEPGStatus: 'loading', liveProgrammes: NO_PROGRAMMES })
      loadLiveEPG()
      loadLiveProgrammes()
    } else if (selectedChannel?.type === 'live' || !currentChannel) {
      // Same channel with new details, or live TV stopped (which drops its
      // guide state and any lookup in flight)
      loadLiveEPG()
      if (!currentChannel) loadLiveProgrammes()
    }

    logger.debug('TVStore', `Live channel updated: ${currentChannel?.name || 'none'}`)
  }
})

// A source switched off on the server: a viewer on one of its channels moves
// to what is left (an ErsatzTV channel, else the live slot), or to nothing.
// One switched back on gives a viewer with nothing to watch its channels.
// Neither is a pick of the viewer's, so the remembered channel stays.
let previousSources = currentSources()
useSettingsStore.subscribe(() => {
  const sources = currentSources()
  if (sources === previousSources) return
  const before = previousSources
  previousSources = sources
  const { selectedChannel, getUnifiedChannels } = useTVStore.getState()
  if (!selectedChannel) {
    const switchedOn = (sources.dispatcharr && !before.dispatcharr) || (sources.ersatztv && !before.ersatztv)
    const first = switchedOn ? getUnifiedChannels()[0] : undefined
    if (first) useTVStore.setState({ selectedChannel: first })
    return
  }
  const gone =
    (selectedChannel.type === 'live' && !sources.dispatcharr) ||
    (selectedChannel.type === 'ersatztv' && !sources.ersatztv)
  if (!gone) return
  // The ErsatzTV list empties after this runs, so its channels only count while it's on
  const channels = getUnifiedChannels().filter((channel) => channel.type === 'live' || sources.ersatztv)
  const next = channels.find((channel) => channel.type === 'ersatztv') ?? channels[0] ?? null
  logger.debug('TVStore', `Channel source switched off: moving to ${next?.name ?? 'nothing'}`)
  useTVStore.setState({ selectedChannel: next })
})
