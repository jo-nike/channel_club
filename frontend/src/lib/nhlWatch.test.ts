import { describe, expect, it } from 'vitest'
import { channelsOf, gamesOnNow, liveGameId, matchGames } from './nhlWatch'
import type { Channel } from '@/types'
import type { BroadcastMarket, GameStatus, NHLBroadcast, NHLGame, NHLScoresResponse } from '@/types/nhl'

const ch = (id: string, name: string): Channel => ({ id, name, streamUrl: `stream://${id}`, guideId: id })

const CHANNELS: Channel[] = [
  ch('tsn5', 'CA-S: TSN 5'),
  ch('sn', 'CA-S: Sportsnet'),
  ch('snw', 'CA-S: Sportsnet West'),
  ch('espn', 'US: ESPN'),
  ch('nhln', 'US: NHL Network'),
]

const team = (abbreviation: string) => ({ name: abbreviation, abbreviation, score: 0, logo: '', logoDark: '' })

const broadcast = (network: string, countryCode = 'CA', market: BroadcastMarket = 'N'): NHLBroadcast => ({
  network,
  market,
  countryCode,
})

function game(id: number, away: string, status: GameStatus, startTime: string, broadcasts: NHLBroadcast[]): NHLGame {
  return {
    id,
    status,
    awayTeam: team(away),
    homeTeam: team('HOM'),
    startTime,
    gameCenterLink: '',
    broadcasts,
  }
}

function scores(games: NHLGame[]): NHLScoresResponse {
  return { games, date: '2026-10-11', liveGameCount: games.filter((g) => g.status === 'live').length }
}

const ids = (channels: Channel[]) => channels.map((c) => c.id)

describe('gamesOnNow', () => {
  it('lists live games on your channels by start time, each with only its matched broadcasts', () => {
    const late = game(1, 'LAK', 'live', '2026-10-12T02:00:00Z', [broadcast('KCOP-13', 'US', 'H'), broadcast('ESPN', 'US')])
    const early = game(2, 'TOR', 'live', '2026-10-11T23:00:00Z', [broadcast('NHLN', 'US'), broadcast('TSN5')])

    const result = gamesOnNow(scores([late, early]), CHANNELS)

    expect(result.map((r) => r.game.awayTeam.abbreviation)).toEqual(['TOR', 'LAK'])
    // Canadian national first, then US; the unmatched local broadcast is dropped
    expect(result[0].broadcasts.map((b) => b.broadcast.network)).toEqual(['TSN5', 'NHLN'])
    expect(ids(result[0].channels)).toEqual(['tsn5', 'nhln'])
    expect(result[1].broadcasts.map((b) => b.broadcast.network)).toEqual(['ESPN'])
    expect(ids(result[1].channels)).toEqual(['espn'])
  })

  it('leaves out live games with no broadcast on your channels', () => {
    const unmatched = game(1, 'ANA', 'live', '2026-10-11T23:00:00Z', [broadcast('KCOP-13', 'US', 'H'), broadcast('Victory+', 'US', 'A')])
    const noBroadcasts = game(2, 'SEA', 'live', '2026-10-11T23:00:00Z', [])

    expect(gamesOnNow(scores([unmatched, noBroadcasts]), CHANNELS)).toEqual([])
  })

  it('leaves out games that have not started or are over, even on your channels', () => {
    const scheduled = game(1, 'OTT', 'scheduled', '2026-10-11T23:00:00Z', [broadcast('TSN5')])
    const final = game(2, 'MTL', 'final', '2026-10-11T17:00:00Z', [broadcast('ESPN', 'US')])

    expect(gamesOnNow(scores([scheduled, final]), CHANNELS)).toEqual([])
  })

  it('lists a channel once when two of the game broadcasts resolve to it', () => {
    const live = game(1, 'EDM', 'live', '2026-10-11T23:00:00Z', [broadcast('SN'), broadcast('SNW', 'CA', 'H')])

    const [entry] = gamesOnNow(scores([live]), CHANNELS)

    // SN matches both Sportsnet feeds, and SNW matches Sportsnet West again
    expect(entry.broadcasts.map((b) => ids(b.result.matched))).toEqual([['sn', 'snw'], ['snw']])
    expect(ids(entry.channels)).toEqual(['sn', 'snw'])
  })

  it('puts a pinned network on its pinned channel instead of the name match', () => {
    const live = game(1, 'BOS', 'live', '2026-10-11T23:00:00Z', [broadcast('ESPN', 'US')])

    const [entry] = gamesOnNow(scores([live]), CHANNELS, { ESPN: 'nhln' })

    expect(ids(entry.channels)).toEqual(['nhln'])
    expect(entry.broadcasts[0].result.isOverride).toBe(true)
  })

  it('makes a game playable through a pin when no channel name matches', () => {
    const live = game(1, 'VGK', 'live', '2026-10-11T23:00:00Z', [broadcast('Scripps', 'US', 'H')])

    expect(gamesOnNow(scores([live]), CHANNELS)).toEqual([])
    expect(ids(gamesOnNow(scores([live]), CHANNELS, { Scripps: 'tsn5' })[0].channels)).toEqual(['tsn5'])
  })

  it('has nothing on before the scores have loaded', () => {
    expect(gamesOnNow(null, CHANNELS)).toEqual([])
    expect(gamesOnNow(undefined, CHANNELS)).toEqual([])
  })
})

