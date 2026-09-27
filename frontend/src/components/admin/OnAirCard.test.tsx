import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { toast } from 'sonner'
import { render, screen, fireEvent, waitFor, act, within } from '@/test/utils'
import { OnAirCard } from './OnAirCard'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useRecentLiveStore } from '@/stores/recentLiveStore'
import * as api from '@/services/api'
import type { Channel, GroupedChannelsResponse } from '@/types'

vi.mock('@/services/api', () => ({
  fetchGroupedChannels: vi.fn(),
  fetchNowPlaying: vi.fn(),
  setCurrentChannel: vi.fn(),
  clearCurrentChannel: vi.fn(),
}))

// Presence lists sessions: alice has two tabs open
const liveUsers = [
  { username: 'alice', channel: 'TSN' },
  { username: 'alice', channel: 'TSN' },
  { username: 'bob', channel: 'TSN' },
  { username: 'jon', channel: 'TSN' },
]
const mockUseActiveUsers = vi.fn(() => ({
  data: { liveUsers },
  loading: false,
  error: null as string | null,
}))
vi.mock('@/hooks/useActiveUsers', () => ({
  useActiveUsers: () => mockUseActiveUsers(),
}))

const tsn: Channel = { id: '1', name: 'TSN', streamUrl: 'http://stream1.m3u8', guideId: 'tsn.ca' }
const sportsnet: Channel = { id: '2', name: 'Sportsnet', streamUrl: 'http://stream2.m3u8', guideId: 'sn.ca' }
const cnn: Channel = { id: '3', name: 'CNN', streamUrl: 'http://stream3.m3u8', guideId: 'cnn.us' }

const catalogue = (...channels: Channel[]): GroupedChannelsResponse => ({
  groups: [{ id: 1, name: 'Sports', channelCount: channels.length - 1, channels: channels.slice(1) }],
  ungrouped: channels.slice(0, 1),
})

const programme = (title: string) => ({
  channelId: 'x',
  currentProgram: { title, startTime: '2026-09-27T18:00:00Z', endTime: '2026-09-27T21:00:00Z' },
})

