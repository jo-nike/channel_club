import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useTVStore, LIVE_CHANNEL_ID, buildUnifiedChannels } from './tvStore'
import { useChannelStore } from './channelStore'
import { useChannelPrefsStore } from './channelPrefsStore'
import { useErsatztvStore } from './ersatztvStore'
import { useSettingsStore } from './settingsStore'
import { useUIStore } from './uiStore'
import { fetchLiveProgrammes, fetchNowPlaying } from '@/services/api'
import type { Channel, EPGProgrammesResponse, EPGResponse, UnifiedChannel } from '@/types'

vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn(), fetchLiveProgrammes: vi.fn() }))

const tsn: Channel = { id: '28', name: 'CA-S: TSN 5', streamUrl: 'http://x/28', guideId: '5' }
const onNow: EPGResponse = {
  channelId: '5',
  currentProgram: { title: 'Hockey Night', startTime: '2026-09-26T23:00:00Z', endTime: '2026-09-27T02:00:00Z' },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const status = () => useTVStore.getState().liveEPGStatus

describe('tvStore live guide status', () => {
  beforeEach(() => {
    // Put the channel on first: switching live TV starts a lookup, which the
    // reset below then discards (a newer request id makes it stale)
    useChannelStore.setState({ currentChannel: tsn })
    vi.mocked(fetchNowPlaying).mockReset()
    vi.mocked(fetchLiveProgrammes).mockReset()
    vi.mocked(fetchLiveProgrammes).mockResolvedValue({ channelId: '5', programmes: [] })
    useTVStore.setState({
      selectedChannel: null,
      liveEPG: null,
      liveEPGLoading: false,
      liveEPGStatus: 'idle',
      epgRequestId: useTVStore.getState().epgRequestId + 1,
    })
  })

  it('looks the programme up by guide id and sends the channel name for the fallback', async () => {
    vi.mocked(fetchNowPlaying).mockResolvedValue(onNow)

    await useTVStore.getState().loadLiveEPG()

    expect(fetchNowPlaying).toHaveBeenCalledWith('5', 'CA-S: TSN 5')
  })

  it("is 'ok' with the programme when something is on now", async () => {
    vi.mocked(fetchNowPlaying).mockResolvedValue(onNow)

    await useTVStore.getState().loadLiveEPG()

    expect(status()).toBe('ok')
    expect(useTVStore.getState().liveEPG).toEqual(onNow)
  })

  it("is 'empty' when the guide answers with nothing on now", async () => {
    vi.mocked(fetchNowPlaying).mockResolvedValue({ channelId: '5', currentProgram: null })

    await useTVStore.getState().loadLiveEPG()

    expect(status()).toBe('empty')
  })

  it("is 'unavailable', not 'empty', when the lookup fails", async () => {
    vi.mocked(fetchNowPlaying).mockRejectedValue(new Error('Failed to fetch EPG'))

    await useTVStore.getState().loadLiveEPG()

    expect(status()).toBe('unavailable')
    expect(useTVStore.getState().liveEPG).toBeNull()
    expect(useTVStore.getState().liveEPGLoading).toBe(false)
  })

  it("is 'loading' until the first lookup answers", async () => {
    const pending = deferred<EPGResponse>()
    vi.mocked(fetchNowPlaying).mockReturnValue(pending.promise)

    const load = useTVStore.getState().loadLiveEPG()
    expect(status()).toBe('loading')

    pending.resolve(onNow)
    await load
    expect(status()).toBe('ok')
  })

  it('keeps the last answer while a refresh is in flight', async () => {
    vi.mocked(fetchNowPlaying).mockRejectedValueOnce(new Error('Failed to fetch EPG'))
    await useTVStore.getState().loadLiveEPG()

    const pending = deferred<EPGResponse>()
    vi.mocked(fetchNowPlaying).mockReturnValue(pending.promise)
    const refresh = useTVStore.getState().loadLiveEPG()
    expect(status()).toBe('unavailable')

    pending.resolve(onNow)
    await refresh
    expect(status()).toBe('ok')
  })

  it('ignores a failure that lands after a newer lookup answered', async () => {
    const slow = deferred<EPGResponse>()
    vi.mocked(fetchNowPlaying).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(onNow)

    const first = useTVStore.getState().loadLiveEPG()
    await useTVStore.getState().loadLiveEPG()
    slow.reject(new Error('Failed to fetch EPG'))
    await first

    expect(status()).toBe('ok')
    expect(useTVStore.getState().liveEPG).toEqual(onNow)
  })

  it("is 'empty' for a live channel without a guide id, without a lookup", async () => {
    useChannelStore.setState({ currentChannel: { ...tsn, guideId: '' } })

    await useTVStore.getState().loadLiveEPG()

    expect(fetchNowPlaying).not.toHaveBeenCalled()
    expect(status()).toBe('empty')
  })

  it("goes back to 'idle' when live TV stops, even while watching another channel", async () => {
    vi.mocked(fetchNowPlaying).mockResolvedValue(onNow)
    await useTVStore.getState().loadLiveEPG()
    expect(status()).toBe('ok')

    useChannelStore.getState().setCurrentChannel(null)

    expect(status()).toBe('idle')
    expect(useTVStore.getState().liveEPG).toBeNull()
  })

  describe('when the live channel switches', () => {
    const sportsnet: Channel = { id: '31', name: 'CA-S: Sportsnet ONE', streamUrl: 'http://x/31', guideId: '9' }
    const onSportsnet: EPGResponse = {
      channelId: '9',
      currentProgram: { title: 'Blue Jays Baseball', startTime: '2026-09-26T23:00:00Z', endTime: '2026-09-27T02:00:00Z' },
    }

    beforeEach(async () => {
      vi.mocked(fetchNowPlaying).mockResolvedValue(onNow)
      await useTVStore.getState().loadLiveEPG()
      expect(useTVStore.getState().liveEPG).toEqual(onNow)
      vi.mocked(fetchNowPlaying).mockClear()
    })

    it("drops the old programme at once and looks the new one up, even while watching another channel", async () => {
      const pending = deferred<EPGResponse>()
      vi.mocked(fetchNowPlaying).mockReturnValue(pending.promise)

      useChannelStore.getState().setCurrentChannel(sportsnet)

      // Nothing of TSN's is left to show under Sportsnet while the lookup runs
      expect(useTVStore.getState().liveEPG).toBeNull()
      expect(status()).toBe('loading')
      expect(fetchNowPlaying).toHaveBeenCalledTimes(1)
      expect(fetchNowPlaying).toHaveBeenCalledWith('9', 'CA-S: Sportsnet ONE')

      pending.resolve(onSportsnet)
      await vi.waitFor(() => expect(status()).toBe('ok'))
      expect(useTVStore.getState().liveEPG).toEqual(onSportsnet)
    })

    it('does the same while watching the live slot, which follows the new channel', async () => {
      useTVStore.setState({ selectedChannel: useTVStore.getState().getUnifiedChannels()[0] })
      const pending = deferred<EPGResponse>()
      vi.mocked(fetchNowPlaying).mockReturnValue(pending.promise)

      useChannelStore.getState().setCurrentChannel(sportsnet)

      expect(useTVStore.getState().selectedChannel).toMatchObject({ id: LIVE_CHANNEL_ID, name: 'CA-S: Sportsnet ONE' })
      expect(useTVStore.getState().liveEPG).toBeNull()
      expect(status()).toBe('loading')
      expect(fetchNowPlaying).toHaveBeenCalledTimes(1)

      pending.resolve(onSportsnet)
      await vi.waitFor(() => expect(status()).toBe('ok'))
      expect(useTVStore.getState().liveEPG).toEqual(onSportsnet)
    })

    it("ignores the old channel's answer if it lands after the switch", async () => {
      const slowTSN = deferred<EPGResponse>()
      const sportsnetLookup = deferred<EPGResponse>()
      vi.mocked(fetchNowPlaying).mockReturnValueOnce(slowTSN.promise).mockReturnValueOnce(sportsnetLookup.promise)
      const tsnRefresh = useTVStore.getState().loadLiveEPG()

      useChannelStore.getState().setCurrentChannel(sportsnet)
      slowTSN.resolve(onNow)
      await tsnRefresh

      expect(useTVStore.getState().liveEPG).toBeNull()
      expect(status()).toBe('loading')

      sportsnetLookup.resolve(onSportsnet)
      await vi.waitFor(() => expect(status()).toBe('ok'))
      expect(useTVStore.getState().liveEPG).toEqual(onSportsnet)
    })

    it('keeps the programme when the same channel comes through again with new details', () => {
      useChannelStore.getState().setCurrentChannel({ ...tsn, streamUrl: 'http://x/28?v=2' })

      expect(useTVStore.getState().liveEPG).toEqual(onNow)
      expect(status()).toBe('ok')
      expect(fetchNowPlaying).not.toHaveBeenCalled()
    })
  })
})

describe('tvStore live schedule', () => {
  const schedule: EPGProgrammesResponse = {
    channelId: '5',
    programmes: [
      { title: 'Pre-game', startTime: '2026-09-26T22:30:00Z', endTime: '2026-09-26T23:00:00Z' },
      { title: 'Hockey Night', startTime: '2026-09-26T23:00:00Z', endTime: '2026-09-27T02:00:00Z', description: 'Leafs at Habs' },
      { title: 'After Hours', startTime: '2026-09-27T02:00:00Z', endTime: '2026-09-27T03:00:00Z' },
    ],
  }
  const sportsnet: Channel = { id: '31', name: 'CA-S: Sportsnet ONE', streamUrl: 'http://x/31', guideId: '9' }
  const sportsnetSchedule: EPGProgrammesResponse = {
    channelId: '9',
    programmes: [{ title: 'Blue Jays Baseball', startTime: '2026-09-26T23:00:00Z', endTime: '2026-09-27T02:00:00Z' }],
  }
  const titles = () => useTVStore.getState().liveProgrammes.map((p) => p.title)

  beforeEach(() => {
    useChannelStore.setState({ currentChannel: tsn })
    vi.mocked(fetchNowPlaying).mockReset()
    vi.mocked(fetchNowPlaying).mockResolvedValue(onNow)
    vi.mocked(fetchLiveProgrammes).mockReset()
    useTVStore.setState({
      selectedChannel: null,
      liveProgrammes: [],
      programmesRequestId: useTVStore.getState().programmesRequestId + 1,
    })
  })

  it('loads the schedule by guide id with the channel name, as grid programmes on the live slot', async () => {
    vi.mocked(fetchLiveProgrammes).mockResolvedValue(schedule)

    await useTVStore.getState().loadLiveProgrammes()

    expect(fetchLiveProgrammes).toHaveBeenCalledWith('5', 'CA-S: TSN 5')
    expect(useTVStore.getState().liveProgrammes).toEqual([
      { id: 'live-2026-09-26T22:30:00Z', channelId: LIVE_CHANNEL_ID, title: 'Pre-game', description: undefined, start: '2026-09-26T22:30:00Z', stop: '2026-09-26T23:00:00Z' },
      { id: 'live-2026-09-26T23:00:00Z', channelId: LIVE_CHANNEL_ID, title: 'Hockey Night', description: 'Leafs at Habs', start: '2026-09-26T23:00:00Z', stop: '2026-09-27T02:00:00Z' },
      { id: 'live-2026-09-27T02:00:00Z', channelId: LIVE_CHANNEL_ID, title: 'After Hours', description: undefined, start: '2026-09-27T02:00:00Z', stop: '2026-09-27T03:00:00Z' },
    ])
  })

  it('ignores an older lookup that lands after a newer one answered', async () => {
    const slow = deferred<EPGProgrammesResponse>()
    vi.mocked(fetchLiveProgrammes)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(schedule)

    const first = useTVStore.getState().loadLiveProgrammes()
    await useTVStore.getState().loadLiveProgrammes()
    slow.resolve({ channelId: '5', programmes: [schedule.programmes[0]] })
    await first

    expect(titles()).toEqual(['Pre-game', 'Hockey Night', 'After Hours'])
  })

  it('ignores a failure that lands after a newer lookup answered', async () => {
    const slow = deferred<EPGProgrammesResponse>()
    vi.mocked(fetchLiveProgrammes).mockReturnValueOnce(slow.promise).mockResolvedValueOnce(schedule)

    const first = useTVStore.getState().loadLiveProgrammes()
    await useTVStore.getState().loadLiveProgrammes()
    slow.reject(new Error('Failed to fetch programmes'))
    await first

    expect(titles()).toEqual(['Pre-game', 'Hockey Night', 'After Hours'])
  })

  it('clears the schedule when the lookup fails', async () => {
    vi.mocked(fetchLiveProgrammes).mockResolvedValueOnce(schedule)
    await useTVStore.getState().loadLiveProgrammes()
    vi.mocked(fetchLiveProgrammes).mockRejectedValueOnce(new Error('Failed to fetch programmes'))

    await useTVStore.getState().loadLiveProgrammes()

    expect(useTVStore.getState().liveProgrammes).toEqual([])
  })

  it('has no schedule, without a lookup, for a live channel without a guide id', async () => {
    useChannelStore.setState({ currentChannel: { ...tsn, guideId: '' } })

    await useTVStore.getState().loadLiveProgrammes()

    expect(fetchLiveProgrammes).not.toHaveBeenCalled()
    expect(useTVStore.getState().liveProgrammes).toEqual([])
  })

  it("drops the old channel's schedule at once when live TV switches and loads the new one", async () => {
    vi.mocked(fetchLiveProgrammes).mockResolvedValueOnce(schedule)
    await useTVStore.getState().loadLiveProgrammes()
    const pending = deferred<EPGProgrammesResponse>()
    vi.mocked(fetchLiveProgrammes).mockReturnValue(pending.promise)

    useChannelStore.getState().setCurrentChannel(sportsnet)

    expect(useTVStore.getState().liveProgrammes).toEqual([])
    expect(fetchLiveProgrammes).toHaveBeenLastCalledWith('9', 'CA-S: Sportsnet ONE')

    pending.resolve(sportsnetSchedule)
    await vi.waitFor(() => expect(titles()).toEqual(['Blue Jays Baseball']))
  })

  it("ignores the old channel's schedule if it lands after the switch", async () => {
    const slowTSN = deferred<EPGProgrammesResponse>()
    const sportsnetLookup = deferred<EPGProgrammesResponse>()
    vi.mocked(fetchLiveProgrammes)
      .mockReturnValueOnce(slowTSN.promise)
      .mockReturnValueOnce(sportsnetLookup.promise)
    const tsnLookup = useTVStore.getState().loadLiveProgrammes()

    useChannelStore.getState().setCurrentChannel(sportsnet)
    slowTSN.resolve(schedule)
    await tsnLookup
    expect(useTVStore.getState().liveProgrammes).toEqual([])

    sportsnetLookup.resolve(sportsnetSchedule)
    await vi.waitFor(() => expect(titles()).toEqual(['Blue Jays Baseball']))
  })

  it('drops the schedule when live TV stops', async () => {
    vi.mocked(fetchLiveProgrammes).mockResolvedValueOnce(schedule)
    await useTVStore.getState().loadLiveProgrammes()

    useChannelStore.getState().setCurrentChannel(null)

    expect(useTVStore.getState().liveProgrammes).toEqual([])
  })

  it('keeps the schedule, without a lookup, when the same channel comes through with new details', async () => {
    vi.mocked(fetchLiveProgrammes).mockResolvedValueOnce(schedule)
    await useTVStore.getState().loadLiveProgrammes()
    vi.mocked(fetchLiveProgrammes).mockClear()

    useChannelStore.getState().setCurrentChannel({ ...tsn, streamUrl: 'http://x/28?v=2' })

    expect(titles()).toEqual(['Pre-game', 'Hockey Night', 'After Hours'])
    expect(fetchLiveProgrammes).not.toHaveBeenCalled()
  })
})

describe('tvStore previous channel', () => {
  const cartoons: UnifiedChannel = { id: 'e2', name: 'Cartoons', number: 2, streamUrl: '/e2', type: 'ersatztv' }
  const movies: UnifiedChannel = { id: 'e3', name: 'Movies', number: 3, streamUrl: '/e3', type: 'ersatztv' }
  const sportsnet: Channel = { id: '31', name: 'CA-S: Sportsnet ONE', streamUrl: 'http://x/31', guideId: '9' }

  beforeEach(() => {
    vi.mocked(fetchNowPlaying).mockReset().mockResolvedValue(onNow)
    vi.mocked(fetchLiveProgrammes).mockReset().mockResolvedValue({ channelId: '5', programmes: [] })
    useChannelStore.setState({ currentChannel: tsn })
    useTVStore.setState({ selectedChannel: null, previousChannelId: null })
  })

  it('has none until the viewer picks a second channel', () => {
    useTVStore.getState().selectChannel(cartoons)
    expect(useTVStore.getState().previousChannelId).toBeNull()

    useTVStore.getState().selectChannel(movies)
    expect(useTVStore.getState().previousChannelId).toBe('e2')

    useTVStore.getState().selectChannel(useTVStore.getState().getUnifiedChannels()[0])
    expect(useTVStore.getState().previousChannelId).toBe('e3')
  })

  it('keeps it when the same channel is picked again', () => {
    useTVStore.getState().selectChannel(cartoons)
    useTVStore.getState().selectChannel(movies)

    useTVStore.getState().selectChannel({ ...movies, name: 'Movies HD' })

    expect(useTVStore.getState().previousChannelId).toBe('e2')
  })

  it('keeps it when live TV changes under a viewer on the live slot', () => {
    useTVStore.getState().selectChannel(cartoons)
    useTVStore.getState().selectChannel(useTVStore.getState().getUnifiedChannels()[0])

    useChannelStore.getState().setCurrentChannel(sportsnet)

    expect(useTVStore.getState().selectedChannel).toMatchObject({ id: LIVE_CHANNEL_ID, name: 'CA-S: Sportsnet ONE' })
    expect(useTVStore.getState().previousChannelId).toBe('e2')
  })
})

describe('tvStore recent channels', () => {
  const cartoons: UnifiedChannel = { id: 'e2', name: 'Cartoons', number: 2, streamUrl: '/e2', type: 'ersatztv' }
  const movies: UnifiedChannel = { id: 'e3', name: 'Movies', number: 3, streamUrl: '/e3', type: 'ersatztv' }
  const recents = () => useChannelPrefsStore.getState().recentChannelIds

  beforeEach(() => {
    vi.mocked(fetchNowPlaying).mockReset().mockResolvedValue(onNow)
    vi.mocked(fetchLiveProgrammes).mockReset().mockResolvedValue({ channelId: '5', programmes: [] })
    useChannelStore.setState({ currentChannel: tsn })
    useTVStore.setState({ selectedChannel: null, previousChannelId: null })
    useChannelPrefsStore.setState({ recentChannelIds: [] })
  })

  it('records each channel picked, most recent first', () => {
    useTVStore.getState().selectChannel(cartoons)
    useTVStore.getState().selectChannel(movies)
    useTVStore.getState().selectChannel(cartoons)

    expect(recents()).toEqual(['e2', 'e3'])
  })

  it("doesn't record the live slot, which is always the first row", () => {
    useTVStore.getState().selectChannel(cartoons)
    useTVStore.getState().selectChannel(useTVStore.getState().getUnifiedChannels()[0])

    expect(recents()).toEqual(['e2'])
  })
})

describe('buildUnifiedChannels without Dispatcharr', () => {
  it('has no live slot: channel 0 is gone, the ErsatzTV channels are all there is', () => {
    const channels = buildUnifiedChannels(null, [{ id: 'etv1', name: 'Movies', number: 1, streamUrl: '/e1', logoUrl: '', group: '' }], false)

    expect(channels.map((channel) => channel.id)).toEqual(['etv1'])
  })
})

describe('tvStore when a source is switched off', () => {
  const movies = { id: 'etv1', name: 'Movies', number: 1, streamUrl: '/e1', logoUrl: '', group: '' }
  const sources = (dispatcharr: boolean, ersatztv: boolean) =>
    useSettingsStore.setState({ serverFeatures: { chat: false, gif: false, nhl: false, sources: { dispatcharr, ersatztv } } })

  beforeEach(() => {
    useChannelStore.setState({ currentChannel: { id: 'a', name: 'A', streamUrl: 'http://a', guideId: 'a' } })
    useErsatztvStore.setState({ channels: [movies] })
    sources(true, true)
  })

  afterEach(() => {
    useSettingsStore.setState({ serverFeatures: null })
    useErsatztvStore.setState({ channels: [] })
    useTVStore.setState({ selectedChannel: null, previousChannelId: null, epgLookupGuideId: null, programmesLookupGuideId: null })
  })

  it("moves a viewer on an ErsatzTV channel to Live, not to the channel that's going", () => {
    useTVStore.getState().selectChannel(useTVStore.getState().getUnifiedChannels()[1])

    sources(true, false)

    expect(useTVStore.getState().selectedChannel?.id).toBe(LIVE_CHANNEL_ID)
  })

  it('gives a viewer with nothing to watch the live slot when Dispatcharr comes back, keeping their remembered channel', () => {
    useUIStore.setState({ lastTVChannelId: 'etv9' })
    sources(false, false)
    useTVStore.setState({ selectedChannel: null })

    sources(true, false)

    expect(useTVStore.getState().selectedChannel?.id).toBe(LIVE_CHANNEL_ID)
    expect(useUIStore.getState().lastTVChannelId).toBe('etv9')
  })

  it('moves a viewer on Live to the first ErsatzTV channel', () => {
    useTVStore.getState().selectChannel(useTVStore.getState().getUnifiedChannels()[0])

    sources(false, true)

    expect(useTVStore.getState().selectedChannel?.id).toBe('etv1')
  })
})

describe('buildUnifiedChannels logos', () => {
  const movies = { id: 'etv1', name: 'Movies', streamUrl: '', number: 1, group: '' }

  it("gives the live slot the live channel's logo", () => {
    const [liveSlot] = buildUnifiedChannels({ ...tsn, logoUrl: '/api/channels/logos/17' }, [], true)

    expect(liveSlot).toMatchObject({ id: LIVE_CHANNEL_ID, logoUrl: '/api/channels/logos/17' })
  })

  it('gives the live slot no logo when the live channel has none, or nothing is on', () => {
    expect(buildUnifiedChannels({ ...tsn, logoUrl: null }, [], true)[0].logoUrl).toBeUndefined()
    expect(buildUnifiedChannels(tsn, [], true)[0].logoUrl).toBeUndefined()
    expect(buildUnifiedChannels(null, [], true)[0].logoUrl).toBeUndefined()
  })

  it("points an ErsatzTV channel's logo at our logo route, and leaves a channel without one without", () => {
    const [, withLogo, withoutLogo] = buildUnifiedChannels(null, [
      { ...movies, logoUrl: 'http://ersatztv.lan/iptv/logos/movies.png' },
      { ...movies, id: 'etv2', logoUrl: '' },
    ], true)

    expect(withLogo.logoUrl).toBe('/api/ersatztv/logos/etv1')
    expect(withoutLogo.logoUrl).toBeUndefined()
  })
})

describe('tvStore loadLiveGuideOnce', () => {
  const sportsnet: Channel = { id: '31', name: 'CA-S: Sportsnet ONE', streamUrl: 'http://x/31', guideId: '9' }

  beforeEach(() => {
    vi.mocked(fetchNowPlaying).mockReset().mockResolvedValue(onNow)
    vi.mocked(fetchLiveProgrammes).mockReset().mockResolvedValue({ channelId: '5', programmes: [] })
    useChannelStore.setState({ currentChannel: null })
    useTVStore.setState({ selectedChannel: null, epgLookupGuideId: null, programmesLookupGuideId: null })
    vi.mocked(fetchNowPlaying).mockClear()
    vi.mocked(fetchLiveProgrammes).mockClear()
  })

  it('skips a live channel the live switch already looked up', () => {
    useChannelStore.getState().setCurrentChannel(sportsnet)
    expect(fetchNowPlaying).toHaveBeenCalledTimes(1)
    expect(fetchLiveProgrammes).toHaveBeenCalledTimes(1)

    useTVStore.getState().loadLiveGuideOnce()

    expect(fetchNowPlaying).toHaveBeenCalledTimes(1)
    expect(fetchLiveProgrammes).toHaveBeenCalledTimes(1)
  })

  it('looks up a live channel nothing has looked up yet, once', () => {
    // Put on with no guide id, so there's nothing to look up yet
    useChannelStore.getState().setCurrentChannel({ ...sportsnet, guideId: '' })
    // The same channel again with its guide id: not a switch, so no lookup
    useChannelStore.getState().setCurrentChannel(sportsnet)
    expect(fetchNowPlaying).not.toHaveBeenCalled()
    expect(fetchLiveProgrammes).not.toHaveBeenCalled()

    useTVStore.getState().loadLiveGuideOnce()
    useTVStore.getState().loadLiveGuideOnce()

    expect(fetchNowPlaying).toHaveBeenCalledTimes(1)
    expect(fetchNowPlaying).toHaveBeenCalledWith('9', 'CA-S: Sportsnet ONE')
    expect(fetchLiveProgrammes).toHaveBeenCalledTimes(1)
    expect(fetchLiveProgrammes).toHaveBeenCalledWith('9', 'CA-S: Sportsnet ONE')
  })

  it("tunes to the live slot without a second lookup of a programme it's already looking up", () => {
    useChannelStore.getState().setCurrentChannel(sportsnet)
    expect(fetchNowPlaying).toHaveBeenCalledTimes(1)

    useTVStore.getState().selectChannel(useTVStore.getState().getUnifiedChannels()[0])

    expect(fetchNowPlaying).toHaveBeenCalledTimes(1)
  })

  it('looks the programme up on tuning to the live slot when nothing has yet', () => {
    useChannelStore.getState().setCurrentChannel({ ...sportsnet, guideId: '' })
    useChannelStore.getState().setCurrentChannel(sportsnet)
    expect(fetchNowPlaying).not.toHaveBeenCalled()

    useTVStore.getState().selectChannel(useTVStore.getState().getUnifiedChannels()[0])

    expect(fetchNowPlaying).toHaveBeenCalledTimes(1)
    expect(fetchNowPlaying).toHaveBeenCalledWith('9', 'CA-S: Sportsnet ONE')
  })

  it('looks nothing up with nothing on live TV', () => {
    useTVStore.getState().loadLiveGuideOnce()

    expect(fetchNowPlaying).not.toHaveBeenCalled()
    expect(fetchLiveProgrammes).not.toHaveBeenCalled()
  })

  it('looks a channel up again after live TV stopped and it came back', () => {
    useChannelStore.getState().setCurrentChannel(sportsnet)
    useChannelStore.getState().setCurrentChannel(null)
    useChannelStore.getState().setCurrentChannel(sportsnet)
    expect(fetchNowPlaying).toHaveBeenCalledTimes(2)

    useTVStore.getState().loadLiveGuideOnce()

    expect(fetchNowPlaying).toHaveBeenCalledTimes(2)
  })
})
