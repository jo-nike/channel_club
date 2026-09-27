import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast } from 'sonner'
import { render, screen, fireEvent, within, act, waitFor } from '@/test/utils'
import { NHLScoresOverlay } from './NHLScoresOverlay'
import { PlayerShellContext, type PlayerShell } from '@/components/player/PlayerShellContext'
import * as api from '@/services/api'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore } from '@/stores/channelStore'
import { useChatStore } from '@/stores/chatStore'
import { useNhlMappingStore } from '@/stores/nhlMappingStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { LIVE_CHANNEL_ID, useTVStore } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import type { ChatSendResult } from '@/hooks/useWebSocket'
import type { Channel, GroupedChannelsResponse } from '@/types'
import type { GameStatus, NHLBroadcast, NHLGame, NHLScoresResponse } from '@/types/nhl'

// Mock the useNHLScores hook
vi.mock('@/hooks/useNHLScores', () => ({
  useNHLScores: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  fetchGroupedChannels: vi.fn(),
  setCurrentChannel: vi.fn(),
}))

const chatFlag = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/hooks/useChatEnabled', () => ({ useChatEnabled: () => chatFlag.enabled }))

import { useNHLScores } from '@/hooks/useNHLScores'
const mockUseNHLScores = vi.mocked(useNHLScores)

const mockToggleNHLOverlay = vi.fn()

const ch = (id: string, name: string): Channel => ({ id, name, streamUrl: `http://stream${id}.m3u8`, guideId: id })
const tsn5 = ch('1', 'TSN 5')
const sportsnet = ch('2', 'Sportsnet')
const cbc = ch('3', 'CBC')

// Any signed-in viewer can read the lineup the ticker matches games against
const lineup: GroupedChannelsResponse = {
  groups: [{ id: 1, name: 'Sports', channelCount: 2, channels: [tsn5, sportsnet] }],
  ungrouped: [cbc],
}

