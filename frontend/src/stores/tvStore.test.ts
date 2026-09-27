import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTVStore, LIVE_CHANNEL_ID } from './tvStore'
import { useChannelStore } from './channelStore'
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
