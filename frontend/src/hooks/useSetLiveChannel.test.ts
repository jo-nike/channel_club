import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { toast } from 'sonner'
import { useSetLiveChannel } from './useSetLiveChannel'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useRecentLiveStore } from '@/stores/recentLiveStore'
import * as api from '@/services/api'
import type { Channel } from '@/types'

vi.mock('@/services/api', () => ({
  setCurrentChannel: vi.fn(),
}))

const tsn: Channel = { id: '1', name: 'TSN', streamUrl: 'http://stream1.m3u8', guideId: '1' }
const cnn: Channel = { id: '3', name: 'CNN', streamUrl: 'http://stream3.m3u8', guideId: '3' }

describe('useSetLiveChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChannelStore.setState({ currentChannel: tsn })
    useAuthStore.setState({ username: 'jon' })
    useRecentLiveStore.setState({ byUser: {} })
  })

  const recents = () => useRecentLiveStore.getState().byUser.jon?.map((c) => c.id)

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

  it("remembers each switch in the signed-in person's recents", async () => {
    vi.mocked(api.setCurrentChannel).mockImplementation(async (channel) => channel)
    const { result } = renderHook(() => useSetLiveChannel())

    await act(async () => {
      await result.current(cnn)
      await result.current(tsn)
    })

    expect(recents()).toEqual(['1', '3'])
  })
})
