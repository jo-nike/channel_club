import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@/test/utils'
import { NHLScoresOverlay } from './NHLScoresOverlay'
import type { NHLGame, NHLScoresResponse } from '@/types/nhl'

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

    // Find the backdrop (the region element)
    const backdrop = screen.getByRole('region', { name: 'NHL scores' })

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

  it('is a labelled region, not a modal dialog', () => {
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

    const region = screen.getByRole('region', { name: 'NHL scores' })
    expect(region).not.toHaveAttribute('aria-modal')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(region).getByRole('heading', { name: 'NHL' })).toBeInTheDocument()
  })

  it('sits at the top of the player, and moves under the info rail while the rail is up', () => {
    mockUseNHLScores.mockReturnValue({
      data: { games: [], date: '2026-01-15', liveGameCount: 0 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    const railOffset = 'top-[calc(3.75rem+var(--player-inset-top,0px))]'

    const ticker = () => screen.getByRole('region', { name: 'NHL scores' })

    const { rerender } = render(<NHLScoresOverlay isVisible={true} />)
    expect(ticker()).toHaveClass('top-0')
    expect(ticker()).not.toHaveClass(railOffset)

    rerender(<NHLScoresOverlay isVisible={true} belowRail />)
    expect(ticker()).toHaveClass(railOffset)
    expect(ticker()).not.toHaveClass('top-0')
  })
})

describe('NHLScoresOverlay: the row of games', () => {
  // jsdom has no layout scrolling, so there's no scrollBy to spy on, and every
  // size reads 0 until the test sets one
  const scrollBy = vi.fn()
  const originalMatchMedia = window.matchMedia
  let scrollLeft = 0

  const game = (id: number): NHLGame => ({
    id,
    status: 'scheduled',
    homeTeam: { name: `Home ${id}`, abbreviation: `H${id}`, score: 0, logo: '', logoDark: '' },
    awayTeam: { name: `Away ${id}`, abbreviation: `A${id}`, score: 0, logo: '', logoDark: '' },
    startTime: '2026-01-15T00:00:00Z',
    gameCenterLink: 'https://nhl.com/gamecenter/test',
    broadcasts: [],
  })

  // Twelve games in a row 300px wide that holds about three
  function renderRow({ scrollWidth = 1200, clientWidth = 300 } = {}) {
    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth)
    vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockImplementation(() => scrollLeft)
    mockUseNHLScores.mockReturnValue({
      data: { games: Array.from({ length: 12 }, (_, i) => game(i + 1)), date: '2026-01-15', liveGameCount: 0 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<NHLScoresOverlay isVisible={true} />)
    return screen.getByRole('group', { name: "Today's games" })
  }

  // Where the row is scrolled to, as a scroll event reports it
  const scrollTo = (row: HTMLElement, left: number) => {
    scrollLeft = left
    fireEvent.scroll(row)
  }

  const left = () => screen.queryByRole('button', { name: 'Scroll games left' })
  const right = () => screen.queryByRole('button', { name: 'Scroll games right' })

  function mockReducedMotion(reduce: boolean) {
    window.matchMedia = vi.fn((query: string) => ({
      matches: reduce && query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }

  beforeEach(() => {
    scrollLeft = 0
    Element.prototype.scrollBy = scrollBy
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    scrollBy.mockReset()
    delete (Element.prototype as Partial<Element>).scrollBy
    window.matchMedia = originalMatchMedia
  })

  it('shows a chevron only on a side with more games to see', () => {
    const row = renderRow()
    expect(left()).not.toBeInTheDocument()
    expect(right()).toBeInTheDocument()

    scrollTo(row, 400)
    expect(left()).toBeInTheDocument()
    expect(right()).toBeInTheDocument()

    // The end: 900 + 300 = 1200
    scrollTo(row, 900)
    expect(left()).toBeInTheDocument()
    expect(right()).not.toBeInTheDocument()
  })

  it('has no chevrons when every game fits', () => {
    renderRow({ scrollWidth: 300, clientWidth: 300 })

    expect(left()).not.toBeInTheDocument()
    expect(right()).not.toBeInTheDocument()
  })

  it('the chevrons scroll the row by most of its width, smoothly', () => {
    mockReducedMotion(false)
    const row = renderRow()

    fireEvent.click(right() as HTMLElement)
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 240, behavior: 'smooth' })

    scrollTo(row, 240)
    fireEvent.click(left() as HTMLElement)
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -240, behavior: 'smooth' })
    expect(scrollBy.mock.contexts).toEqual([row, row])
  })

  it('jumps instead of gliding under reduced motion', () => {
    mockReducedMotion(true)
    renderRow()

    fireEvent.click(right() as HTMLElement)

    expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'auto' })
  })

  it('the chevrons stay out of the tab order; the row itself takes focus', () => {
    const row = renderRow()

    expect(row).toHaveAttribute('tabindex', '0')
    expect(right()).toHaveAttribute('tabindex', '-1')
  })

  it('the arrow keys scroll the focused row, and are not also volume keys', () => {
    mockReducedMotion(false)
    const row = renderRow()
    row.focus()

    // fireEvent returns false when the handler prevented the default, which
    // the player's shortcuts skip
    expect(fireEvent.keyDown(row, { key: 'ArrowRight' })).toBe(false)
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 160, behavior: 'smooth' })

    expect(fireEvent.keyDown(row, { key: 'ArrowLeft' })).toBe(false)
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -160, behavior: 'smooth' })

    // Other keys go on to the player
    expect(fireEvent.keyDown(row, { key: 'm' })).toBe(true)
    expect(scrollBy).toHaveBeenCalledTimes(2)
  })

  it('never scrolls by itself', () => {
    vi.useFakeTimers()
    const frame = vi.spyOn(window, 'requestAnimationFrame')
    const setScrollLeft = vi.spyOn(Element.prototype, 'scrollLeft', 'set')
    renderRow()

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(frame).not.toHaveBeenCalled()
    expect(setScrollLeft).not.toHaveBeenCalled()
    expect(scrollBy).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('snaps each game into place', () => {
    const row = renderRow()

    expect(row).toHaveClass('overflow-x-auto', 'snap-x', 'snap-mandatory')
    const pill = screen.getByLabelText('Away 1 vs Home 1')
    expect(pill).toHaveClass('snap-start')
  })
})
