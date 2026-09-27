import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { NHLScoresOverlay } from './NHLScoresOverlay'
import type { NHLScoresResponse } from '@/types/nhl'

// Mock the useNHLScores hook
vi.mock('@/hooks/useNHLScores', () => ({
  useNHLScores: vi.fn(),
}))

// Mock the uiStore
const mockToggleNHLOverlay = vi.fn()
vi.mock('@/stores/uiStore', () => ({
  useUIStore: vi.fn((selector) =>
    selector({ toggleNHLOverlay: mockToggleNHLOverlay })
  ),
}))

import { useNHLScores } from '@/hooks/useNHLScores'
const mockUseNHLScores = vi.mocked(useNHLScores)

describe('NHLScoresOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockToggleNHLOverlay.mockClear()
  })

  it('should not render when not visible', () => {
    mockUseNHLScores.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    const { container } = render(<NHLScoresOverlay isVisible={false} />)

    expect(container.firstChild).toBeNull()
  })

  it('should show loading state', () => {
    mockUseNHLScores.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('should show error state with retry button', () => {
    const mockRefetch = vi.fn()
    mockUseNHLScores.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Network error'),
      refetch: mockRefetch,
    })

    render(<NHLScoresOverlay isVisible={true} />)

    expect(screen.getByText('Failed to load')).toBeInTheDocument()

    const retryButton = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retryButton)

    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('should show empty state when no games', () => {
    mockUseNHLScores.mockReturnValue({
      data: {
        games: [],
        date: '2026-07-15',
        liveGameCount: 0,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    expect(screen.getByText('No games today')).toBeInTheDocument()
  })

  it('should render games when data is available', () => {
    const mockData: NHLScoresResponse = {
      games: [
        {
          id: 2024020123,
          status: 'live',
          homeTeam: {
            name: 'Boston Bruins',
            abbreviation: 'BOS',
            score: 2,
            logo: 'https://test.com/bos_light.svg',
            logoDark: 'https://test.com/bos_dark.svg',
          },
          awayTeam: {
            name: 'Montreal Canadiens',
            abbreviation: 'MTL',
            score: 1,
            logo: 'https://test.com/mtl_light.svg',
            logoDark: 'https://test.com/mtl_dark.svg',
          },
          startTime: '2026-01-15T00:00:00Z',
          gameCenterLink: 'https://nhl.com/gamecenter/test',
          period: '2nd',
          timeRemaining: '08:45',
          isIntermission: false,
        },
      ],
      date: '2026-01-15',
      liveGameCount: 1,
    }

    mockUseNHLScores.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    // Check teams are rendered
    expect(screen.getByText('BOS')).toBeInTheDocument()
    expect(screen.getByText('MTL')).toBeInTheDocument()

    // Check scores are rendered
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()

    // Check status is rendered
    expect(screen.getByText(/2nd.*08:45/)).toBeInTheDocument()

    // Check live badge
    expect(screen.getByText('1 Live')).toBeInTheDocument()
  })

  it('should show scheduled game with start time', () => {
    const startTime = new Date('2026-01-15T19:00:00Z')
    const mockData: NHLScoresResponse = {
      games: [
        {
          id: 2024020124,
          status: 'scheduled',
          homeTeam: {
            name: 'Toronto Maple Leafs',
            abbreviation: 'TOR',
            score: 0,
            logo: 'https://test.com/tor_light.svg',
            logoDark: 'https://test.com/tor_dark.svg',
          },
          awayTeam: {
            name: 'Ottawa Senators',
            abbreviation: 'OTT',
            score: 0,
            logo: 'https://test.com/ott_light.svg',
            logoDark: 'https://test.com/ott_dark.svg',
          },
          startTime: startTime.toISOString(),
          gameCenterLink: 'https://nhl.com/gamecenter/test',
        },
      ],
      date: '2026-01-15',
      liveGameCount: 0,
    }

    mockUseNHLScores.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    // Scheduled games should not show scores
    expect(screen.getByText('TOR')).toBeInTheDocument()
    expect(screen.getByText('OTT')).toBeInTheDocument()
  })

  it('should show final game with outcome type', () => {
    const mockData: NHLScoresResponse = {
      games: [
        {
          id: 2024020125,
          status: 'final',
          homeTeam: {
            name: 'Tampa Bay Lightning',
            abbreviation: 'TBL',
            score: 3,
            logo: 'https://test.com/tbl_light.svg',
            logoDark: 'https://test.com/tbl_dark.svg',
          },
          awayTeam: {
            name: 'Florida Panthers',
            abbreviation: 'FLA',
            score: 2,
            logo: 'https://test.com/fla_light.svg',
            logoDark: 'https://test.com/fla_dark.svg',
          },
          startTime: '2026-01-15T00:00:00Z',
          gameCenterLink: 'https://nhl.com/gamecenter/test',
          outcomeType: 'OT',
        },
      ],
      date: '2026-01-15',
      liveGameCount: 0,
    }

    mockUseNHLScores.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    expect(screen.getByText('F/OT')).toBeInTheDocument()

    // Scores are set in the display face with tabular figures; the winner is heavier
    const winner = screen.getByText('3')
    const loser = screen.getByText('2')
    expect(winner).toHaveClass('font-display', 'tabular-nums', 'font-black', 'text-primary')
    expect(loser).toHaveClass('font-display', 'tabular-nums', 'font-bold', 'text-muted-foreground')
  })

  it('should show intermission status', () => {
    const mockData: NHLScoresResponse = {
      games: [
        {
          id: 2024020126,
          status: 'live',
          homeTeam: {
            name: 'Detroit Red Wings',
            abbreviation: 'DET',
            score: 1,
            logo: 'https://test.com/det_light.svg',
            logoDark: 'https://test.com/det_dark.svg',
          },
          awayTeam: {
            name: 'Columbus Blue Jackets',
            abbreviation: 'CBJ',
            score: 1,
            logo: 'https://test.com/cbj_light.svg',
            logoDark: 'https://test.com/cbj_dark.svg',
          },
          startTime: '2026-01-15T00:00:00Z',
          gameCenterLink: 'https://nhl.com/gamecenter/test',
          period: '2nd',
          timeRemaining: '00:00',
          isIntermission: true,
        },
      ],
      date: '2026-01-15',
      liveGameCount: 1,
    }

    mockUseNHLScores.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    expect(screen.getByText('2nd INT')).toBeInTheDocument()
  })

  it('should show power play indicator', () => {
    const mockData: NHLScoresResponse = {
      games: [
        {
          id: 2024020127,
          status: 'live',
          homeTeam: {
            name: 'New York Rangers',
            abbreviation: 'NYR',
            score: 1,
            logo: 'https://test.com/nyr_light.svg',
            logoDark: 'https://test.com/nyr_dark.svg',
          },
          awayTeam: {
            name: 'New Jersey Devils',
            abbreviation: 'NJD',
            score: 1,
            logo: 'https://test.com/njd_light.svg',
            logoDark: 'https://test.com/njd_dark.svg',
          },
          startTime: '2026-01-15T00:00:00Z',
          gameCenterLink: 'https://nhl.com/gamecenter/test',
          period: '2nd',
          timeRemaining: '15:30',
          isIntermission: false,
          situation: {
            homeStrength: '5',
            awayStrength: '4',
            timeRemaining: '1:45',
          },
        },
      ],
      date: '2026-01-15',
      liveGameCount: 1,
    }

    mockUseNHLScores.mockReturnValue({
      data: mockData,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    expect(screen.getByText('PP')).toBeInTheDocument()
  })

  it('should enable hook polling when visible', () => {
    mockUseNHLScores.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    expect(mockUseNHLScores).toHaveBeenCalledWith(true)
  })

  it('should disable hook polling when not visible', () => {
    mockUseNHLScores.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={false} />)

    expect(mockUseNHLScores).toHaveBeenCalledWith(false)
  })

  it('should close overlay when Escape key is pressed', () => {
    mockUseNHLScores.mockReturnValue({
      data: {
        games: [],
        date: '2026-01-15',
        liveGameCount: 0,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    // Simulate Escape key press
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(mockToggleNHLOverlay).toHaveBeenCalledTimes(1)
  })

  it('should close overlay when backdrop is clicked', () => {
    mockUseNHLScores.mockReturnValue({
      data: {
        games: [],
        date: '2026-01-15',
        liveGameCount: 0,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    // Find the backdrop (the dialog element)
    const backdrop = screen.getByRole('dialog')

    // Click on the backdrop itself
    fireEvent.click(backdrop)

    expect(mockToggleNHLOverlay).toHaveBeenCalledTimes(1)
  })

  it('should NOT close overlay when content area is clicked', () => {
    mockUseNHLScores.mockReturnValue({
      data: {
        games: [],
        date: '2026-01-15',
        liveGameCount: 0,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    // Click on the content (NHL heading)
    const heading = screen.getByRole('heading', { name: 'NHL' })
    fireEvent.click(heading)

    expect(mockToggleNHLOverlay).not.toHaveBeenCalled()
  })

  it('should have proper accessibility attributes', () => {
    mockUseNHLScores.mockReturnValue({
      data: {
        games: [],
        date: '2026-01-15',
        liveGameCount: 0,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'nhl-scores-title')

    const title = screen.getByRole('heading', { name: 'NHL' })
    expect(title).toHaveAttribute('id', 'nhl-scores-title')
  })
})
