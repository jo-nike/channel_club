import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AdminModal } from './AdminModal'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import * as api from '@/services/api'

vi.mock('@/services/api', () => ({
  fetchChannels: vi.fn(),
  setCurrentChannel: vi.fn(),
  clearCurrentChannel: vi.fn(),
}))

const mockChannels = [
  { id: '1', name: 'Channel 1', streamUrl: 'http://stream1.m3u8', guideId: '1' },
  { id: '2', name: 'Channel 2', streamUrl: 'http://stream2.m3u8', guideId: '2' },
]

describe('AdminModal', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
  }

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
      role: 'admin',
      isAuthenticated: true,
    })
    vi.mocked(api.fetchChannels).mockResolvedValue(mockChannels)
  })

  describe('Tab rendering', () => {
    it('renders all four tabs (AC #3 - context-agnostic)', () => {
      render(<AdminModal {...defaultProps} />)

      expect(screen.getByRole('tab', { name: /channels/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /active users/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /user access/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /plugins/i })).toBeInTheDocument()
    })

    it('all tabs are always visible regardless of context', () => {
      // Admin modal is now context-agnostic - all tabs visible from any view
      render(<AdminModal {...defaultProps} />)

      const tabs = screen.getAllByRole('tab')
      expect(tabs).toHaveLength(4)
      expect(tabs.map(t => t.textContent)).toEqual(['Channels', 'Active Users', 'User Access', 'Plugins'])
    })
  })

  describe('Tab interaction', () => {
    it('shows Channels tab content by default', () => {
      render(<AdminModal {...defaultProps} />)

      // The Channels tab should be active by default
      const channelsTab = screen.getByRole('tab', { name: /channels/i })
      expect(channelsTab).toHaveAttribute('aria-selected', 'true')
    })

    it('switches to another tab when clicked', () => {
      render(<AdminModal {...defaultProps} />)

      const activeUsersTab = screen.getByRole('tab', { name: /active users/i })
      fireEvent.click(activeUsersTab)

      expect(activeUsersTab).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: /channels/i })).toHaveAttribute('aria-selected', 'false')
    })
  })

  describe('Modal behavior (AC #2)', () => {
    it('renders dialog with proper role', () => {
      render(<AdminModal {...defaultProps} />)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('displays Admin Panel title', () => {
      render(<AdminModal {...defaultProps} />)
      expect(screen.getByText('Admin Panel')).toBeInTheDocument()
    })

    it('does not render when open is false', () => {
      render(<AdminModal {...defaultProps} open={false} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('calls onOpenChange when X button clicked', () => {
      const onOpenChange = vi.fn()
      render(<AdminModal {...defaultProps} onOpenChange={onOpenChange} />)

      // The X button has data-slot="dialog-close" attribute
      const dialogCloseButton = screen
        .getAllByRole('button', { name: /close/i })
        .find((btn) => btn.getAttribute('data-slot') === 'dialog-close')

      expect(dialogCloseButton).toBeDefined()
      fireEvent.click(dialogCloseButton!)
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  describe('Tab accessibility', () => {
    it('tabs have proper roles and attributes', () => {
      render(<AdminModal {...defaultProps} />)

      const tabs = screen.getAllByRole('tab')
      expect(tabs.length).toBe(4)

      // Each tab should have aria-selected attribute
      tabs.forEach(tab => {
        expect(tab).toHaveAttribute('aria-selected')
      })
    })

    it('tablist has proper role', () => {
      render(<AdminModal {...defaultProps} />)
      expect(screen.getByRole('tablist')).toBeInTheDocument()
    })

    it('tabpanel has proper role', () => {
      render(<AdminModal {...defaultProps} />)
      expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    })
  })

  describe('Keyboard navigation', () => {
    it('tabs are focusable', () => {
      render(<AdminModal {...defaultProps} />)

      const channelsTab = screen.getByRole('tab', { name: /channels/i })
      channelsTab.focus()
      expect(channelsTab).toHaveFocus()
    })

    it('activates tab on Enter key', () => {
      render(<AdminModal {...defaultProps} />)

      const activeUsersTab = screen.getByRole('tab', { name: /active users/i })
      activeUsersTab.focus()
      fireEvent.keyDown(activeUsersTab, { key: 'Enter' })

      expect(activeUsersTab).toHaveAttribute('aria-selected', 'true')
    })

    it('activates tab on Space key', () => {
      render(<AdminModal {...defaultProps} />)

      const userAccessTab = screen.getByRole('tab', { name: /user access/i })
      userAccessTab.focus()
      fireEvent.keyDown(userAccessTab, { key: ' ' })

      expect(userAccessTab).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('Channels tab integration (Story 11.2)', () => {
    it('shows ChannelList component in Channels tab (AC #1)', async () => {
      render(<AdminModal {...defaultProps} />)

      // ChannelList fetches channels on mount, should show channel items
      await waitFor(() => {
        expect(screen.getByText('Channel 1')).toBeInTheDocument()
        expect(screen.getByText('Channel 2')).toBeInTheDocument()
      })
    })

    it('shows Clear Channel option at top when a channel is selected (AC #1)', async () => {
      useChannelStore.setState({ currentChannel: mockChannels[0] })

      render(<AdminModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /clear channel/i })).toBeInTheDocument()
      })
    })

    it('does not show Clear Channel option when no channel is selected', async () => {
      useChannelStore.setState({ currentChannel: null })

      render(<AdminModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('Channel 1')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: /clear channel/i })).not.toBeInTheDocument()
    })

    it('closes modal when channel is selected (AC #2)', async () => {
      const onOpenChange = vi.fn()
      vi.mocked(api.setCurrentChannel).mockResolvedValue(mockChannels[0])

      render(<AdminModal {...defaultProps} onOpenChange={onOpenChange} />)

      await waitFor(() => {
        expect(screen.getByText('Channel 1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Channel 1'))

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
    })

    it('closes modal when Clear Channel is clicked (AC #3)', async () => {
      const onOpenChange = vi.fn()
      useChannelStore.setState({ currentChannel: mockChannels[0] })
      vi.mocked(api.clearCurrentChannel).mockResolvedValue(undefined)

      render(<AdminModal {...defaultProps} onOpenChange={onOpenChange} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /clear channel/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /clear channel/i }))

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false)
      })
    })

    it('calls clearCurrentChannel API when Clear Channel is clicked (AC #3)', async () => {
      useChannelStore.setState({ currentChannel: mockChannels[0] })
      vi.mocked(api.clearCurrentChannel).mockResolvedValue(undefined)

      render(<AdminModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /clear channel/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /clear channel/i }))

      await waitFor(() => {
        expect(api.clearCurrentChannel).toHaveBeenCalled()
      })
    })

    it('ChannelList scrolls within modal content area (AC #1)', async () => {
      render(<AdminModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('Channel 1')).toBeInTheDocument()
      })

      // Check that the channels are within a scroll area
      const channelItem = screen.getByText('Channel 1').closest('.channel-item')
      const scrollContainer = channelItem?.closest('[data-radix-scroll-area-viewport]')
      expect(scrollContainer).toBeInTheDocument()
    })
  })

  describe('Placeholder content', () => {
    it('shows placeholder content for Active Users tab', () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('tab', { name: /active users/i }))
      expect(screen.getByText(/active users will appear here/i)).toBeInTheDocument()
    })

    it('shows placeholder content for User Access tab', () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('tab', { name: /user access/i }))
      expect(screen.getByText(/user access controls will appear here/i)).toBeInTheDocument()
    })

    it('shows placeholder content for Plugins tab', () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('tab', { name: /plugins/i }))
      expect(screen.getByText(/plugins configuration will appear here/i)).toBeInTheDocument()
    })
  })
})
