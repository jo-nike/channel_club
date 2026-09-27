import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTVStore, LIVE_CHANNEL_ID } from './tvStore'
import { useChannelStore } from './channelStore'
import { fetchNowPlaying } from '@/services/api'
import type { Channel, EPGResponse } from '@/types'

vi.mock('@/services/api', () => ({ fetchNowPlaying: vi.fn() }))

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
