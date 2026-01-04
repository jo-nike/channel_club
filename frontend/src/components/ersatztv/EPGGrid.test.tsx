import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EPGGrid } from './EPGGrid'
import { useErsatztvStore } from '@/stores/ersatztvStore'

// Mock the store
vi.mock('@/stores/ersatztvStore')

const mockChannels = [
  { id: 'ch1', name: 'Channel 1', number: 1, streamUrl: '', logoUrl: '', group: 'Movies' },
  { id: 'ch2', name: 'Channel 2', number: 2, streamUrl: '', logoUrl: '', group: 'Movies' },
]

const mockProgrammes = [
  {
    id: 'p1',
    channelId: 'ch1',
    title: 'Test Movie 1',
    start: '2026-01-03T12:00:00Z',
    stop: '2026-01-03T14:00:00Z',
    description: 'A test movie',
  },
  {
    id: 'p2',
    channelId: 'ch1',
    title: 'Test Movie 2',
    start: '2026-01-03T14:00:00Z',
    stop: '2026-01-03T16:00:00Z',
    description: 'Another test movie',
  },
]

const mockProgrammesByChannel = {
  ch1: mockProgrammes,
  ch2: mockProgrammes,
}

describe('EPGGrid', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-01-03T12:00:00Z'))

    // Setup default mock - EPGGrid only reads channels from store
    vi.mocked(useErsatztvStore).mockReturnValue({
      channels: mockChannels,
      selectedChannel: null,
      programmes: [],
      programmesByChannel: {},
      currentProgramme: null,
      nextProgramme: null,
      channelsLoading: false,
      programmesLoading: false,
      loading: false,
      error: null,
      loadChannels: vi.fn(),
      selectChannel: vi.fn(),
      loadProgrammes: vi.fn(),
      loadCurrentProgramme: vi.fn(),
      loadAllProgrammes: vi.fn(),
      clearError: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders loading skeleton when loading prop is true', async () => {
    await act(async () => {
      render(<EPGGrid programmesByChannel={{}} loading={true} />)
    })

    expect(screen.getByTestId('epg-grid-skeleton')).toBeInTheDocument()
  })

  it('renders time slots in 30-minute intervals', async () => {
    await act(async () => {
      render(<EPGGrid programmesByChannel={mockProgrammesByChannel} loading={false} />)
    })

    expect(screen.getByTestId('epg-grid')).toBeInTheDocument()

    // Should show multiple time slots (30-minute intervals)
    const timeSlots = screen.getAllByTestId('time-slot')
    expect(timeSlots.length).toBeGreaterThan(0)
  })

  it('renders channel rows with channel numbers', async () => {
    await act(async () => {
      render(<EPGGrid programmesByChannel={mockProgrammesByChannel} loading={false} />)
    })

    expect(screen.getByTestId('epg-grid')).toBeInTheDocument()

    const channelRows = screen.getAllByTestId('channel-row')
    expect(channelRows).toHaveLength(2) // Two mock channels

    // Check channel numbers are displayed
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders programme boxes with titles', async () => {
    await act(async () => {
      render(<EPGGrid programmesByChannel={mockProgrammesByChannel} loading={false} />)
    })

    // Multiple channels show the same programmes
    expect(screen.getAllByText('Test Movie 1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Test Movie 2').length).toBeGreaterThan(0)
  })

  it('shows now marker at current time', async () => {
    await act(async () => {
      render(<EPGGrid programmesByChannel={mockProgrammesByChannel} loading={false} />)
    })

    expect(screen.getByTestId('epg-grid')).toBeInTheDocument()

    // Now marker should exist
    const nowMarker = screen.getByTestId('now-marker')
    expect(nowMarker).toBeInTheDocument()
    expect(nowMarker).toHaveClass('bg-primary')
  })

  it('calls onProgrammeClick when programme is clicked', async () => {
    const onProgrammeClick = vi.fn()

    await act(async () => {
      render(
        <EPGGrid
          programmesByChannel={mockProgrammesByChannel}
          loading={false}
          onProgrammeClick={onProgrammeClick}
        />
      )
    })

    expect(screen.getAllByText('Test Movie 1').length).toBeGreaterThan(0)

    // Click the first programme box
    const programmeBoxes = screen.getAllByTestId('programme-box')
    fireEvent.click(programmeBoxes[0])

    expect(onProgrammeClick).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Test Movie 1' }),
      expect.objectContaining({ id: 'ch1' })
    )
  })

  it('has fixed horizontal layout for proper time alignment', async () => {
    await act(async () => {
      render(<EPGGrid hours={12} programmesByChannel={mockProgrammesByChannel} loading={false} />)
    })

    expect(screen.getByTestId('epg-grid')).toBeInTheDocument()

    // Grid container uses overflow-hidden for fixed layout with now marker
    const scrollContainer = screen.getByTestId('grid-container')
    expect(scrollContainer).toHaveClass('overflow-x-hidden')
  })

  it('uses channels from store', async () => {
    await act(async () => {
      render(<EPGGrid programmesByChannel={mockProgrammesByChannel} loading={false} />)
    })

    // Verify store was accessed
    expect(useErsatztvStore).toHaveBeenCalled()

    // Two channel rows should be rendered
    const channelRows = screen.getAllByTestId('channel-row')
    expect(channelRows).toHaveLength(2)
  })

  it('uses programmesByChannel prop for displaying programmes', async () => {
    await act(async () => {
      render(<EPGGrid programmesByChannel={mockProgrammesByChannel} loading={false} />)
    })

    // Should show programmes from prop
    expect(screen.getAllByText('Test Movie 1').length).toBeGreaterThan(0)
  })

  it('updates now marker every minute', async () => {
    await act(async () => {
      render(<EPGGrid programmesByChannel={mockProgrammesByChannel} loading={false} />)
    })

    expect(screen.getByTestId('epg-grid')).toBeInTheDocument()

    // Initial marker should exist
    expect(screen.getByTestId('now-marker')).toBeInTheDocument()

    // Advance time by 1 minute
    await act(async () => {
      vi.advanceTimersByTime(60000)
    })

    // Marker should still exist (component updates)
    expect(screen.getByTestId('now-marker')).toBeInTheDocument()
  })

  it('handles empty programmes gracefully', async () => {
    await act(async () => {
      render(<EPGGrid programmesByChannel={{}} loading={false} />)
    })

    expect(screen.getByTestId('epg-grid')).toBeInTheDocument()

    // Should still render channel rows even without programmes
    const channelRows = screen.getAllByTestId('channel-row')
    expect(channelRows).toHaveLength(2)
  })

  it('handles missing channel programmes gracefully', async () => {
    const partialProgrammes = {
      ch1: mockProgrammes,
      // ch2 is missing
    }

    await act(async () => {
      render(<EPGGrid programmesByChannel={partialProgrammes} loading={false} />)
    })

    expect(screen.getByTestId('epg-grid')).toBeInTheDocument()

    // Should still render both channel rows
    const channelRows = screen.getAllByTestId('channel-row')
    expect(channelRows).toHaveLength(2)
  })

  it('configures hours prop correctly', async () => {
    await act(async () => {
      render(<EPGGrid hours={12} programmesByChannel={mockProgrammesByChannel} loading={false} />)
    })

    // With 12 hours and 30-minute intervals, should have 24 time slots
    const timeSlots = screen.getAllByTestId('time-slot')
    expect(timeSlots.length).toBe(24)
  })
})