describe('matchGames', () => {
  it('orders live, scheduled then final, games on your channels first within each', () => {
    const rows = matchGames(
      [
        game(1, 'FIN', 'final', '2026-10-11T17:00:00Z', [broadcast('TSN5')]),
        game(2, 'SCU', 'scheduled', '2026-10-11T23:00:00Z', [broadcast('KCOP-13', 'US', 'H')]),
        game(3, 'SCM', 'scheduled', '2026-10-12T01:00:00Z', [broadcast('ESPN', 'US')]),
        game(4, 'LIV', 'live', '2026-10-11T22:00:00Z', []),
      ],
      CHANNELS,
    )

    expect(rows.map((r) => [r.game.awayTeam.abbreviation, r.playable])).toEqual([
      ['LIV', false],
      ['SCM', true],
      ['SCU', false],
      ['FIN', true],
    ])
  })
})

describe('channelsOf', () => {
  it('lists every matched channel in broadcast order, each once', () => {
    const [row] = matchGames(
      [game(1, 'EDM', 'live', '2026-10-11T23:00:00Z', [broadcast('SNW', 'CA', 'H'), broadcast('SN'), broadcast('ESPN', 'US')])],
      CHANNELS,
    )

    // SN (national) sorts first and matches both Sportsnet feeds; SNW repeats one
    expect(ids(channelsOf(row.broadcasts))).toEqual(['sn', 'snw', 'espn'])
  })

  it('is empty when no broadcast is on your channels', () => {
    const [row] = matchGames([game(1, 'ANA', 'live', '2026-10-11T23:00:00Z', [broadcast('KCOP-13', 'US', 'H')])], CHANNELS)

    expect(channelsOf(row.broadcasts)).toEqual([])
  })
})

describe('liveGameId', () => {
  it('finds the live game with a broadcast on the live channel', () => {
    const rows = matchGames(
      [
        game(1, 'TOR', 'live', '2026-10-11T23:00:00Z', [broadcast('TSN5')]),
        game(2, 'EDM', 'live', '2026-10-11T23:00:00Z', [broadcast('KCOP-13', 'US', 'H'), broadcast('ESPN', 'US')]),
      ],
      CHANNELS,
    )

    expect(liveGameId(rows, 'espn')).toBe(2)
    expect(liveGameId(rows, 'tsn5')).toBe(1)
  })

  it('never picks a game that has not started or is over, even on the live channel', () => {
    const rows = matchGames(
      [
        game(1, 'FIN', 'final', '2026-10-11T17:00:00Z', [broadcast('TSN5')]),
        game(2, 'SCH', 'scheduled', '2026-10-12T02:00:00Z', [broadcast('TSN5')]),
      ],
      CHANNELS,
    )

    expect(liveGameId(rows, 'tsn5')).toBeNull()
  })

  it('picks the live game over earlier and later games on the same channel', () => {
    const rows = matchGames(
      [
        game(1, 'FIN', 'final', '2026-10-11T17:00:00Z', [broadcast('TSN5')]),
        game(2, 'LIV', 'live', '2026-10-11T23:00:00Z', [broadcast('TSN5')]),
        game(3, 'SCH', 'scheduled', '2026-10-12T02:00:00Z', [broadcast('TSN5')]),
      ],
      CHANNELS,
    )

    expect(liveGameId(rows, 'tsn5')).toBe(2)
  })

  it('follows a pinned network to its channel', () => {
    const rows = matchGames([game(1, 'VGK', 'live', '2026-10-11T23:00:00Z', [broadcast('Scripps', 'US', 'H')])], CHANNELS, {
      Scripps: 'nhln',
    })

    expect(liveGameId(rows, 'nhln')).toBe(1)
  })

  it('is null with nothing on live TV, or no game on the live channel', () => {
    const rows = matchGames([game(1, 'TOR', 'live', '2026-10-11T23:00:00Z', [broadcast('TSN5')])], CHANNELS)

    expect(liveGameId(rows, null)).toBeNull()
    expect(liveGameId(rows, 'espn')).toBeNull()
  })
})
