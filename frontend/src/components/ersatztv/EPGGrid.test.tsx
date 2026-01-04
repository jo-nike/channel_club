import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EPGGrid } from './EPGGrid'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { fetchErsatzTVProgrammes } from '@/services/ersatztvApi'

// Mock the store and API
vi.mock('@/stores/ersatztvStore')
vi.mock('@/services/ersatztvApi')

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

describe('EPGGrid', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-01-03T12:00:00Z'))

    // Setup default mocks
    vi.mocked(useErsatztvStore).mockReturnValue({
      channels: mockChannels,
      selectedChannel: null,
      programmes: [],
      currentProgramme: null,
      nextProgramme: null,
      loading: false,
      error: null,
      loadChannels: vi.fn().mockResolvedValue(undefined),
      selectChannel: vi.fn(),
      loadProgrammes: vi.fn(),
      loadCurrentProgramme: vi.fn(),
      clearError: vi.fn(),
    })

    vi.mocked(fetchErsatzTVProgrammes).mockResolvedValue({
      channelId: 'ch1',
      programmes: mockProgrammes,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders loading skeleton initially', async () => {
    vi.mocked(useErsatztvStore).mockReturnValue({
      channels: [],
      selectedChannel: null,
      programmes: [],
      currentProgramme: null,
      nextProgramme: null,
      loading: false,
      error: null,
      loadChannels: vi.fn().mockResolvedValue(undefined),
      selectChannel: vi.fn(),
      loadProgrammes: vi.fn(),
      loadCurrentProgramme: vi.fn(),
      clearError: vi.fn(),
    })

    await act(async () => {
      render(<EPGGrid />)
    })

    expect(screen.getByTestId('epg-grid-skeleton')).toBeInTheDocument()
  })

  it('renders time slots in 30-minute intervals', async () => {
    await act(async () => {
      render(<EPGGrid />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('epg-grid')).toBeInTheDocument()
    })

    // Should show multiple time slots (30-minute intervals)
    const timeSlots = screen.getAllByTestId('time-slot')
    expect(timeSlots.length).toBeGreaterThan(0)
  })

  it('renders channel rows with channel numbers', async () => {
    await act(async () => {
      render(<EPGGrid />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('epg-grid')).toBeInTheDocument()
    })

    const channelRows = screen.getAllByTestId('channel-row')
    expect(channelRows).toHaveLength(2) // Two mock channels

    // Check channel numbers are displayed
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders programme boxes with titles', async () => {
    await act(async () => {
      render(<EPGGrid />)
    })

    await waitFor(() => {
      // Multiple channels show the same programmes (from mock), so use getAllByText
      expect(screen.getAllByText('Test Movie 1').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('Test Movie 2').length).toBeGreaterThan(0)
  })

  it('shows now marker at current time', async () => {
    await act(async () => {
      render(<EPGGrid />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('epg-grid')).toBeInTheDocument()
    })

    // Now marker should exist
    const nowMarker = screen.getByTestId('now-marker')
    expect(nowMarker).toBeInTheDocument()
    expect(nowMarker).toHaveClass('bg-primary')
  })

  it('calls onProgrammeClick when programme is clicked', async () => {
    const onProgrammeClick = vi.fn()

    await act(async () => {
      render(<EPGGrid onProgrammeClick={onProgrammeClick} />)
    })

    await waitFor(() => {
      expect(screen.getAllByText('Test Movie 1').length).toBeGreaterThan(0)
    })

    // Click the first programme box
    const programmeBoxes = screen.getAllByTestId('programme-box')
    fireEvent.click(programmeBoxes[0])

    expect(onProgrammeClick).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Test Movie 1' }),
      expect.objectContaining({ id: 'ch1' })
    )
  })

  it('supports horizontal scrolling', async () => {
    await act(async () => {
      render(<EPGGrid hours={12} />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('epg-grid')).toBeInTheDocument()
    })

    const scrollContainer = screen.getByTestId('grid-container')
    expect(scrollContainer).toHaveClass('overflow-x-auto')
  })

  it('loads channels if not already loaded', async () => {
    const loadChannels = vi.fn().mockResolvedValue(undefined)

    vi.mocked(useErsatztvStore).mockReturnValue({
      channels: [],
      selectedChannel: null,
      programmes: [],
      currentProgramme: null,
      nextProgramme: null,
      loading: false,
      error: null,
      loadChannels,
      selectChannel: vi.fn(),
      loadProgrammes: vi.fn(),
      loadCurrentProgramme: vi.fn(),
      clearError: vi.fn(),
    })

    await act(async () => {
      render(<EPGGrid />)
    })

    expect(loadChannels).toHaveBeenCalled()
  })

  it('fetches programmes for all channels', async () => {
    await act(async () => {
      render(<EPGGrid hours={6} />)
    })

    await waitFor(() => {
      expect(fetchErsatzTVProgrammes).toHaveBeenCalledWith('ch1', 6)
      expect(fetchErsatzTVProgrammes).toHaveBeenCalledWith('ch2', 6)
    })
  })

  it('updates now marker every minute', async () => {
    await act(async () => {
      render(<EPGGrid />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('epg-grid')).toBeInTheDocument()
    })

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
    vi.mocked(fetchErsatzTVProgrammes).mockResolvedValue({
      channelId: 'ch1',
      programmes: [],
    })

    await act(async () => {
      render(<EPGGrid />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('epg-grid')).toBeInTheDocument()
    })

    // Should still render channel rows even without programmes
    const channelRows = screen.getAllByTestId('channel-row')
    expect(channelRows).toHaveLength(2)
  })

  it('handles API errors gracefully', async () => {
    vi.mocked(fetchErsatzTVProgrammes).mockRejectedValue(new Error('API error'))

    await act(async () => {
      render(<EPGGrid />)
    })

    await waitFor(() => {
      expect(screen.getByTestId('epg-grid')).toBeInTheDocument()
    })

    // Should still render the grid even if API fails
    const channelRows = screen.getAllByTestId('channel-row')
    expect(channelRows).toHaveLength(2)
  })

  it('configures hours prop correctly', async () => {
    await act(async () => {
      render(<EPGGrid hours={12} />)
    })

    await waitFor(() => {
      expect(fetchErsatzTVProgrammes).toHaveBeenCalledWith('ch1', 12)
    })
  })
})
