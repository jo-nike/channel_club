import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ErsatzTVView } from './ErsatzTVView'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useUIStore } from '@/stores/uiStore'
import * as useMediaQueryModule from '@/hooks/useMediaQuery'
import type { ErsatzTVChannel } from '@/types'

// Mock the stores
vi.mock('@/stores/ersatztvStore', () => ({
  useErsatztvStore: vi.fn(),
}))

vi.mock('@/stores/uiStore', () => ({
  useUIStore: vi.fn(),
}))

// Mock the API
vi.mock('@/services/ersatztvApi', () => ({
  getErsatzTVStreamUrl: (channelId: string) => `http://stream/${channelId}`,
  getErsatzTVLogoUrl: (channelId: string) => `http://logo/${channelId}`,
}))

// Mock media query hook
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => false), // Desktop by default
}))

// Mock sub-components
vi.mock('./HLSVideoPlayer', () => ({
  HLSVideoPlayer: ({ streamUrl, title }: { streamUrl: string; title?: string }) => (
    <div data-testid="hls-player" data-stream-url={streamUrl} data-title={title}>
      HLS Player Mock
    </div>
  ),
}))

vi.mock('./EPGGrid', () => ({
  EPGGrid: ({
    onProgrammeClick,
  }: {
    programmesByChannel: Record<string, unknown[]>
    loading: boolean
    onProgrammeClick?: (programme: unknown, channel: unknown) => void
  }) => (
    <div
      data-testid="epg-grid"
      onClick={() =>
        onProgrammeClick?.(
          { id: 'prog1', title: 'Test Programme' },
          { id: 'ch1', name: 'Channel 1' }
        )
      }
    >
      EPG Grid Mock
    </div>
  ),
}))

vi.mock('./EPGChannelSidebar', () => ({
  EPGChannelSidebar: ({
    onChannelSelect,
  }: {
    onChannelSelect?: (channel: ErsatzTVChannel) => void
  }) => (
    <div
      data-testid="channel-sidebar"
      onClick={() =>
        onChannelSelect?.({
          id: 'ch2',
          name: 'Channel 2',
          streamUrl: 'url',
          logoUrl: 'logo',
          number: 2,
          group: 'Group',
        })
      }
    >
      Channel Sidebar Mock
    </div>
  ),
}))

