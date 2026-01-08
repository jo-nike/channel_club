import { render, screen, fireEvent, waitFor } from '@/test/utils'
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

// Mock useActiveUsers for Active Users tab
const mockActiveUsersData = {
  liveUsers: [
    {
      username: 'testUser',
      channel: 'Channel 1',
      connectedSince: '2026-01-04T10:00:00Z',
      bitrateMbps: 8.5,
    },
  ],
  ersatztvUsers: [],
  totals: {
    liveCount: 1,
    ersatztvCount: 0,
    liveBitrateMbps: 8.5,
    ersatztvBitrateMbps: 0,
    totalBitrateMbps: 8.5,
  },
}

vi.mock('@/hooks/useActiveUsers', () => ({
  useActiveUsers: () => ({
    data: mockActiveUsersData,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

// Mock useSystemStatus for Status tab
const mockSystemStatusData = {
  ersatztv: {
    name: 'ErsatzTV',
    online: true,
    lastChecked: '2026-01-04T12:00:00Z',
    error: null,
    activeSessions: 2,
    sessions: [],
  },
  dispatcharr: {
    name: 'Dispatcharr',
    online: true,
    lastChecked: '2026-01-04T12:00:00Z',
    error: null,
    activeStreams: 5,
    totalViewers: 10,
  },
}

vi.mock('@/hooks/useSystemStatus', () => ({
  useSystemStatus: () => ({
    data: mockSystemStatusData,
    loading: false,
    error: null,
    lastUpdated: new Date('2026-01-04T12:00:00Z'),
    isRefreshing: false,
    refetch: vi.fn(),
  }),
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
    it('renders all five tabs (AC #3 - context-agnostic)', () => {
      render(<AdminModal {...defaultProps} />)

      expect(screen.getByRole('tab', { name: /channels/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /active users/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /user access/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /plugins/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /status/i })).toBeInTheDocument()
    })

    it('all tabs are always visible regardless of context', () => {
      // Admin modal is now context-agnostic - all tabs visible from any view
      render(<AdminModal {...defaultProps} />)

      const tabs = screen.getAllByRole('tab')
      expect(tabs).toHaveLength(5)
      expect(tabs.map(t => t.textContent)).toEqual(['Channels', 'Active Users', 'User Access', 'Plugins', 'Status'])
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
      expect(tabs.length).toBe(5)

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

      // Check that the channels are within a scrollable tabpanel container
      const tabpanel = screen.getByRole('tabpanel')
      expect(tabpanel).toHaveClass('overflow-y-auto')
    })
  })

  describe('Active Users tab (Story 11.6)', () => {
    it('shows ActiveUsersTab component content', async () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('tab', { name: /active users/i }))

      // Should show Live TV section
      await waitFor(() => {
        expect(screen.getByText('Live TV')).toBeInTheDocument()
      })

      // Should show ErsatzTV section
      expect(screen.getByText('ErsatzTV')).toBeInTheDocument()
    })

    it('shows user information in Active Users tab', async () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('tab', { name: /active users/i }))

      await waitFor(() => {
        expect(screen.getByText('testUser')).toBeInTheDocument()
      })
    })
  })

  describe('Placeholder content (Story 11.7)', () => {
    it('shows placeholder content for User Access tab (AC #1)', () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('tab', { name: /user access/i }))
      // Check for the placeholder message which is unique
      expect(screen.getByText('User access management coming soon')).toBeInTheDocument()
      // Check for the description text
      expect(screen.getByText(/Manage user permissions/)).toBeInTheDocument()
    })

    it('shows placeholder content for Plugins tab (AC #2)', () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('tab', { name: /plugins/i }))
      // Check for the placeholder message which is unique
      expect(screen.getByText('Plugins management coming soon')).toBeInTheDocument()
      // Check for the description text
      expect(screen.getByText(/Extend functionality/)).toBeInTheDocument()
    })

    it('shows StatusTab content for Status tab (Story 12.2)', () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('tab', { name: /status/i }))
      // Check for StatusTab content - ErsatzTV and Dispatcharr cards
      expect(screen.getByText('ErsatzTV')).toBeInTheDocument()
      expect(screen.getByText('Dispatcharr')).toBeInTheDocument()
      // Check for status header
      expect(screen.getByText('System Status')).toBeInTheDocument()
    })

    it('shows icon in placeholder tabs', () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.click(screen.getByRole('tab', { name: /user access/i }))
      // Look for the SVG icon inside tabpanel
      const tabpanel = screen.getByRole('tabpanel')
      expect(tabpanel.querySelector('svg')).toBeInTheDocument()
    })
  })
})