beforeEach(() => {
  useUIStore.setState({ toggleNHLOverlay: mockToggleNHLOverlay })
  useNhlMappingStore.setState({ overrides: {} })
  // Still loading, unless a test needs the lineup
  vi.mocked(api.fetchGroupedChannels).mockReturnValue(new Promise(() => {}))
  vi.mocked(api.setCurrentChannel).mockImplementation(async (channel) => channel)
})

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
          broadcasts: [],
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
          broadcasts: [],
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
          broadcasts: [],
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
          broadcasts: [],
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
          broadcasts: [],
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

  it("names each game's button with the scores and status the pill shows", () => {
    const team = (name: string, abbreviation: string, score: number) => ({ name, abbreviation, score, logo: '', logoDark: '' })
    const base = { startTime: '2026-01-15T00:00:00Z', gameCenterLink: '', broadcasts: [] }
    mockUseNHLScores.mockReturnValue({
      data: {
        games: [
          {
            ...base,
            id: 1,
            status: 'live',
            awayTeam: team('Toronto Maple Leafs', 'TOR', 2),
            homeTeam: team('Montreal Canadiens', 'MTL', 3),
            period: '2nd',
            timeRemaining: '08:45',
            isIntermission: false,
            situation: { homeStrength: '5', awayStrength: '4', timeRemaining: '1:45' },
          },
          {
            ...base,
            id: 2,
            status: 'final',
            awayTeam: team('Florida Panthers', 'FLA', 2),
            homeTeam: team('Tampa Bay Lightning', 'TBL', 3),
            outcomeType: 'OT',
          },
          {
            ...base,
            id: 3,
            status: 'scheduled',
            awayTeam: team('Ottawa Senators', 'OTT', 0),
            homeTeam: team('Boston Bruins', 'BOS', 0),
          },
        ],
        date: '2026-01-15',
        liveGameCount: 1,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(<NHLScoresOverlay isVisible={true} />)

    expect(
      screen.getByRole('button', { name: 'Toronto Maple Leafs 2 at Montreal Canadiens 3, 2nd 08:45, power play' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Florida Panthers 2 at Tampa Bay Lightning 3, F/OT' })).toBeInTheDocument()
    // Not started: no scores, and the start time in their time zone
    expect(
      screen.getByRole('button', { name: /^Ottawa Senators at Boston Bruins, \d{1,2}:\d{2}\s[AP]M$/ })
    ).toBeInTheDocument()
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

  it("the arrow keys in a game's popover leave the row where it is", async () => {
    renderRow()
    fireEvent.click(screen.getByRole('button', { name: /^Away 1 at Home 1,/ }))
    const popover = await screen.findByRole('dialog', { name: 'A1 @ H1' })

    // Portalled out of the row, but React still bubbles its keys through it
    fireEvent.keyDown(popover, { key: 'ArrowRight' })

    expect(scrollBy).not.toHaveBeenCalled()
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
    const pill = screen.getByLabelText(/^Away 1 at Home 1,/)
    expect(pill).toHaveClass('snap-start')
  })
})

describe('NHLScoresOverlay: watching a game together', () => {
  const team = (abbreviation: string, name: string) => ({ name, abbreviation, score: 2, logo: '', logoDark: '' })
  const broadcast = (network: string): NHLBroadcast => ({ network, market: 'N', countryCode: 'CA' })
  function game(id: number, status: GameStatus, broadcasts: NHLBroadcast[]): NHLGame {
    return {
      id,
      status,
      awayTeam: team('TOR', 'Toronto Maple Leafs'),
      homeTeam: team('MTL', 'Montreal Canadiens'),
      startTime: '2026-10-11T23:00:00Z',
      gameCenterLink: '',
      period: '3RD',
      timeRemaining: '4:32',
      broadcasts,
    }
  }

  const sender = vi.fn<(content: string) => Promise<ChatSendResult>>()
  let unregister = () => {}

  function renderTicker(games: NHLGame[]) {
    mockUseNHLScores.mockReturnValue({
      data: { games, date: '2026-10-11', liveGameCount: games.filter((g) => g.status === 'live').length },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    return render(<NHLScoresOverlay isVisible={true} />)
  }

  // The game's button, then its popover once the lineup has matched it
  async function openGame(name: string | RegExp = /^Toronto Maple Leafs 2 at Montreal Canadiens 2,/) {
    fireEvent.click(await screen.findByRole('button', { name }))
    const popover = await screen.findByRole('dialog', { name: 'TOR @ MTL' })
    await waitFor(() => expect(within(popover).queryByText(/Finding it/)).not.toBeInTheDocument())
    return popover
  }

  beforeEach(() => {
    vi.clearAllMocks()
    chatFlag.enabled = true
    vi.mocked(api.fetchGroupedChannels).mockResolvedValue(lineup)
    useChannelStore.setState({ currentChannel: cbc })
    useTVStore.setState({ selectedChannel: null })
    useAuthStore.setState({ token: 'test-token', role: 'viewer', username: 'sam', isAuthenticated: true })
    useSettingsStore.setState({ userChannelSelection: false })
    sender.mockResolvedValue('acknowledged')
    unregister = useChatStore.getState().registerSender(sender)
  })

  afterEach(() => {
    unregister()
  })

  it('each game is a button that opens a popover about it', async () => {
    renderTicker([game(1, 'live', [broadcast('TSN5')])])

    const pill = screen.getByRole('button', { name: 'Toronto Maple Leafs 2 at Montreal Canadiens 2, 3RD 4:32' })
    expect(pill).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(pill)

    expect(pill).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('dialog', { name: 'TOR @ MTL' })).toBeInTheDocument()
  })

  it("an admin gets 'Watch together' on each channel showing the game, which puts it on live TV and tunes them to it", async () => {
    useAuthStore.setState({ role: 'admin' })
    renderTicker([game(1, 'live', [broadcast('TSN5'), broadcast('SN')])])

    const popover = await openGame()
    expect(within(popover).queryByRole('button', { name: 'Ask the group' })).not.toBeInTheDocument()
    const channels = within(popover).getByRole('list', { name: 'Channels showing TOR @ MTL' })
    // In broadcast order (national feeds by network name)
    expect(within(channels).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Watch together on Sportsnet',
      'Watch together on TSN 5',
    ])

    fireEvent.click(within(popover).getByRole('button', { name: 'Watch together on Sportsnet' }))

    expect(api.setCurrentChannel).toHaveBeenCalledWith(sportsnet)
    expect(useChannelStore.getState().currentChannel).toEqual(sportsnet)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(useTVStore.getState().selectedChannel).toMatchObject({ id: LIVE_CHANNEL_ID, streamUrl: sportsnet.streamUrl })
    )
    expect(sender).not.toHaveBeenCalled()
  })

  it("anyone gets 'Watch together' while the admin lets viewers change live TV", async () => {
    useSettingsStore.setState({ userChannelSelection: true })
    renderTicker([game(1, 'live', [broadcast('TSN5')])])

    const popover = await openGame()
    fireEvent.click(within(popover).getByRole('button', { name: 'Watch together on TSN 5' }))

    expect(api.setCurrentChannel).toHaveBeenCalledWith(tsn5)
  })

  it("everyone else gets 'Ask the group', which posts the game and its channels in chat", async () => {
    renderTicker([game(1, 'live', [broadcast('TSN5'), broadcast('SN')])])

    const popover = await openGame()
    expect(within(popover).queryByRole('button', { name: /Watch together/ })).not.toBeInTheDocument()
    expect(within(popover).getByText('On Sportsnet, TSN 5')).toBeInTheDocument()

    fireEvent.click(within(popover).getByRole('button', { name: 'Ask the group' }))

    expect(sender).toHaveBeenCalledWith("Can we watch TOR @ MTL? It's on Sportsnet or TSN 5.", undefined)
    expect(api.setCurrentChannel).not.toHaveBeenCalled()
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Asked the group in chat'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says when the question could not be sent, or may not have been', async () => {
    sender.mockResolvedValueOnce('not-sent').mockResolvedValueOnce('unconfirmed')
    renderTicker([game(1, 'live', [broadcast('TSN5')])])

    fireEvent.click(within(await openGame()).getByRole('button', { name: 'Ask the group' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't ask the group", expect.anything()))

    fireEvent.click(within(await openGame()).getByRole('button', { name: 'Ask the group' }))
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith('Your question may not have been posted', expect.anything())
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("with chat off, 'Ask the group' is disabled and says why", async () => {
    chatFlag.enabled = false
    renderTicker([game(1, 'live', [broadcast('TSN5')])])

    const ask = within(await openGame()).getByRole('button', { name: 'Ask the group' })

    expect(ask).toBeDisabled()
    expect(ask).toHaveAccessibleDescription(/Chat is off, so you can't ask the group/)
    fireEvent.click(ask)
    expect(sender).not.toHaveBeenCalled()
  })

  it('offers nothing for a game on none of your channels, and says where it is on', async () => {
    useAuthStore.setState({ role: 'admin' })
    renderTicker([game(1, 'live', [broadcast('KCOP-13'), broadcast('Victory+')])])

    const popover = await openGame()

    expect(within(popover).getByText('Not on any of your channels (on KCOP-13, Victory+).')).toBeInTheDocument()
    expect(within(popover).queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers nothing for a game that is over', async () => {
    renderTicker([game(1, 'final', [broadcast('TSN5')])])

    const popover = await openGame()

    expect(within(popover).getByText('This game is over.')).toBeInTheDocument()
    expect(within(popover).queryByRole('button')).not.toBeInTheDocument()
  })

  it('uses your pinned channel for a network', async () => {
    useAuthStore.setState({ role: 'admin' })
    useNhlMappingStore.setState({ overrides: { Scripps: sportsnet.id } })
    renderTicker([game(1, 'live', [broadcast('Scripps')])])

    const popover = await openGame()

    expect(within(popover).getByRole('button', { name: 'Watch together on Sportsnet' })).toBeInTheDocument()
  })

  describe("when your channels can't be loaded", () => {
    beforeEach(() => {
      vi.mocked(api.fetchGroupedChannels).mockRejectedValue(new Error('503'))
    })

    it("says so, and still lets a viewer who can't switch ask for the game by name", async () => {
      renderTicker([game(1, 'live', [broadcast('TSN5')])])

      const popover = await openGame()
      expect(
        await within(popover).findByText("Couldn't load your channels. Reopen the scores to try again.")
      ).toBeInTheDocument()
      expect(within(popover).queryByText(/Finding it/)).not.toBeInTheDocument()

      fireEvent.click(within(popover).getByRole('button', { name: 'Ask the group' }))

      expect(sender).toHaveBeenCalledWith('Can we watch TOR @ MTL?', undefined)
    })

    it('says so to someone who can switch, with nothing to put on', async () => {
      useAuthStore.setState({ role: 'admin' })
      renderTicker([game(1, 'live', [broadcast('TSN5')])])

      const popover = await openGame()

      expect(
        await within(popover).findByText("Couldn't load your channels. Reopen the scores to try again.")
      ).toBeInTheDocument()
      expect(within(popover).queryByRole('button')).not.toBeInTheDocument()
    })
  })

  it('Escape closes the popover and leaves the ticker up', async () => {
    renderTicker([game(1, 'live', [broadcast('TSN5')])])
    const popover = await openGame()

    fireEvent.keyDown(within(popover).getByRole('button', { name: 'Ask the group' }), { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockToggleNHLOverlay).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'NHL scores' })).toBeInTheDocument()
  })

  describe('the game on Live', () => {
    function otherGame(id: number, status: GameStatus, broadcasts: NHLBroadcast[]): NHLGame {
      return {
        ...game(id, status, broadcasts),
        awayTeam: team('EDM', 'Edmonton Oilers'),
        homeTeam: team('CGY', 'Calgary Flames'),
      }
    }

    it("marks the game on the shared live channel 'On Live', and no other", async () => {
      useChannelStore.setState({ currentChannel: tsn5 })
      renderTicker([game(1, 'live', [broadcast('TSN5')]), otherGame(2, 'live', [broadcast('SN')])])

      const onLive = await screen.findByRole('button', { name: 'Toronto Maple Leafs 2 at Montreal Canadiens 2, 3RD 4:32, On Live' })
      expect(within(onLive).getByText('On Live')).toBeInTheDocument()
      const other = screen.getByRole('button', { name: 'Edmonton Oilers 2 at Calgary Flames 2, 3RD 4:32' })
      expect(within(other).queryByText('On Live')).not.toBeInTheDocument()
    })

    it('moves the mark when live TV changes', async () => {
      useChannelStore.setState({ currentChannel: tsn5 })
      renderTicker([game(1, 'live', [broadcast('TSN5')]), otherGame(2, 'live', [broadcast('SN')])])
      await screen.findByRole('button', { name: /Toronto.*, On Live/ })

      act(() => useChannelStore.setState({ currentChannel: sportsnet }))

      expect(screen.getByRole('button', { name: 'Edmonton Oilers 2 at Calgary Flames 2, 3RD 4:32, On Live' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Toronto Maple Leafs 2 at Montreal Canadiens 2, 3RD 4:32' })).toBeInTheDocument()
    })

    it('marks nothing for a game over, or not started, on the live channel', async () => {
      useChannelStore.setState({ currentChannel: tsn5 })
      renderTicker([game(1, 'final', [broadcast('TSN5')]), otherGame(2, 'scheduled', [broadcast('TSN5')])])
      // Once the lineup has matched them
      await openGame()

      expect(screen.queryByText('On Live')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /On Live/ })).not.toBeInTheDocument()
    })

    it('shows the channel on Live as on, and offers the others', async () => {
      useAuthStore.setState({ role: 'admin' })
      useChannelStore.setState({ currentChannel: tsn5 })
      renderTicker([game(1, 'live', [broadcast('TSN5'), broadcast('SN')])])

      const popover = await openGame('Toronto Maple Leafs 2 at Montreal Canadiens 2, 3RD 4:32, On Live')

      expect(within(popover).getByRole('button', { name: 'TSN 5 is on Live' })).toBeDisabled()
      fireEvent.click(within(popover).getByRole('button', { name: 'Watch together on Sportsnet' }))
      expect(api.setCurrentChannel).toHaveBeenCalledWith(sportsnet)
    })

    it('has nothing to ask for when the game is already on Live', async () => {
      useChannelStore.setState({ currentChannel: tsn5 })
      renderTicker([game(1, 'live', [broadcast('TSN5')])])

      const popover = await openGame('Toronto Maple Leafs 2 at Montreal Canadiens 2, 3RD 4:32, On Live')

      expect(within(popover).getByText("It's on Live now.")).toBeInTheDocument()
      expect(within(popover).queryByRole('button', { name: 'Ask the group' })).not.toBeInTheDocument()
    })
  })

  it('opens inside the player shell, so it shows in fullscreen', async () => {
    const shellElement = document.createElement('div')
    document.body.appendChild(shellElement)
    const shell = { containerRef: { current: shellElement } } as unknown as PlayerShell
    mockUseNHLScores.mockReturnValue({
      data: { games: [game(1, 'live', [broadcast('TSN5')])], date: '2026-10-11', liveGameCount: 1 },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(
      <PlayerShellContext.Provider value={shell}>
        <NHLScoresOverlay isVisible={true} />
      </PlayerShellContext.Provider>
    )

    const popover = await openGame()

    expect(shellElement).toContainElement(popover)
    shellElement.remove()
  })
})
