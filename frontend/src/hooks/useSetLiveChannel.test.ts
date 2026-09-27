import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { toast } from 'sonner'
import { useSetLiveChannel } from './useSetLiveChannel'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useRecentLiveStore } from '@/stores/recentLiveStore'
import { useTVStore, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import * as api from '@/services/api'
import type { Channel, UnifiedChannel } from '@/types'

vi.mock('@/services/api', () => ({
  setCurrentChannel: vi.fn(),
  // Channel 0's guide lookups, once someone is tuned to it
  fetchNowPlaying: vi.fn(async () => ({ channelId: 'x', currentProgram: null })),
  fetchLiveProgrammes: vi.fn(async () => ({ channelId: 'x', programmes: [] })),
}))

const tsn: Channel = { id: '1', name: 'TSN', streamUrl: 'http://stream1.m3u8', guideId: '1' }
const cnn: Channel = { id: '3', name: 'CNN', streamUrl: 'http://stream3.m3u8', guideId: '3' }
const movies: UnifiedChannel = { id: 'e1', name: 'Movies', number: 1, streamUrl: '/e1', type: 'ersatztv' }

describe('useSetLiveChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChannelStore.setState({ currentChannel: tsn })
    useAuthStore.setState({ username: 'jon', role: 'admin' })
    useRecentLiveStore.setState({ byUser: {} })
    // Watching an ErsatzTV channel, not live TV
    useTVStore.setState({ selectedChannel: movies })
  })

  const recents = () => useRecentLiveStore.getState().byUser.jon

  it('switches the store before the server answers, then keeps it', async () => {
    let resolve!: (channel: Channel) => void
    vi.mocked(api.setCurrentChannel).mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const { result } = renderHook(() => useSetLiveChannel())

    let switching!: Promise<boolean>
    act(() => {
      switching = result.current(cnn)
    })

    // Optimistic: already on air while the request is in flight
    expect(useChannelStore.getState().currentChannel).toEqual(cnn)
    expect(api.setCurrentChannel).toHaveBeenCalledWith(cnn)
    // Not remembered until the server has accepted it
    expect(recents()).toBeUndefined()

    await act(async () => {
      resolve(cnn)
      expect(await switching).toBe(true)
    })
    expect(useChannelStore.getState().currentChannel).toEqual(cnn)
    expect(recents()).toEqual(['3'])
  })

  it('brings the previous channel back and says why when the server refuses', async () => {
    const toastError = vi.spyOn(toast, 'error')
    vi.mocked(api.setCurrentChannel).mockRejectedValueOnce(new Error('Only admins can change the channel'))
    const { result } = renderHook(() => useSetLiveChannel())

    await act(async () => {
      expect(await result.current(cnn)).toBe(false)
    })

    expect(useChannelStore.getState().currentChannel).toEqual(tsn)
    expect(toastError).toHaveBeenCalledWith('Failed to change channel', {
      description: 'Only admins can change the channel',
    })
    // A refused switch is not a recent channel
    expect(recents()).toBeUndefined()
    toastError.mockRestore()
  })

  it('reverts to no live channel when nothing was on before', async () => {
    useChannelStore.setState({ currentChannel: null })
    vi.mocked(api.setCurrentChannel).mockRejectedValueOnce('boom')
    const toastError = vi.spyOn(toast, 'error')
    const { result } = renderHook(() => useSetLiveChannel())

    await act(async () => {
      await result.current(cnn)
    })

    expect(useChannelStore.getState().currentChannel).toBeNull()
    expect(toastError).toHaveBeenCalledWith('Failed to change channel', { description: 'Please try again' })
    toastError.mockRestore()
  })

  it("remembers each switch in the signed-in admin's recents", async () => {
    vi.mocked(api.setCurrentChannel).mockImplementation(async (channel) => channel)
    const { result } = renderHook(() => useSetLiveChannel())

    await act(async () => {
      await result.current(cnn)
      await result.current(tsn)
    })

    expect(recents()).toEqual(['1', '3'])
  })

  it('remembers the switches of a viewer allowed to pick channels, who sees them in the switcher', async () => {
    useAuthStore.setState({ username: 'sam', role: 'viewer' })
    vi.mocked(api.setCurrentChannel).mockImplementation(async (channel) => channel)
    const { result } = renderHook(() => useSetLiveChannel())

    await act(async () => {
      expect(await result.current(cnn)).toBe(true)
    })

    expect(useChannelStore.getState().currentChannel).toEqual(cnn)
    expect(useRecentLiveStore.getState().byUser).toEqual({ sam: ['3'] })
  })

  describe('tuneActor', () => {
    const selected = () => useTVStore.getState().selectedChannel

    it('tunes the person who switched to channel 0 once the server accepts the switch', async () => {
      let resolve!: (channel: Channel) => void
      vi.mocked(api.setCurrentChannel).mockReturnValueOnce(new Promise((r) => { resolve = r }))
      const { result } = renderHook(() => useSetLiveChannel({ tuneActor: true }))

      let switching!: Promise<boolean>
      act(() => {
        switching = result.current(cnn)
      })
      // Not while the switch may still be refused
      expect(selected()).toEqual(movies)

      await act(async () => {
        resolve(cnn)
        await switching
      })
      expect(selected()).toMatchObject({ id: LIVE_CHANNEL_ID, type: 'live', number: 0, streamUrl: cnn.streamUrl })
    })

    it('leaves the person where they are when the switch is refused', async () => {
      const toastError = vi.spyOn(toast, 'error')
      vi.mocked(api.setCurrentChannel).mockRejectedValueOnce(new Error('Only admins can change the channel'))
      const { result } = renderHook(() => useSetLiveChannel({ tuneActor: true }))

      await act(async () => {
        await result.current(cnn)
      })

      expect(selected()).toEqual(movies)
      toastError.mockRestore()
    })

    it('leaves the person where they are by default, as the admin panel switches', async () => {
      vi.mocked(api.setCurrentChannel).mockImplementation(async (channel) => channel)
      const { result } = renderHook(() => useSetLiveChannel())

      await act(async () => {
        expect(await result.current(cnn)).toBe(true)
      })

      expect(selected()).toEqual(movies)
    })
  })
})