vi.mock('./ProgrammeDetailsModal', () => ({
  ProgrammeDetailsModal: ({
    open,
    onOpenChange,
  }: {
    programme: unknown
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div data-testid="programme-modal">
        Programme Modal Mock
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
}))

const mockChannel: ErsatzTVChannel = {
  id: 'ch1',
  name: 'Test Channel',
  streamUrl: 'http://stream.test/ch1.m3u8',
  logoUrl: 'http://logo.test/ch1.png',
  number: 1,
  group: 'Movies',
}

const mockChannel2: ErsatzTVChannel = {
  id: 'ch2',
  name: 'Channel 2',
  streamUrl: 'http://stream.test/ch2.m3u8',
  logoUrl: 'http://logo.test/ch2.png',
  number: 2,
  group: 'Movies',
}

const createMockStore = (overrides = {}) => ({
  channels: [mockChannel],
  selectedChannel: mockChannel,
  channelsLoading: false,
  programmesLoading: false,
  programmesByChannel: {},
  loading: false,
  error: null,
  loadChannels: vi.fn(),
  selectChannel: vi.fn(),
  loadProgrammes: vi.fn(),
  loadCurrentProgramme: vi.fn(),
  loadAllProgrammes: vi.fn(),
  currentProgramme: null,
  nextProgramme: null,
  programmes: [],
  clearError: vi.fn(),
  ...overrides,
})

describe('ErsatzTVView', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(useErsatztvStore).mockReturnValue(createMockStore())
    vi.mocked(useUIStore).mockReturnValue(vi.fn())
    // Desktop by default
    vi.mocked(useMediaQueryModule.useMediaQuery).mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders header with navigation', () => {
    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByText('Live TV')).toBeInTheDocument()
    // Header shows "Movie Channels - {channelName}" when channel is selected
    expect(screen.getByText(/Movie Channels/)).toBeInTheDocument()
  })

  it('renders navigation link back to live TV', () => {
    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/')
  })

  it('renders video player when channel is selected', () => {
    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    const player = screen.getByTestId('hls-player')
    expect(player).toBeInTheDocument()
    expect(player).toHaveAttribute('data-stream-url', 'http://stream/ch1')
  })

  it('shows loading message when loading and no channel selected', () => {
    vi.mocked(useErsatztvStore).mockReturnValue(
      createMockStore({
        selectedChannel: null,
        channelsLoading: true,
      })
    )

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByText('Loading channels...')).toBeInTheDocument()
  })

  it('shows select channel message when not loading and no channel selected', () => {
    vi.mocked(useErsatztvStore).mockReturnValue(
      createMockStore({
        selectedChannel: null,
        channelsLoading: false,
      })
    )

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByText('Select a channel to start watching')).toBeInTheDocument()
  })

  it('renders EPG grid on desktop', () => {
    vi.mocked(useMediaQueryModule.useMediaQuery).mockReturnValue(false) // Desktop

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByTestId('epg-grid')).toBeInTheDocument()
  })

  it('renders channel sidebar on desktop', () => {
    vi.mocked(useMediaQueryModule.useMediaQuery).mockReturnValue(false) // Desktop

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByTestId('channel-sidebar')).toBeInTheDocument()
  })

  it('loads channels on mount', () => {
    const loadChannels = vi.fn()
    vi.mocked(useErsatztvStore).mockReturnValue(
      createMockStore({ loadChannels })
    )

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(loadChannels).toHaveBeenCalled()
  })

  it('shows current channel in header', () => {
    vi.mocked(useMediaQueryModule.useMediaQuery).mockReturnValue(false) // Desktop

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    // Header shows "Movie Channels - {channelName}" format
    expect(screen.getByText('Movie Channels - Test Channel')).toBeInTheDocument()
  })

  it('shows error message when error exists', () => {
    vi.mocked(useErsatztvStore).mockReturnValue(
      createMockStore({ error: 'Failed to load channels' })
    )

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.getByText('Failed to load channels')).toBeInTheDocument()
  })

  it('auto-selects first channel when channels load', () => {
    const selectChannel = vi.fn()
    vi.mocked(useErsatztvStore).mockReturnValue(
      createMockStore({
        channels: [mockChannel, mockChannel2],
        selectedChannel: null,
        selectChannel,
      })
    )

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(selectChannel).toHaveBeenCalledWith(mockChannel)
  })

  it('opens programme modal when programme is clicked in grid', () => {
    vi.mocked(useMediaQueryModule.useMediaQuery).mockReturnValue(false) // Desktop

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    // Click on the grid (which triggers the mock onProgrammeClick)
    fireEvent.click(screen.getByTestId('epg-grid'))

    expect(screen.getByTestId('programme-modal')).toBeInTheDocument()
  })

  it('handles channel selection from sidebar', () => {
    const selectChannel = vi.fn()
    vi.mocked(useErsatztvStore).mockReturnValue(
      createMockStore({ selectChannel })
    )
    vi.mocked(useMediaQueryModule.useMediaQuery).mockReturnValue(false) // Desktop

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    // Click on the sidebar (which triggers the mock onChannelSelect)
    fireEvent.click(screen.getByTestId('channel-sidebar'))

    expect(selectChannel).toHaveBeenCalled()
  })

  it('sets up auto-refresh interval for programme data', () => {
    const loadAllProgrammes = vi.fn()
    vi.mocked(useErsatztvStore).mockReturnValue(
      createMockStore({ loadAllProgrammes })
    )

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    // Fast-forward 5 minutes
    vi.advanceTimersByTime(5 * 60 * 1000)

    expect(loadAllProgrammes).toHaveBeenCalledWith(6)
  })

  it('cleans up interval on unmount', () => {
    const loadAllProgrammes = vi.fn()
    vi.mocked(useErsatztvStore).mockReturnValue(
      createMockStore({ loadAllProgrammes, channels: [] }) // Empty channels so interval doesn't trigger
    )

    const { unmount } = render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    unmount()

    // Fast-forward 5 minutes after unmount
    vi.advanceTimersByTime(5 * 60 * 1000)

    // loadAllProgrammes should not be called after unmount (only initial call if any)
    expect(loadAllProgrammes).not.toHaveBeenCalled()
  })
})

describe('ErsatzTVView - Mobile Layout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(useErsatztvStore).mockReturnValue(createMockStore())
    vi.mocked(useUIStore).mockReturnValue(vi.fn())
    // Mobile viewport
    vi.mocked(useMediaQueryModule.useMediaQuery).mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders mobile channel list on mobile', () => {
    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    // On mobile, we should see "Channels" heading from MobileChannelList
    expect(screen.getByText('Channels')).toBeInTheDocument()
  })

  it('does not render sidebar on mobile', () => {
    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.queryByTestId('channel-sidebar')).not.toBeInTheDocument()
  })

  it('does not render EPG grid on mobile', () => {
    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    expect(screen.queryByTestId('epg-grid')).not.toBeInTheDocument()
  })

  it('handles channel selection from mobile list', () => {
    const selectChannel = vi.fn()
    vi.mocked(useErsatztvStore).mockReturnValue(
      createMockStore({ selectChannel })
    )

    render(
      <MemoryRouter>
        <ErsatzTVView />
      </MemoryRouter>
    )

    // Click on the channel button in the mobile list (the button contains the channel name)
    const channelButtons = screen.getAllByRole('button')
    // Find the button that contains the channel name (not the Live TV button)
    const channelButton = channelButtons.find(btn => btn.textContent?.includes('Movies'))
    fireEvent.click(channelButton!)

    expect(selectChannel).toHaveBeenCalledWith(mockChannel)
  })
})
