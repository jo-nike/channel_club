import { render, screen, fireEvent, waitFor, act, within } from '@/test/utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { AdminModal } from './AdminModal'
import { focusOverrides } from '@/test/focus'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import * as api from '@/services/api'
import { PLEX_PENDING_PIN_KEY } from '@/services/plexAuth'
import { useSettingsStore } from '@/stores/settingsStore'

vi.mock('@/services/api', () => ({
  fetchGroupedChannels: vi.fn(),
  fetchNowPlayingAll: vi.fn(),
  fetchNowPlaying: vi.fn(),
  setCurrentChannel: vi.fn(),
  clearCurrentChannel: vi.fn(),
  fetchAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
}))

// The Server tab has its own tests: here it is a draft to keep or lose
vi.mock('@/components/admin/server/ServerTab', () => ({
  ServerTab: () => <input aria-label="Unsaved server setting" />,
}))

// Mock useActiveUsers for the People tab
const mockActiveUsersData = {
  liveUsers: [
    {
      username: 'testUser',
      channel: 'Channel 1',
      onLive: true,
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
  epg: {
    name: 'Guide data (XMLTV)',
    online: true,
    lastChecked: '2026-01-04T12:00:00Z',
    error: null,
    stale: false,
    channelCount: 109,
    programmeCount: 5065,
    lastAttemptAt: '2026-01-04T11:55:00Z',
    lastSuccessAt: '2026-01-04T11:55:00Z',
    nextRetryAt: null,
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

const mockGroupedChannelsResponse = {
  groups: [
    {
      id: 1,
      name: 'Sports',
      channelCount: 2,
      channels: mockChannels,
    },
  ],
  ungrouped: [],
}

describe('AdminModal', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // NHL scores on, as the server's switch would have them for these tests
    useSettingsStore.setState({ serverFeatures: { chat: false, gif: false, nhl: true } })
    // No Plex sign-in waiting, so no test opens on the Server tab by accident
    sessionStorage.clear()
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
    vi.mocked(api.fetchGroupedChannels).mockResolvedValue(mockGroupedChannelsResponse)
    vi.mocked(api.fetchNowPlayingAll).mockResolvedValue({})
    vi.mocked(api.fetchNowPlaying).mockResolvedValue({ channelId: '1', currentProgram: null })
    vi.mocked(api.fetchAppSettings).mockResolvedValue({ userChannelSelection: false })
    vi.mocked(api.updateAppSettings).mockResolvedValue({ userChannelSelection: true })
  })

  describe('Tab rendering', () => {
    it('has no NHL tab while the server has NHL scores off, and leaves it for Channels if it was open', () => {
      render(<AdminModal {...defaultProps} />)
      const nhlTab = screen.getByRole('tab', { name: /nhl/i })
      nhlTab.focus()
      fireEvent.keyDown(nhlTab, { key: 'Enter' })
      expect(nhlTab).toHaveAttribute('aria-selected', 'true')

      act(() => useSettingsStore.setState({ serverFeatures: { chat: false, gif: false, nhl: false } }))

      expect(screen.queryByRole('tab', { name: /nhl/i })).not.toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /channels/i })).toHaveAttribute('aria-selected', 'true')
    })

    it('renders all six tabs (AC #3 - context-agnostic)', () => {
      render(<AdminModal {...defaultProps} />)

      expect(screen.getByRole('tab', { name: /channels/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /people/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /chat/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /nhl/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /status/i })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: /server/i })).toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: /plugins/i })).not.toBeInTheDocument()
      // Active Users and User Access are merged into People
      expect(screen.queryByRole('tab', { name: /active users/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: /user access/i })).not.toBeInTheDocument()
    })

    it('all tabs are always visible regardless of context', () => {
      // Admin modal is now context-agnostic - all tabs visible from any view
      render(<AdminModal {...defaultProps} />)

      const tabs = screen.getAllByRole('tab')
      expect(tabs).toHaveLength(6)
      expect(tabs.map(t => t.textContent)).toEqual(['Channels', 'People', 'Chat', 'NHL', 'Status', 'Server'])
    })
  })

  describe('Tab interaction', () => {
    it('shows Channels tab content by default', () => {
      render(<AdminModal {...defaultProps} />)

      // The Channels tab should be active by default
      const channelsTab = screen.getByRole('tab', { name: /channels/i })
      expect(channelsTab).toHaveAttribute('aria-selected', 'true')
    })

    it('switches to another tab when pressed', () => {
      render(<AdminModal {...defaultProps} />)

      const peopleTab = screen.getByRole('tab', { name: /people/i })
      // Radix Tabs activate on mousedown (the press), not on the later click
      fireEvent.mouseDown(peopleTab)

      expect(peopleTab).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tab', { name: /channels/i })).toHaveAttribute('aria-selected', 'false')
    })
  })

  describe('Server tab', () => {
    const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }))

    it('keeps its unsaved changes while another tab is open, and drops them when the panel closes', () => {
      function Panel() {
        const [open, setOpen] = useState(true)
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>
              Host
            </button>
            <AdminModal open={open} onOpenChange={setOpen} />
          </>
        )
      }
      render(<Panel />)
      expect(screen.queryByLabelText('Unsaved server setting')).not.toBeInTheDocument()

      openTab('Server')
      fireEvent.change(screen.getByLabelText('Unsaved server setting'), { target: { value: 'typed' } })
      openTab('Status')
      expect(screen.getByRole('tabpanel', { hidden: true, name: 'Server' })).toHaveClass('data-[state=inactive]:hidden')
      openTab('Server')
      expect(screen.getByLabelText('Unsaved server setting')).toHaveValue('typed')

      // Closed from another tab, then opened again: the Server tab waits to be asked for
      openTab('Status')
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      fireEvent.click(screen.getByRole('button', { name: 'Host' }))
      expect(screen.queryByLabelText('Unsaved server setting')).not.toBeInTheDocument()
      openTab('Server')
      expect(screen.getByLabelText('Unsaved server setting')).toHaveValue('')
    })

    it('scrolls a focused control clear of its sticky Save rows', () => {
      render(<AdminModal {...defaultProps} />)
      openTab('Server')
      expect(screen.getByRole('tabpanel', { name: 'Server' })).toHaveClass('scroll-pb-22')
    })

    it('opens on the Server tab when the page is back from a Plex sign-in it started', () => {
      sessionStorage.setItem('channel-club:server-tab-stash', JSON.stringify({ draft: { values: {}, sources: {} }, relinking: true }))
      sessionStorage.setItem(PLEX_PENDING_PIN_KEY, '42')

      render(<AdminModal {...defaultProps} />)

      expect(screen.getByRole('tab', { name: 'Server' })).toHaveAttribute('aria-selected', 'true')
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

    it('is anchored near the top with a fixed height, so the header stays put across tabs', () => {
      render(<AdminModal {...defaultProps} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveClass('top-4', 'sm:top-[5dvh]', 'translate-y-0', 'h-[min(88dvh,780px)]')
      // tailwind-merge drops the dialog's default vertical centring
      expect(dialog).not.toHaveClass('top-[50%]')
      expect(dialog).not.toHaveClass('translate-y-[-50%]')
      // The panel scrolls inside the fixed frame instead of resizing it
      expect(screen.getByRole('tabpanel')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
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

  // The Host button opens it by state, with no Radix trigger to return focus to
  describe('Focus on close', () => {
    function Header() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Host
          </button>
          <AdminModal open={open} onOpenChange={setOpen} />
        </>
      )
    }

    it('returns focus to the button that opened it when Escape closes it', async () => {
      render(<Header />)
      const host = screen.getByRole('button', { name: 'Host' })
      host.focus()
      fireEvent.click(host)
      const dialog = screen.getByRole('dialog')
      // Radix moves focus on the next tick
      await waitFor(() => expect(host).not.toHaveFocus())

      fireEvent.keyDown(dialog, { key: 'Escape' })

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await waitFor(() => expect(host).toHaveFocus())
    })
  })

  describe('Tab accessibility', () => {
    it('tabs have proper roles and attributes', () => {
      render(<AdminModal {...defaultProps} />)

      const tabs = screen.getAllByRole('tab')
      expect(tabs.length).toBe(6)

      // Each tab should have aria-selected attribute
      tabs.forEach(tab => {
        expect(tab).toHaveAttribute('aria-selected')
      })
    })

    it('insets each tab\'s keyboard outline so the scrolling tab strip does not clip it', () => {
      render(<AdminModal {...defaultProps} />)

      for (const tab of screen.getAllByRole('tab')) {
        expect(tab).toHaveClass('focus-visible:-outline-offset-2')
        expect(focusOverrides(tab)).toEqual([])
      }
    })

    it('tablist has proper role', () => {
      render(<AdminModal {...defaultProps} />)
      expect(screen.getByRole('tablist', { name: 'Admin sections' })).toBeInTheDocument()
    })

    it('tabpanel has proper role', () => {
      render(<AdminModal {...defaultProps} />)
      expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    })

    it('links each tab to its panel with aria-controls and aria-labelledby', () => {
      render(<AdminModal {...defaultProps} />)

      const controls = screen.getAllByRole('tab').map(tab => tab.getAttribute('aria-controls'))
      expect(controls.every(Boolean)).toBe(true)
      expect(new Set(controls).size).toBe(controls.length)

      for (const name of ['Channels', 'Status']) {
        const tab = screen.getByRole('tab', { name })
        fireEvent.mouseDown(tab)

        const panel = screen.getByRole('tabpanel')
        expect(tab).toHaveAttribute('aria-controls', panel.id)
        expect(panel).toHaveAttribute('aria-labelledby', tab.id)
      }
    })
  })

  describe('Keyboard navigation', () => {
    it('tabs are focusable', () => {
      render(<AdminModal {...defaultProps} />)

      const channelsTab = screen.getByRole('tab', { name: /channels/i })
      channelsTab.focus()
      expect(channelsTab).toHaveFocus()
    })

    it('arrow keys, Home and End move focus with a single tab stop (roving tabindex)', async () => {
      render(<AdminModal {...defaultProps} />)
      const tabs = screen.getAllByRole('tab')
      const tabStops = () => tabs.filter(tab => tab.getAttribute('tabindex') === '0')

      act(() => tabs[0].focus())
      fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
      await waitFor(() => expect(tabs[1]).toHaveFocus())
      expect(tabStops()).toEqual([tabs[1]])

      fireEvent.keyDown(tabs[1], { key: 'End' })
      await waitFor(() => expect(tabs[tabs.length - 1]).toHaveFocus())
      expect(tabStops()).toEqual([tabs[tabs.length - 1]])

      fireEvent.keyDown(tabs[tabs.length - 1], { key: 'Home' })
      await waitFor(() => expect(tabs[0]).toHaveFocus())

      // Wraps from the first tab to the last
      fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' })
      await waitFor(() => expect(tabs[tabs.length - 1]).toHaveFocus())
      expect(tabStops()).toEqual([tabs[tabs.length - 1]])
    })

    it('arrowing onto a tab does not open it (manual activation)', async () => {
      render(<AdminModal {...defaultProps} />)
      const channelsTab = screen.getByRole('tab', { name: /channels/i })
      const peopleTab = screen.getByRole('tab', { name: /people/i })

      act(() => channelsTab.focus())
      fireEvent.keyDown(channelsTab, { key: 'ArrowRight' })
      await waitFor(() => expect(peopleTab).toHaveFocus())

      expect(peopleTab).toHaveAttribute('aria-selected', 'false')
      expect(channelsTab).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', channelsTab.id)
      // The People panel (and its active-user polling) is not mounted
      expect(screen.queryByText('testUser')).not.toBeInTheDocument()
    })

    it('activates tab on Enter key', () => {
      render(<AdminModal {...defaultProps} />)

      const peopleTab = screen.getByRole('tab', { name: /people/i })
      peopleTab.focus()
      fireEvent.keyDown(peopleTab, { key: 'Enter' })

      expect(peopleTab).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', peopleTab.id)
      expect(screen.getByText('testUser')).toBeInTheDocument()
    })

    it('activates tab on Space key', () => {
      render(<AdminModal {...defaultProps} />)

      const statusTab = screen.getByRole('tab', { name: /status/i })
      statusTab.focus()
      fireEvent.keyDown(statusTab, { key: ' ' })

      expect(statusTab).toHaveAttribute('aria-selected', 'true')
    })
  })

  describe('Channels tab integration (Story 11.2)', () => {
    it('shows ChannelList component in Channels tab (AC #1)', async () => {
      render(<AdminModal {...defaultProps} />)

      // ChannelList fetches grouped channels on mount, should show group headers
      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      // Expand the group to see channels
      fireEvent.click(screen.getByText('Sports'))
      expect(screen.getByText('Channel 1')).toBeInTheDocument()
      expect(screen.getByText('Channel 2')).toBeInTheDocument()
    })

    it('opens on the On-air card, above the channel list', async () => {
      useChannelStore.setState({ currentChannel: mockChannels[0] })

      render(<AdminModal {...defaultProps} />)

      const panel = screen.getByRole('tabpanel')
      const card = within(panel).getByRole('region', { name: 'On air' })
      expect(within(card).getByText('Channel 1')).toBeInTheDocument()
      expect(within(card).getByText('1 watching')).toBeInTheDocument()

      const list = await within(panel).findByRole('listbox', { name: 'Channel list' })
      // The card comes first in the scroll container
      expect(card.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it("keeps focused rows clear of the sticky card with a scroll margin of the card's height", async () => {
      // jsdom has no layout: capture the card's observer so the test can drive it
      let resize: () => void = () => {}
      class CapturingResizeObserver implements ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resize = () => callback([], this)
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
      vi.stubGlobal('ResizeObserver', CapturingResizeObserver)
      useChannelStore.setState({ currentChannel: mockChannels[0] })

      try {
        render(<AdminModal {...defaultProps} />)

        const panel = screen.getByRole('tabpanel')
        const card = within(panel).getByRole('region', { name: 'On air' })
        const list = await within(panel).findByRole('listbox', { name: 'Channel list' })
        const underCard = list.closest<HTMLElement>('.\\*\\*\\:scroll-mt-\\(--on-air-height\\)')
        expect(underCard).not.toBeNull()
        // Only the list: the card's own buttons don't move when focused
        expect(underCard).not.toContainElement(card)

        Object.defineProperty(card, 'offsetHeight', { configurable: true, value: 152 })
        act(() => resize())
        expect(underCard!.style.getPropertyValue('--on-air-height')).toBe('152px')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('says nothing is on live TV when no channel is selected', () => {
      render(<AdminModal {...defaultProps} />)

      expect(within(screen.getByRole('region', { name: 'On air' })).getByText('Nothing on live TV')).toBeInTheDocument()
    })

    it('shows the On-air card only on the Channels tab', () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.mouseDown(screen.getByRole('tab', { name: /status/i }))

      expect(screen.queryByRole('region', { name: 'On air' })).not.toBeInTheDocument()
    })

    it('shows Stop live TV when a channel is selected (AC #1)', async () => {
      useChannelStore.setState({ currentChannel: mockChannels[0] })

      render(<AdminModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Stop live TV…' })).toBeInTheDocument()
      })
    })

    it('does not show Stop live TV when no channel is selected', async () => {
      useChannelStore.setState({ currentChannel: null })

      render(<AdminModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      expect(screen.queryByRole('button', { name: /stop live tv/i })).not.toBeInTheDocument()
    })

    it('keeps modal open on channel select', async () => {
      const onOpenChange = vi.fn()
      vi.mocked(api.setCurrentChannel).mockResolvedValue(mockChannels[0])

      render(<AdminModal {...defaultProps} onOpenChange={onOpenChange} />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      // Expand group and select channel
      fireEvent.click(screen.getByText('Sports'))
      fireEvent.click(screen.getByText('Channel 1'))

      // Allow any pending async state updates to settle
      await waitFor(() => {
        expect(vi.mocked(api.setCurrentChannel)).toHaveBeenCalled()
      })

      // Modal should remain open: onOpenChange must not be called with false
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
    })

    it('keeps modal open when live TV is stopped', async () => {
      const onOpenChange = vi.fn()
      useChannelStore.setState({ currentChannel: mockChannels[0] })
      vi.mocked(api.clearCurrentChannel).mockResolvedValue(undefined)

      render(<AdminModal {...defaultProps} onOpenChange={onOpenChange} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Stop live TV…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV' }))

      // Allow any pending async state updates to settle
      await waitFor(() => {
        expect(vi.mocked(api.clearCurrentChannel)).toHaveBeenCalled()
      })

      // Modal should remain open: onOpenChange must not be called with false
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
      expect(screen.getByText('Admin Panel')).toBeInTheDocument()
    })

    it('calls clearCurrentChannel API only after Stop live TV is confirmed (AC #3)', async () => {
      useChannelStore.setState({ currentChannel: mockChannels[0] })
      vi.mocked(api.clearCurrentChannel).mockResolvedValue(undefined)

      render(<AdminModal {...defaultProps} />)

      fireEvent.click(await screen.findByRole('button', { name: 'Stop live TV…' }))

      expect(screen.getByRole('dialog', { name: 'Stop live TV for everyone?' })).toBeInTheDocument()
      expect(api.clearCurrentChannel).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Stop live TV' }))

      await waitFor(() => {
        expect(api.clearCurrentChannel).toHaveBeenCalledTimes(1)
      })
    })

    it('ChannelList scrolls within modal content area (AC #1)', async () => {
      render(<AdminModal {...defaultProps} />)

      await waitFor(() => {
        expect(screen.getByText('Sports')).toBeInTheDocument()
      })

      // Check that the channels are within a scrollable tabpanel container
      const tabpanel = screen.getByRole('tabpanel')
      expect(tabpanel).toHaveClass('overflow-y-auto')
    })
  })

  describe('People tab (Story 11.6)', () => {
    it('shows ActiveUsersTab component content', async () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.mouseDown(screen.getByRole('tab', { name: /people/i }))

      // Should show Live TV section
      await waitFor(() => {
        expect(screen.getByText('Live TV')).toBeInTheDocument()
      })

      // Should show ErsatzTV section
      expect(screen.getByText('ErsatzTV')).toBeInTheDocument()
    })

    it('shows user information in the People tab', async () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.mouseDown(screen.getByRole('tab', { name: /people/i }))

      await waitFor(() => {
        expect(screen.getByText('testUser')).toBeInTheDocument()
      })
    })
  })

  describe('Tab content (Story 11.7)', () => {
    it('shows the live channel selection switch in the People tab', () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.mouseDown(screen.getByRole('tab', { name: /people/i }))

      expect(screen.getByText('Live Channel Selection')).toBeInTheDocument()
      expect(
        screen.getByRole('switch', { name: 'Users can set the live channel' })
      ).toHaveAttribute('aria-checked', 'false')
    })

    it('shows StatusTab content for Status tab (Story 12.2)', () => {
      render(<AdminModal {...defaultProps} />)

      fireEvent.mouseDown(screen.getByRole('tab', { name: /status/i }))
      // Check for StatusTab content - ErsatzTV and Dispatcharr cards
      expect(screen.getByText('ErsatzTV')).toBeInTheDocument()
      expect(screen.getByText('Dispatcharr')).toBeInTheDocument()
      // Check for status header
      expect(screen.getByText('System Status')).toBeInTheDocument()
    })
  })
})
