import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@/test/utils'
import { NHLGamesTab } from './NHLGamesTab'
import { useNhlMappingStore } from '@/stores/nhlMappingStore'
import type { Channel, GroupedChannelsResponse } from '@/types'
import type { GameStatus, NHLBroadcast, NHLGame, NHLScoresResponse } from '@/types/nhl'

const mockUseNHLScores = vi.fn()
vi.mock('@/hooks/useNHLScores', () => ({
  useNHLScores: () => mockUseNHLScores(),
}))

const mockFetchGroupedChannels = vi.fn<() => Promise<GroupedChannelsResponse>>()
vi.mock('@/services/api', () => ({
  fetchGroupedChannels: () => mockFetchGroupedChannels(),
  setCurrentChannel: vi.fn(),
}))

const ch = (id: string, name: string): Channel => ({
  id,
  name,
  streamUrl: `stream://${id}`,
  guideId: id,
})

const CHANNELS: Channel[] = [
  ch('tsn5', 'CA-S: TSN 5'),
  ch('sn360', 'CA-S: SPORTSNET 360'),
  ch('nhln', 'US: NHL Network'),
]

const team = (abbreviation: string) => ({
  name: abbreviation,
  abbreviation,
  score: 0,
  logo: '',
  logoDark: '',
})

const broadcast = (network: string, countryCode = 'CA'): NHLBroadcast => ({
  network,
  market: 'N',
  countryCode,
})

function game(
  id: number,
  away: string,
  home: string,
  status: GameStatus,
  startTime: string,
  broadcasts: NHLBroadcast[],
): NHLGame {
  return {
    id,
    status,
    awayTeam: team(away),
    homeTeam: team(home),
    startTime,
    gameCenterLink: '',
    broadcasts,
  }
}

function setGames(games: NHLGame[]) {
  const data: NHLScoresResponse = {
    games,
    date: '2026-10-11',
    liveGameCount: games.filter((g) => g.status === 'live').length,
  }
  mockUseNHLScores.mockReturnValue({ data, isLoading: false, error: null, refetch: vi.fn() })
}

async function renderTab() {
  render(<NHLGamesTab />)
  return screen.findByRole('heading', { name: 'NHL Games' })
}

/** Away-team abbreviations in the order the cards are rendered. */
function cardOrder(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="card"]')).map(
    (card) => card.querySelector('span[title]')?.textContent ?? '',
  )
}

describe('NHLGamesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useNhlMappingStore.setState({ overrides: {} })
    mockFetchGroupedChannels.mockResolvedValue({
      groups: [{ id: 1, name: 'Sports', channelCount: CHANNELS.length, channels: CHANNELS }],
      ungrouped: [],
    })
  })

  it('counts the games on your channels in the subtitle', async () => {
    setGames([
      game(1, 'TOR', 'MTL', 'live', '2026-10-11T23:00:00Z', [broadcast('SN360')]),
      game(2, 'EDM', 'CGY', 'scheduled', '2026-10-12T02:00:00Z', [broadcast('TSN5')]),
      game(3, 'LAK', 'ANA', 'scheduled', '2026-10-12T02:30:00Z', [broadcast('KCOP-13', 'US')]),
    ])
    await renderTab()

    expect(
      screen.getByText('3 games · 2 on your channels · click a broadcast to put it on'),
    ).toBeInTheDocument()
  })

  it('does not promise a click when no game is on your channels', async () => {
    setGames([
      game(1, 'LAK', 'ANA', 'scheduled', '2026-10-12T02:30:00Z', [broadcast('KCOP-13', 'US')]),
    ])
    await renderTab()

    expect(screen.getByText('1 game · 0 on your channels')).toBeInTheDocument()
    expect(screen.queryByText(/click a broadcast/)).not.toBeInTheDocument()
  })

  it('counts a game playable when its network is pinned to a channel', async () => {
    useNhlMappingStore.setState({ overrides: { 'KCOP-13': 'nhln' } })
    setGames([
      game(1, 'LAK', 'ANA', 'scheduled', '2026-10-12T02:30:00Z', [broadcast('KCOP-13', 'US')]),
    ])
    await renderTab()

    expect(
      screen.getByText('1 game · 1 on your channels · click a broadcast to put it on'),
    ).toBeInTheDocument()
  })

  it('lists playable games first within each status, keeping live before scheduled before final', async () => {
    setGames([
      game(1, 'FIN', 'BOS', 'final', '2026-10-11T17:00:00Z', [broadcast('TSN5')]),
      game(2, 'SCH', 'NYR', 'scheduled', '2026-10-11T22:00:00Z', [broadcast('SN360')]),
      // Unplayable live game that starts first...
      game(3, 'LAK', 'ANA', 'live', '2026-10-11T19:00:00Z', [broadcast('KCOP-13', 'US')]),
      // ...still comes after the playable live game that starts later.
      game(4, 'TOR', 'MTL', 'live', '2026-10-11T23:00:00Z', [broadcast('TSN5')]),
      game(5, 'UTA', 'VGK', 'live', '2026-10-11T20:00:00Z', [broadcast('Utah16', 'US')]),
    ])
    await renderTab()

    expect(cardOrder()).toEqual(['TOR', 'LAK', 'UTA', 'SCH', 'FIN'])
  })

  it('folds networks not in your lineup behind a toggle that still reaches their pin', async () => {
    setGames([
      game(1, 'TOR', 'MTL', 'live', '2026-10-11T23:00:00Z', [
        broadcast('TSN5'),
        broadcast('KCOP-13', 'US'),
        broadcast('MSG-B', 'US'),
      ]),
    ])
    await renderTab()

    // The playable network is shown; the unmatched ones are folded away.
    expect(screen.getByTitle('Play CA-S: TSN 5')).toBeInTheDocument()
    expect(screen.queryByText('KCOP-13')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Pin channel to KCOP-13' }),
    ).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: '+2 not in your lineup' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveTextContent('Hide 2 not in your lineup')
    expect(screen.getByText('KCOP-13')).toBeInTheDocument()
    expect(screen.getByText('MSG-B')).toBeInTheDocument()

    // Pinning a folded network makes it playable.
    fireEvent.click(screen.getByRole('button', { name: 'Pin channel to KCOP-13' }))
    fireEvent.click(await screen.findByRole('button', { name: 'US: NHL Network' }))

    expect(useNhlMappingStore.getState().overrides).toEqual({ 'KCOP-13': 'nhln' })
    expect(screen.getByTitle('Play US: NHL Network')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 not in your lineup/ })).toBeInTheDocument()
  })
})
