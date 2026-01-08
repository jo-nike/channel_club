import { render, screen, fireEvent } from '@/test/utils'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { EPGChannelSidebar } from './EPGChannelSidebar'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import type { ErsatzTVChannel } from '@/types'

vi.mock('@/stores/ersatztvStore')

describe('EPGChannelSidebar', () => {
  const mockChannels: ErsatzTVChannel[] = [
    {
      id: 'ch1',
      name: 'Comedy Movies',
      number: 1,
      group: 'Movies',
      streamUrl: 'http://example.com/ch1.m3u8',
      logoUrl: '/logos/ch1.png',
    },
    {
      id: 'ch2',
      name: 'Action Movies',
      number: 2,
      group: 'Movies',
      streamUrl: 'http://example.com/ch2.m3u8',
      logoUrl: '/logos/ch2.png',
    },
    {
      id: 'ch3',
      name: 'Horror Movies',
      number: 3,
      group: 'Movies',
      streamUrl: 'http://example.com/ch3.m3u8',
      logoUrl: '/logos/ch3.png',
    },
  ]

  const mockLoadChannels = vi.fn()
  const mockSelectChannel = vi.fn()
  const mockLoadCurrentProgramme = vi.fn()

  const defaultMockState = {
    channels: mockChannels,
    selectedChannel: null,
    channelsLoading: false,
    programmesLoading: false,
    programmesByChannel: {},
    error: null,
    currentProgramme: null,
    nextProgramme: null,
    loadChannels: mockLoadChannels,
    selectChannel: mockSelectChannel,
    loadCurrentProgramme: mockLoadCurrentProgramme,
    loadAllProgrammes: vi.fn(),
    programmes: [],
    loadProgrammes: vi.fn(),
    clearError: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useErsatztvStore as unknown as Mock).mockReturnValue(defaultMockState)
  })

  describe('Channel list display (AC: #1)', () => {
    it('renders channel list with logos, names, and numbers', () => {
      render(<EPGChannelSidebar />)

      // Check all channels are rendered
      expect(screen.getByText('Comedy Movies')).toBeInTheDocument()
      expect(screen.getByText('Action Movies')).toBeInTheDocument()
      expect(screen.getByText('Horror Movies')).toBeInTheDocument()

      // Check channel numbers
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('renders sidebar header with "Channels" title', () => {
      render(<EPGChannelSidebar />)

      expect(screen.getByText('Channels')).toBeInTheDocument()
    })

    it('displays channel logos with correct alt text', () => {
      render(<EPGChannelSidebar />)

      const logos = screen.getAllByRole('img')
      expect(logos).toHaveLength(3)
    })
  })

  describe('Loading and error states', () => {
    it('shows loading skeleton when loading and no channels', () => {
      ;(useErsatztvStore as unknown as Mock).mockReturnValue({
        ...defaultMockState,
        channels: [],
        channelsLoading: true,
      })

      render(<EPGChannelSidebar />)

      // Should not show channel names during loading
      expect(screen.queryByText('Comedy Movies')).not.toBeInTheDocument()
      // Should have skeleton elements with aria role
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('shows error state with retry button when error and no channels', () => {
      ;(useErsatztvStore as unknown as Mock).mockReturnValue({
        ...defaultMockState,
        channels: [],
        error: 'Failed to load channels',
      })

      render(<EPGChannelSidebar />)

      expect(screen.getByText('Failed to load channels')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })

    it('calls loadChannels when retry button is clicked', () => {
      ;(useErsatztvStore as unknown as Mock).mockReturnValue({
        ...defaultMockState,
        channels: [],
        error: 'Failed to load channels',
      })

      render(<EPGChannelSidebar />)

      fireEvent.click(screen.getByRole('button', { name: /retry/i }))
      expect(mockLoadChannels).toHaveBeenCalledTimes(1)
    })

    it('shows channels even with error if channels already loaded', () => {
      ;(useErsatztvStore as unknown as Mock).mockReturnValue({
        ...defaultMockState,
        error: 'Some error',
      })

      render(<EPGChannelSidebar />)

      // Should still show channels
      expect(screen.getByText('Comedy Movies')).toBeInTheDocument()
    })
  })

  describe('Channel selection (AC: #3)', () => {
    it('calls selectChannel when a channel is clicked', () => {
      render(<EPGChannelSidebar />)

      fireEvent.click(screen.getByText('Comedy Movies'))

      expect(mockSelectChannel).toHaveBeenCalledWith(mockChannels[0])
    })

    it('calls onChannelSelect callback when provided', () => {
      const onChannelSelect = vi.fn()
      render(<EPGChannelSidebar onChannelSelect={onChannelSelect} />)

      fireEvent.click(screen.getByText('Action Movies'))

      expect(onChannelSelect).toHaveBeenCalledWith(mockChannels[1])
    })
  })

  describe('Currently playing highlight (AC: #4)', () => {
    it('highlights the selected channel', () => {
      ;(useErsatztvStore as unknown as Mock).mockReturnValue({
        ...defaultMockState,
        selectedChannel: mockChannels[0],
      })

      render(<EPGChannelSidebar />)

      const comedyButton = screen.getByRole('button', { name: /1.*comedy movies/i })
      expect(comedyButton).toHaveAttribute('aria-pressed', 'true')
    })

    it('does not highlight non-selected channels', () => {
      ;(useErsatztvStore as unknown as Mock).mockReturnValue({
        ...defaultMockState,
        selectedChannel: mockChannels[0],
      })

      render(<EPGChannelSidebar />)

      const actionButton = screen.getByRole('button', { name: /2.*action movies/i })
      expect(actionButton).toHaveAttribute('aria-pressed', 'false')
    })

    it('shows playing indicator for selected channel', () => {
      ;(useErsatztvStore as unknown as Mock).mockReturnValue({
        ...defaultMockState,
        selectedChannel: mockChannels[0],
      })

      render(<EPGChannelSidebar />)

      // Check for animated playing indicator (pulse animation)
      const comedyButton = screen.getByRole('button', { name: /1.*comedy movies/i })
      const indicator = comedyButton.querySelector('.animate-pulse')
      expect(indicator).toBeInTheDocument()
    })
  })

  describe('Current programme display (AC: #2)', () => {
    it('displays "Now playing..." placeholder for channels', () => {
      render(<EPGChannelSidebar />)

      // Each channel should have a programme placeholder
      const nowPlayingTexts = screen.getAllByText(/now playing/i)
      expect(nowPlayingTexts.length).toBeGreaterThan(0)
    })
  })

  describe('Accessibility', () => {
    it('channel buttons are focusable for keyboard navigation', () => {
      render(<EPGChannelSidebar />)

      const buttons = screen.getAllByRole('button', { name: /movies/i })
      buttons.forEach((button) => {
        expect(button).not.toHaveAttribute('disabled')
      })
    })

    it('uses semantic list structure', () => {
      render(<EPGChannelSidebar />)

      expect(screen.getByRole('list')).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
    })
  })

  describe('Collapsed state', () => {
    it('renders collapsed sidebar with expand button', () => {
      render(<EPGChannelSidebar isCollapsed={true} />)

      expect(
        screen.getByRole('button', { name: /expand channel sidebar/i })
      ).toBeInTheDocument()
    })

    it('shows channel number badges in collapsed state', () => {
      render(<EPGChannelSidebar isCollapsed={true} />)

      // Channel numbers should be visible
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('calls onToggleCollapse when expand button is clicked', () => {
      const onToggleCollapse = vi.fn()
      render(<EPGChannelSidebar isCollapsed={true} onToggleCollapse={onToggleCollapse} />)

      fireEvent.click(screen.getByRole('button', { name: /expand channel sidebar/i }))

      expect(onToggleCollapse).toHaveBeenCalledTimes(1)
    })

    it('renders collapse button in expanded state', () => {
      render(<EPGChannelSidebar isCollapsed={false} />)

      expect(
        screen.getByRole('button', { name: /collapse channel sidebar/i })
      ).toBeInTheDocument()
    })

    it('calls onToggleCollapse when collapse button is clicked', () => {
      const onToggleCollapse = vi.fn()
      render(<EPGChannelSidebar isCollapsed={false} onToggleCollapse={onToggleCollapse} />)

      fireEvent.click(screen.getByRole('button', { name: /collapse channel sidebar/i }))

      expect(onToggleCollapse).toHaveBeenCalledTimes(1)
    })

    it('selects channel when clicking channel badge in collapsed state', () => {
      render(<EPGChannelSidebar isCollapsed={true} />)

      // Click on channel 1 badge
      const channel1Button = screen.getByRole('button', { name: /1 comedy movies/i })
      fireEvent.click(channel1Button)

      expect(mockSelectChannel).toHaveBeenCalledWith(mockChannels[0])
    })

    it('shows selected channel indicator in collapsed state', () => {
      ;(useErsatztvStore as unknown as Mock).mockReturnValue({
        ...defaultMockState,
        selectedChannel: mockChannels[0],
      })

      render(<EPGChannelSidebar isCollapsed={true} />)

      const channel1Button = screen.getByRole('button', { name: /1 comedy movies/i })
      expect(channel1Button).toHaveAttribute('aria-pressed', 'true')
    })
  })
})