describe('OnAirCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseActiveUsers.mockReturnValue({ data: { liveUsers }, loading: false, error: null })
    useChannelStore.setState({ currentChannel: tsn })
    useAuthStore.setState({ token: 'test-token', role: 'admin', username: 'jon', isAuthenticated: true })
    useRecentLiveStore.setState({ byUser: {} })
    vi.mocked(api.fetchNowPlaying).mockResolvedValue({ channelId: 'x', currentProgram: null })
    // Loads only in the tests about the Recent row, which wait for it
    vi.mocked(api.fetchGroupedChannels).mockReturnValue(new Promise(() => {}))
  })

  it('names the channel on air', () => {
    render(<OnAirCard />)

    const card = screen.getByRole('region', { name: 'On air' })
    expect(within(card).getByText('On air for everyone')).toBeInTheDocument()
    expect(within(card).getByText('TSN')).toBeInTheDocument()
    expect(within(card).getByText('Live')).toBe(within(card).getByTestId('live-pill'))
  })

  it("shows the live channel's logo", () => {
    useChannelStore.setState({ currentChannel: { ...tsn, logoUrl: '/api/channels/logos/17' } })
    render(<OnAirCard />)

    const slot = screen
      .getByRole('region', { name: 'On air' })
      .querySelector<HTMLElement>('[data-testid="channel-logo"]')!
    expect(slot.querySelector('img')).toHaveAttribute('src', '/api/channels/logos/17')
  })

  it('shows a monogram for a live channel without a logo', () => {
    render(<OnAirCard />)

    const slot = screen
      .getByRole('region', { name: 'On air' })
      .querySelector<HTMLElement>('[data-testid="channel-logo"]')!
    expect(slot.querySelector('img')).toBeNull()
    expect(slot.querySelector('[data-monogram]')).toHaveAttribute('data-monogram', 'TSN')
  })

  it('sticks to the top of the scrolling tab with an opaque background', () => {
    render(<OnAirCard />)

    expect(screen.getByRole('region', { name: 'On air' })).toHaveClass('sticky', 'top-0', 'bg-background')
  })

  describe('height reporting', () => {
    // jsdom has no layout: capture the observer so the test can drive it
    let resize: () => void = () => {}
    const disconnect = vi.fn()

    beforeEach(() => {
      class CapturingResizeObserver implements ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resize = () => callback([], this)
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {
          disconnect()
        }
      }
      vi.stubGlobal('ResizeObserver', CapturingResizeObserver)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it("reports the card's height as it changes, so the list under it can keep focus clear", () => {
      const onHeightChange = vi.fn()
      const { unmount } = render(<OnAirCard onHeightChange={onHeightChange} />)
      const card = screen.getByRole('region', { name: 'On air' })

      Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 152 })
      act(() => resize())
      expect(onHeightChange).toHaveBeenLastCalledWith(152)

      Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 96 })
      act(() => resize())
      expect(onHeightChange).toHaveBeenLastCalledWith(96)

      unmount()
      expect(disconnect).toHaveBeenCalled()
    })
  })

  it("shows the programme on the live channel, looked up by guide id and name", async () => {
    vi.mocked(api.fetchNowPlaying).mockResolvedValueOnce(programme('NHL: Habs @ Leafs'))

    render(<OnAirCard />)

    expect(await screen.findByText('NHL: Habs @ Leafs')).toBeInTheDocument()
    expect(api.fetchNowPlaying).toHaveBeenCalledWith('tsn.ca', 'TSN')
  })

  it('leaves the programme out when the guide lookup fails', async () => {
    vi.mocked(api.fetchNowPlaying).mockRejectedValueOnce(new Error('Failed to fetch EPG'))

    render(<OnAirCard />)

    await waitFor(() => expect(api.fetchNowPlaying).toHaveBeenCalled())
    expect(screen.getByText('TSN')).toBeInTheDocument()
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument()
  })

  it("drops the last channel's programme when live TV switches", async () => {
    vi.mocked(api.fetchNowPlaying)
      .mockResolvedValueOnce(programme('NHL: Habs @ Leafs'))
      .mockReturnValueOnce(new Promise(() => {}))

    render(<OnAirCard />)
    expect(await screen.findByText('NHL: Habs @ Leafs')).toBeInTheDocument()

    act(() => {
      useChannelStore.setState({ currentChannel: cnn })
    })

    expect(screen.getByText('CNN')).toBeInTheDocument()
    expect(screen.queryByText('NHL: Habs @ Leafs')).not.toBeInTheDocument()
    expect(api.fetchNowPlaying).toHaveBeenLastCalledWith('cnn.us', 'CNN')
  })

  it('counts people watching, not sessions', () => {
    render(<OnAirCard />)

    // alice (twice), bob and jon: three people
    expect(screen.getByText('3 watching')).toBeInTheDocument()
  })

  it('leaves the count out while presence is loading or unavailable', () => {
    mockUseActiveUsers.mockReturnValue({ data: { liveUsers }, loading: false, error: 'Failed to fetch: 500' })

    render(<OnAirCard />)

    expect(screen.queryByText(/watching/)).not.toBeInTheDocument()
  })

  describe('for a viewer allowed to change live TV (in the switcher)', () => {
    beforeEach(() => {
      useAuthStore.setState({ token: 'test-token', role: 'viewer', username: 'sam', isAuthenticated: true })
    })

    it('names the channel on air without Stop live TV', () => {
      render(<OnAirCard showRecents={false} />)

      expect(screen.getByText('TSN')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /stop live tv/i })).not.toBeInTheDocument()
    })

    it('does not poll the admin-only presence for a watching count', () => {
      render(<OnAirCard showRecents={false} />)

      expect(mockUseActiveUsers).not.toHaveBeenCalled()
      expect(screen.queryByText(/watching/)).not.toBeInTheDocument()
    })
  })

  it('leaves its Recent row out, without loading the catalogue, when the switcher lists recents itself', async () => {
    vi.mocked(api.fetchGroupedChannels).mockResolvedValue(catalogue(tsn, sportsnet, cnn))
    useRecentLiveStore.getState().record('jon', cnn.id)

    render(<OnAirCard showRecents={false} />)

    expect(await screen.findByRole('button', { name: /stop live tv/i })).toBeInTheDocument()
    expect(api.fetchGroupedChannels).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', { name: 'Recent live channels' })).not.toBeInTheDocument()
  })

  describe('Nothing on live TV', () => {
    beforeEach(() => {
      useChannelStore.setState({ currentChannel: null })
    })

    it('says so and points to the list', () => {
      render(<OnAirCard />)

      expect(screen.getByText('Nothing on live TV')).toBeInTheDocument()
      expect(screen.getByText(/pick a channel from the list below/i)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /stop live tv/i })).not.toBeInTheDocument()
    })

    it('does not poll presence or the guide', () => {
      render(<OnAirCard />)

      expect(mockUseActiveUsers).not.toHaveBeenCalled()
      expect(api.fetchNowPlaying).not.toHaveBeenCalled()
    })

    it('still offers recent channels to go back to', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValue(catalogue(tsn, sportsnet, cnn))
      useRecentLiveStore.getState().record('jon', tsn.id)

      render(<OnAirCard />)

      const recent = await screen.findByRole('group', { name: 'Recent live channels' })
      expect(within(recent).getByRole('button', { name: 'TSN' })).toBeInTheDocument()
    })
  })

  describe('Recent', () => {
    beforeEach(() => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValue(catalogue(tsn, sportsnet, cnn))
    })

    it('lists the recent channels except the one on air, most recent first', async () => {
      const { record } = useRecentLiveStore.getState()
      record('jon', cnn.id)
      record('jon', sportsnet.id)
      record('jon', tsn.id)

      render(<OnAirCard />)

      const recent = await screen.findByRole('group', { name: 'Recent live channels' })
      expect(within(recent).getAllByRole('button').map((b) => b.textContent)).toEqual(['Sportsnet', 'CNN'])
    })

    it("shows only the signed-in admin's recents", async () => {
      useRecentLiveStore.getState().record('sam', cnn.id)

      render(<OnAirCard />)

      await waitFor(() => expect(api.fetchGroupedChannels).toHaveBeenCalled())
      expect(screen.queryByRole('group', { name: 'Recent live channels' })).not.toBeInTheDocument()
    })

    it('shows no recents until the catalogue has loaded, nor when it cannot load', async () => {
      useRecentLiveStore.getState().record('jon', cnn.id)
      vi.mocked(api.fetchGroupedChannels).mockRejectedValueOnce(new Error('Channel service unavailable'))

      render(<OnAirCard />)

      expect(screen.queryByRole('group', { name: 'Recent live channels' })).not.toBeInTheDocument()
      await waitFor(() => expect(api.fetchGroupedChannels).toHaveBeenCalled())
      expect(screen.queryByRole('group', { name: 'Recent live channels' })).not.toBeInTheDocument()
      // Nothing is forgotten on a failed load
      expect(useRecentLiveStore.getState().byUser.jon).toEqual([cnn.id])
    })

    it('names and switches to the channel as the catalogue has it now', async () => {
      const renamed: Channel = { ...cnn, name: 'CNN International', streamUrl: 'http://stream3b.m3u8' }
      vi.mocked(api.fetchGroupedChannels).mockResolvedValue(catalogue(tsn, renamed))
      vi.mocked(api.setCurrentChannel).mockResolvedValueOnce(renamed)
      useRecentLiveStore.getState().record('jon', cnn.id)

      render(<OnAirCard />)

      fireEvent.click(await screen.findByRole('button', { name: 'CNN International' }))

      expect(api.setCurrentChannel).toHaveBeenCalledWith(renamed)
      expect(useChannelStore.getState().currentChannel).toEqual(renamed)
      // On air now, it leaves the Recent row, which has nothing else to show
      await waitFor(() => {
        expect(screen.queryByRole('group', { name: 'Recent live channels' })).not.toBeInTheDocument()
      })
      expect(screen.getByText('CNN International')).toBeInTheDocument()
    })

    it('drops, and forgets, recent channels that are no longer in the catalogue', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValue(catalogue(tsn, cnn))
      const { record } = useRecentLiveStore.getState()
      record('jon', cnn.id)
      record('jon', sportsnet.id)

      render(<OnAirCard />)

      const recent = await screen.findByRole('group', { name: 'Recent live channels' })
      expect(within(recent).getAllByRole('button').map((b) => b.textContent)).toEqual(['CNN'])
      expect(useRecentLiveStore.getState().byUser.jon).toEqual([cnn.id])
    })

    it('puts a recent channel on live TV in one tap', async () => {
      vi.mocked(api.setCurrentChannel).mockResolvedValueOnce(cnn)
      const { record } = useRecentLiveStore.getState()
      record('jon', tsn.id)
      record('jon', cnn.id)

      render(<OnAirCard />)

      fireEvent.click(await screen.findByRole('button', { name: 'CNN' }))

      expect(api.setCurrentChannel).toHaveBeenCalledWith(cnn)
      expect(useChannelStore.getState().currentChannel).toEqual(cnn)
      // Now on air, CNN leaves the Recent row and TSN, just replaced, shows instead
      await waitFor(() => {
        const recent = screen.getByRole('group', { name: 'Recent live channels' })
        expect(within(recent).getAllByRole('button').map((b) => b.textContent)).toEqual(['TSN'])
      })
    })
  })

  describe('Stop live TV', () => {
    it('is a small outline action', () => {
      render(<OnAirCard />)

      const stop = screen.getByRole('button', { name: 'Stop live TV…' })
      expect(stop).toHaveAttribute('data-size', 'sm')
      expect(stop).toHaveAttribute('data-variant', 'outline')
    })

    it('asks before stopping, naming how many other people are watching', () => {
      render(<OnAirCard />)

      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV…' }))

      const dialog = screen.getByRole('dialog', { name: 'Stop live TV for everyone?' })
      // alice and bob; the admin pressing Stop is not counted
      expect(dialog).toHaveAccessibleDescription(
        '2 people are watching TSN. Their screens will show "No live broadcast" until someone picks a channel.'
      )
      expect(api.clearCurrentChannel).not.toHaveBeenCalled()
    })

    it('keeps live TV on when the admin chooses Keep it on', async () => {
      render(<OnAirCard />)

      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Keep it on' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      expect(api.clearCurrentChannel).not.toHaveBeenCalled()
      expect(useChannelStore.getState().currentChannel).toEqual(tsn)
    })

    it('stops live TV once when the admin confirms', async () => {
      vi.mocked(api.clearCurrentChannel).mockResolvedValueOnce(undefined)

      render(<OnAirCard />)

      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV' }))

      await waitFor(() => {
        expect(api.clearCurrentChannel).toHaveBeenCalledTimes(1)
      })
      expect(useChannelStore.getState().currentChannel).toBeNull()
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      expect(screen.getByText('Nothing on live TV')).toBeInTheDocument()
    })

    it('says it could not stop live TV, once, and keeps the channel when stopping fails', async () => {
      const toastError = vi.spyOn(toast, 'error')
      vi.mocked(api.clearCurrentChannel).mockRejectedValueOnce(new Error('Could not stop live TV'))

      render(<OnAirCard />)

      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV' }))

      await waitFor(() => {
        expect(toastError).toHaveBeenCalledWith('Could not stop live TV', {
          description: 'Please try again',
        })
      })
      expect(useChannelStore.getState().currentChannel).toEqual(tsn)
      toastError.mockRestore()
    })

    it('gives the reason under the title when there is one', async () => {
      const toastError = vi.spyOn(toast, 'error')
      vi.mocked(api.clearCurrentChannel).mockRejectedValueOnce(new Error('Only admins can stop live TV'))

      render(<OnAirCard />)

      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV' }))

      await waitFor(() => {
        expect(toastError).toHaveBeenCalledWith('Could not stop live TV', {
          description: 'Only admins can stop live TV',
        })
      })
      toastError.mockRestore()
    })

    it('drops an open confirm when live TV stops elsewhere', async () => {
      render(<OnAirCard />)

      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV…' }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      // Another admin stops live TV; the change arrives over the WebSocket
      act(() => {
        useChannelStore.setState({ currentChannel: null })
      })
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })

      // Later someone picks the same channel again: nobody asked to stop it
      act(() => {
        useChannelStore.setState({ currentChannel: tsn })
      })
      expect(await screen.findByRole('button', { name: 'Stop live TV…' })).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('drops an open confirm when live TV switches to another channel', async () => {
      render(<OnAirCard />)

      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV…' }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      act(() => {
        useChannelStore.setState({ currentChannel: cnn })
      })
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
      expect(api.clearCurrentChannel).not.toHaveBeenCalled()
    })
  })
})
