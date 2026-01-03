import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChannelList } from './ChannelList'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  fetchChannels: vi.fn(),
  setCurrentChannel: vi.fn(),
}))

const mockChannels = [
  { id: '1', name: 'Channel 1', streamUrl: 'http://stream1.m3u8', guideId: '1' },
  { id: '2', name: 'Channel 2', streamUrl: 'http://stream2.m3u8', guideId: '2' },
]

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
  })

  describe('Loading state', () => {
    it('should render loading skeletons when isLoading is true', () => {
      // Directly set loading state to test skeleton rendering
      useChannelStore.setState({
        channels: [],
        currentChannel: null,
        isLoading: true,
        error: null,
      })

      // Don't trigger useEffect fetch by mocking it
      vi.mocked(api.fetchChannels).mockResolvedValueOnce([])

      const { container, rerender } = render(<ChannelList />)

      // Force re-render with loading state (before useEffect completes)
      useChannelStore.setState({ isLoading: true })
      rerender(<ChannelList />)

      // Check for skeleton elements (they have rounded-lg and h-14 classes)
      const skeletonContainer = container.querySelector('.flex.flex-col.gap-2.p-4')
      expect(skeletonContainer).toBeInTheDocument()
    })
  })

  describe('Successful fetch', () => {
    it('should render channels after successful fetch', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Channel 1')).toBeInTheDocument()
        expect(screen.getByText('Channel 2')).toBeInTheDocument()
      })
    })

    it('should call fetchChannels on mount', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)

      render(<ChannelList />)

      expect(api.fetchChannels).toHaveBeenCalledTimes(1)
    })
  })

  describe('Error state', () => {
    it('should render error message on failed fetch', async () => {
      vi.mocked(api.fetchChannels).mockRejectedValueOnce(new Error('Network error'))

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText(/unable to load channels/i)).toBeInTheDocument()
      })
    })

    it('should show retry button on error', async () => {
      vi.mocked(api.fetchChannels).mockRejectedValueOnce(new Error('Network error'))

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
      })
    })

    it('should retry fetch when retry button clicked', async () => {
      vi.mocked(api.fetchChannels)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockChannels)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /retry/i }))

      await waitFor(() => {
        expect(api.fetchChannels).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('Empty state', () => {
    it('should render empty message when no channels', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce([])

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText(/no channels available/i)).toBeInTheDocument()
      })
    })
  })

  describe('Admin user', () => {
    beforeEach(() => {
      useAuthStore.setState({ role: 'admin' })
      vi.mocked(api.setCurrentChannel).mockResolvedValue(mockChannels[0])
    })

    it('should render option items for admin', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)

      render(<ChannelList />)

      await waitFor(() => {
        const items = screen.getAllByRole('option')
        expect(items.length).toBe(mockChannels.length)
      })
    })

    it('should select channel when admin clicks', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Channel 1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Channel 1'))

      await waitFor(() => {
        const state = useChannelStore.getState()
        expect(state.currentChannel).toEqual(mockChannels[0])
      })
    })

    it('should call setCurrentChannel API when admin selects channel', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Channel 1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Channel 1'))

      await waitFor(() => {
        expect(api.setCurrentChannel).toHaveBeenCalledWith(mockChannels[0])
      })
    })

    it('should support keyboard navigation for admin', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Channel 1')).toBeInTheDocument()
      })

      // Keyboard navigation is now handled by the listbox container
      const listbox = screen.getByRole('listbox')
      fireEvent.keyDown(listbox, { key: 'Enter' })

      await waitFor(() => {
        const state = useChannelStore.getState()
        expect(state.currentChannel).toEqual(mockChannels[0])
      })
    })

    it('should revert selection on API failure', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)
      vi.mocked(api.setCurrentChannel).mockRejectedValueOnce(new Error('API error'))
      useChannelStore.setState({ currentChannel: mockChannels[1] })

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Channel 1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Channel 1'))

      // Wait for the optimistic update to revert
      await waitFor(() => {
        const state = useChannelStore.getState()
        expect(state.currentChannel).toEqual(mockChannels[1])
      })
    })

    it('should close sidebar drawer when channel is selected (AC: #4)', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)
      useUIStore.setState({ isSidebarOpen: true })

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Channel 1')).toBeInTheDocument()
      })

      // Verify sidebar is open before clicking
      expect(useUIStore.getState().isSidebarOpen).toBe(true)

      fireEvent.click(screen.getByText('Channel 1'))

      // Sidebar should auto-close after channel selection
      await waitFor(() => {
        expect(useUIStore.getState().isSidebarOpen).toBe(false)
      })
    })
  })

  describe('Viewer user', () => {
    beforeEach(() => {
      useAuthStore.setState({ role: 'viewer' })
    })

    it('should render read-only items for viewer', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Channel 1')).toBeInTheDocument()
      })

      // Viewer sees options but clicking doesn't select
      const options = screen.getAllByRole('option')
      expect(options.length).toBe(mockChannels.length)
    })
  })

  describe('Current channel indicator', () => {
    it('should show "Now Playing" for current channel', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)
      useChannelStore.setState({ currentChannel: mockChannels[0] })

      render(<ChannelList />)

      await waitFor(() => {
        expect(screen.getByText('Now Playing')).toBeInTheDocument()
      })
    })

    it('should highlight current channel with visual indicator', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)
      useChannelStore.setState({ currentChannel: mockChannels[0] })

      render(<ChannelList />)

      await waitFor(() => {
        const channelItem = screen.getByText('Channel 1').closest('div')
        expect(channelItem?.className).toContain('border-primary')
      })
    })
  })

  describe('10-foot UI compliance', () => {
    it('should have large text for TV readability', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)

      render(<ChannelList />)

      await waitFor(() => {
        const channelItem = screen.getByText('Channel 1').closest('div')
        expect(channelItem?.className).toContain('text-lg')
      })
    })

    it('should have minimum touch target height', async () => {
      vi.mocked(api.fetchChannels).mockResolvedValueOnce(mockChannels)

      render(<ChannelList />)

      await waitFor(() => {
        const channelItem = screen.getByText('Channel 1').closest('div')
        expect(channelItem?.className).toContain('min-h-[56px]')
      })
    })
  })
})
