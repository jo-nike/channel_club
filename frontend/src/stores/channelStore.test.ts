import { describe, it, expect, beforeEach } from 'vitest'
import { describeLiveChange, useChannelStore } from './channelStore'

describe('channelStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useChannelStore.setState({
      channels: [],
      currentChannel: null,
      lastChange: null,
      isLoading: false,
      error: null,
    })
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
