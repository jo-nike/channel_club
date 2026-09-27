import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@/test/utils'
import { ChannelList } from './ChannelList'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import * as api from '@/services/api'
import type { GroupedChannelsResponse } from '@/types'

vi.mock('@/services/api', () => ({
  fetchGroupedChannels: vi.fn(),
  fetchNowPlayingAll: vi.fn(),
  setCurrentChannel: vi.fn(),
}))

const mockGroupedResponse: GroupedChannelsResponse = {
  groups: [
    {
      id: 1,
      name: 'Sports',
      channelCount: 2,
      channels: [
        { id: '1', name: 'TSN', streamUrl: 'http://stream1.m3u8', guideId: '1' },
        { id: '2', name: 'Sportsnet', streamUrl: 'http://stream2.m3u8', guideId: '2' },
      ],
    },
    {
      id: 2,
      name: 'News',
      channelCount: 1,
      channels: [
        { id: '3', name: 'CNN', streamUrl: 'http://stream3.m3u8', guideId: '3' },
      ],
    },
  ],
  ungrouped: [
    { id: '4', name: 'CBC', streamUrl: 'http://stream4.m3u8', guideId: '4' },
  ],
}

describe('ChannelList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChannelStore.setState({
      channels: [],
      currentChannel: null,
      isLoading: false,
      error: null,
    })
    useAuthStore.setState({
      token: 'test-token',
      role: 'viewer',
      isAuthenticated: true,
    })
    useSettingsStore.setState({ userChannelSelection: false })
    vi.mocked(api.fetchNowPlayingAll).mockResolvedValue({})
  })

  describe('Loading state', () => {
    it('should render loading skeletons when fetching', async () => {
      // Create a promise that never resolves to keep loading state
      vi.mocked(api.fetchGroupedChannels).mockImplementation(
        () => new Promise(() => {})
      )

      render(<ChannelList />)

      // Check for skeleton container
      const skeletonContainer = document.querySelector('.flex.flex-col.gap-2.p-4')
      expect(skeletonContainer).toBeInTheDocument()
    })
  })

  describe('Successful fetch', () => {
    it('should render channel groups after successful fetch', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
        expect(screen.getByText('News')).toBeInTheDocument()
        expect(screen.getByText('Ungrouped')).toBeInTheDocument()
      })
    })

    it('should call fetchGroupedChannels on mount', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      expect(api.fetchGroupedChannels).toHaveBeenCalledTimes(1)
    })

    it('should show channel counts in group headers', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        // Sports has 2 channels
        expect(screen.getByText('2')).toBeInTheDocument()
        // News and Ungrouped each have 1 channel - just verify group names are shown
        expect(screen.getByText('Sports')).toBeInTheDocument()
        expect(screen.getByText('News')).toBeInTheDocument()
      })
    })

    it('should have groups collapsed by default', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      // Channels should not be visible when groups are collapsed
      expect(screen.queryByText('TSN')).not.toBeInTheDocument()
      expect(screen.queryByText('Sportsnet')).not.toBeInTheDocument()
    })

    it('should expand group when clicked', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sports'))

      expect(screen.getByText('TSN')).toBeInTheDocument()
      expect(screen.getByText('Sportsnet')).toBeInTheDocument()
    })
  })

  describe('Error state', () => {
    it('should render error message on failed fetch', async () => {
      vi.mocked(api.fetchGroupedChannels).mockRejectedValueOnce(new Error('Network error'))

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText(/unable to load channels/i)).toBeInTheDocument()
      })
    })

    it('should show retry button on error', async () => {
      vi.mocked(api.fetchGroupedChannels).mockRejectedValueOnce(new Error('Network error'))

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
      })
    })

    it('should retry fetch when retry button clicked', async () => {
      vi.mocked(api.fetchGroupedChannels)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /retry/i }))

      await waitFor(() => {
        expect(api.fetchGroupedChannels).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('Empty state', () => {
    it('should render empty message when no channels', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce({
        groups: [],
        ungrouped: [],
      })

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText(/no channels available/i)).toBeInTheDocument()
      })
    })
  })

  describe('Search/Filter', () => {
    it('should render search input', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search channels...')).toBeInTheDocument()
      })
    })

    it('should filter channels by search query', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText('Search channels...')
      fireEvent.change(searchInput, { target: { value: 'TSN' } })

      // Sports group should still be visible (contains TSN)
      expect(screen.getByText('Sports')).toBeInTheDocument()
      // News group should be hidden (no matching channels)
      expect(screen.queryByText('News')).not.toBeInTheDocument()
      // Ungrouped should be hidden (no matching channels)
      expect(screen.queryByText('Ungrouped')).not.toBeInTheDocument()
    })

    it('should auto-expand groups with matching channels', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText('Search channels...')
      fireEvent.change(searchInput, { target: { value: 'TSN' } })

      // TSN should be visible (group auto-expanded)
      expect(screen.getByText('TSN')).toBeInTheDocument()
    })

    it('should show no matches message when search has no results', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText('Search channels...')
      fireEvent.change(searchInput, { target: { value: 'XXXXX' } })

      expect(screen.getByText(/no channels match/i)).toBeInTheDocument()
    })

    it('should clear search when clear button is clicked', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText('Search channels...')
      fireEvent.change(searchInput, { target: { value: 'TSN' } })

      // Click clear button
      const clearButton = screen.getByLabelText('Clear search')
      fireEvent.click(clearButton)

      // All groups should be visible again
      expect(screen.getByText('Sports')).toBeInTheDocument()
      expect(screen.getByText('News')).toBeInTheDocument()
    })
  })

  describe('Admin user', () => {
    beforeEach(() => {
      useAuthStore.setState({ role: 'admin' })
      vi.mocked(api.setCurrentChannel).mockResolvedValue(mockGroupedResponse.groups[0].channels[0])
    })

    it('should select channel when admin clicks', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      // Expand group
      fireEvent.click(screen.getByText('Sports'))
      // Click channel
      fireEvent.click(screen.getByText('TSN'))

      await waitFor(() => {
        const state = useChannelStore.getState()
        expect(state.currentChannel).toEqual(mockGroupedResponse.groups[0].channels[0])
      })
    })

    it('should call setCurrentChannel API when admin selects channel', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sports'))
      fireEvent.click(screen.getByText('TSN'))

      await waitFor(() => {
        expect(api.setCurrentChannel).toHaveBeenCalledWith(
          mockGroupedResponse.groups[0].channels[0]
        )
      })
    })

    it('should not show Stop live TV even while a channel is live (it lives on the On-air card)', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)
      useChannelStore.setState({ currentChannel: mockGroupedResponse.groups[0].channels[0] })

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: /stop live tv/i })).not.toBeInTheDocument()
      expect(screen.queryByText('Clear Channel')).not.toBeInTheDocument()
    })

    it('should close sidebar drawer when channel is selected', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)
      useUIStore.setState({ isSidebarOpen: true })

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      expect(useUIStore.getState().isSidebarOpen).toBe(true)

      fireEvent.click(screen.getByText('Sports'))
      fireEvent.click(screen.getByText('TSN'))

      await waitFor(() => {
        expect(useUIStore.getState().isSidebarOpen).toBe(false)
      })
    })
  })

  describe('Viewer user', () => {
    beforeEach(() => {
      useAuthStore.setState({ role: 'viewer' })
    })

    it('should not select channel when viewer clicks', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sports'))
      fireEvent.click(screen.getByText('TSN'))

      // Channel should not be selected for viewer
      const state = useChannelStore.getState()
      expect(state.currentChannel).toBeNull()
    })

    it('should not show Stop live TV for viewer', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)
      useChannelStore.setState({ currentChannel: mockGroupedResponse.groups[0].channels[0] })

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: /stop live tv/i })).not.toBeInTheDocument()
    })
  })

  describe('Viewer user with user channel selection enabled', () => {
    beforeEach(() => {
      useAuthStore.setState({ role: 'viewer' })
      useSettingsStore.setState({ userChannelSelection: true })
    })

    it('should select channel when viewer clicks', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)
      vi.mocked(api.setCurrentChannel).mockResolvedValueOnce(
        mockGroupedResponse.groups[0].channels[0]
      )

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sports'))
      fireEvent.click(screen.getByText('TSN'))

      await waitFor(() => {
        expect(vi.mocked(api.setCurrentChannel)).toHaveBeenCalledWith(
          mockGroupedResponse.groups[0].channels[0]
        )
      })
    })

    it('should still not show Stop live TV', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)
      useChannelStore.setState({ currentChannel: mockGroupedResponse.groups[0].channels[0] })

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: /stop live tv/i })).not.toBeInTheDocument()
    })
  })

  describe('Now playing', () => {
    it('should show the current programme under each channel', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)
      vi.mocked(api.fetchNowPlayingAll).mockResolvedValueOnce({
        // Keyed by guideId, not channel id
        '1': {
          title: 'NHL: Habs @ Leafs',
          startTime: '2026-08-14T18:00:00Z',
          endTime: '2026-08-14T21:00:00Z',
        },
      })

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sports'))

      await waitFor(() => {
        expect(screen.getByText('NHL: Habs @ Leafs')).toBeInTheDocument()
      })
    })

    it('should still render the list when the EPG request fails', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)
      vi.mocked(api.fetchNowPlayingAll).mockRejectedValueOnce(new Error('EPG down'))

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Sports'))
      expect(screen.getByText('TSN')).toBeInTheDocument()
    })
  })

  describe('Group holding the live channel', () => {
    it('should start open, with the other groups collapsed', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)
      // CNN is in News
      useChannelStore.setState({ currentChannel: mockGroupedResponse.groups[1].channels[0] })

      render(<ChannelList />)

      expect(await screen.findByText('CNN')).toBeInTheDocument()
      expect(screen.getByText('Now Playing')).toBeInTheDocument()
      expect(screen.queryByText('TSN')).not.toBeInTheDocument()
      expect(screen.queryByText('CBC')).not.toBeInTheDocument()
    })

    it('should open the Ungrouped section when it holds the live channel', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)
      useChannelStore.setState({ currentChannel: mockGroupedResponse.ungrouped[0] })

      render(<ChannelList />)

      expect(await screen.findByText('CBC')).toBeInTheDocument()
      expect(screen.queryByText('CNN')).not.toBeInTheDocument()
    })

    it('should still let the group be collapsed', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)
      useChannelStore.setState({ currentChannel: mockGroupedResponse.groups[1].channels[0] })

      render(<ChannelList />)

      expect(await screen.findByText('CNN')).toBeInTheDocument()
      fireEvent.click(screen.getByText('News'))

      expect(screen.queryByText('CNN')).not.toBeInTheDocument()
    })
  })

  describe('Current channel indicator', () => {
    it('should show "Now Playing" for current channel when group is expanded', async () => {
      vi.mocked(api.fetchGroupedChannels).mockResolvedValueOnce(mockGroupedResponse)
      useChannelStore.setState({ currentChannel: mockGroupedResponse.groups[0].channels[0] })

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      // The group containing the current channel starts expanded
      expect(screen.getByText('Now Playing')).toBeInTheDocument()
    })
  })
})
