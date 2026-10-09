import { describe, it, expect, beforeEach, vi } from 'vitest'
import { describeLiveChange, loadCurrentChannel, useChannelStore } from './channelStore'
import { fetchCurrentChannel } from '@/services/api'

vi.mock('@/services/api', () => ({
  fetchCurrentChannel: vi.fn(),
}))

describe('channelStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useChannelStore.setState({
      channels: [],
      currentChannel: null,
      liveKnown: false,
      liveVersion: 0,
      lastChange: null,
      isLoading: false,
      error: null,
    })
    vi.mocked(fetchCurrentChannel).mockReset()
  })

  describe('initial state', () => {
    it('should have empty channels array initially', () => {
      const state = useChannelStore.getState()
      expect(state.channels).toEqual([])
    })

    it('should have null currentChannel initially', () => {
      const state = useChannelStore.getState()
      expect(state.currentChannel).toBeNull()
    })

    it('should have false isLoading initially', () => {
      const state = useChannelStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should have null error initially', () => {
      const state = useChannelStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('setChannels', () => {
    it('should set channels array', () => {
      const mockChannels = [
        { id: '1', name: 'Channel 1', streamUrl: 'http://stream1.m3u8' },
        { id: '2', name: 'Channel 2', streamUrl: 'http://stream2.m3u8' },
      ]

      useChannelStore.getState().setChannels(mockChannels)

      const state = useChannelStore.getState()
      expect(state.channels).toEqual(mockChannels)
    })

    it('should clear error when setting channels', () => {
      useChannelStore.setState({ error: 'Previous error' })

      useChannelStore.getState().setChannels([])

      const state = useChannelStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('setCurrentChannel', () => {
    it('should set currentChannel to Channel object', () => {
      const channel = { id: '1', name: 'Test Channel', streamUrl: 'http://test.m3u8' }

      useChannelStore.getState().setCurrentChannel(channel)

      const state = useChannelStore.getState()
      expect(state.currentChannel).toEqual(channel)
    })

    it('should set currentChannel to null', () => {
      const channel = { id: '1', name: 'Test Channel', streamUrl: 'http://test.m3u8' }
      useChannelStore.setState({ currentChannel: channel })

      useChannelStore.getState().setCurrentChannel(null)

      const state = useChannelStore.getState()
      expect(state.currentChannel).toBeNull()
    })

    it('marks the live channel as known, even when nothing is on', () => {
      expect(useChannelStore.getState().liveKnown).toBe(false)

      useChannelStore.getState().setCurrentChannel(null)

      expect(useChannelStore.getState().liveKnown).toBe(true)
    })
  })

  describe('loadCurrentChannel', () => {
    const game = { id: '7', name: 'CA-FR: RDS', streamUrl: 'http://rds.ts' }

    it('takes the live channel from the server when the socket has said nothing', async () => {
      vi.mocked(fetchCurrentChannel).mockResolvedValue(game)

      await loadCurrentChannel()

      expect(useChannelStore.getState().currentChannel).toEqual(game)
      expect(useChannelStore.getState().liveKnown).toBe(true)
    })

    it('knows nothing is on when the server says so', async () => {
      vi.mocked(fetchCurrentChannel).mockResolvedValue(null)

      await loadCurrentChannel()

      expect(useChannelStore.getState().currentChannel).toBeNull()
      expect(useChannelStore.getState().liveKnown).toBe(true)
    })

    it('drops its answer when a socket update arrived while it was in flight', async () => {
      const newer = { id: '8', name: 'TSN 5', streamUrl: 'http://tsn.ts' }
      let answer: (channel: typeof game) => void = () => {}
      vi.mocked(fetchCurrentChannel).mockReturnValue(new Promise((resolve) => { answer = resolve }))

      const loading = loadCurrentChannel()
      useChannelStore.getState().setCurrentChannel(newer)
      answer(game)
      await loading

      expect(useChannelStore.getState().currentChannel).toEqual(newer)
    })

    it('leaves the state alone when the request fails', async () => {
      vi.mocked(fetchCurrentChannel).mockRejectedValue(new Error('Failed to fetch current channel'))

      await loadCurrentChannel()

      expect(useChannelStore.getState().currentChannel).toBeNull()
      expect(useChannelStore.getState().liveKnown).toBe(false)
    })
  })

  describe('setLoading', () => {
    it('should set isLoading to true', () => {
      useChannelStore.getState().setLoading(true)

      const state = useChannelStore.getState()
      expect(state.isLoading).toBe(true)
    })

    it('should set isLoading to false', () => {
      useChannelStore.setState({ isLoading: true })

      useChannelStore.getState().setLoading(false)

      const state = useChannelStore.getState()
      expect(state.isLoading).toBe(false)
    })
  })

  describe('setError', () => {
    it('should set error message', () => {
      useChannelStore.getState().setError('Unable to load channels')

      const state = useChannelStore.getState()
      expect(state.error).toBe('Unable to load channels')
    })

    it('should set isLoading to false when setting error', () => {
      useChannelStore.setState({ isLoading: true })

      useChannelStore.getState().setError('Error occurred')

      const state = useChannelStore.getState()
      expect(state.isLoading).toBe(false)
    })

    it('should clear error when set to null', () => {
      useChannelStore.setState({ error: 'Previous error' })

      useChannelStore.getState().setError(null)

      const state = useChannelStore.getState()
      expect(state.error).toBeNull()
    })
  })

  describe('setLastChange', () => {
    it('has no last change initially', () => {
      expect(useChannelStore.getState().lastChange).toBeNull()
    })

    it('records who changed the live channel, when, and to what', () => {
      useChannelStore.getState().setLastChange({ by: 'alice', at: 1000, channelName: 'ESPN' })

      expect(useChannelStore.getState().lastChange).toEqual({ by: 'alice', at: 1000, channelName: 'ESPN' })
    })

    it('replaces the previous change and leaves the current channel alone', () => {
      const channel = { id: '1', name: 'ESPN', streamUrl: 'http://stream1.m3u8' }
      useChannelStore.setState({ currentChannel: channel })
      useChannelStore.getState().setLastChange({ by: 'alice', at: 1000, channelName: 'ESPN' })

      useChannelStore.getState().setLastChange({ by: 'bob', at: 2000, channelName: null })

      expect(useChannelStore.getState().lastChange).toEqual({ by: 'bob', at: 2000, channelName: null })
      expect(useChannelStore.getState().currentChannel).toEqual(channel)
    })
  })
})

describe('describeLiveChange', () => {
  it.each([
    ['TSN 5', 'jon', 'jon put on TSN 5'],
    ['TSN 5', null, 'Live channel set to TSN 5'],
    [null, 'jon', 'jon stopped live TV'],
    [null, null, 'Live TV stopped'],
  ] as const)('%s by %s reads "%s"', (channelName, by, text) => {
    expect(describeLiveChange(channelName, by)).toBe(text)
  })
})
