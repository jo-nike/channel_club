import { matchNetworkToChannels, type MatcherResult } from '@/lib/nhlChannelMatcher'
import type { Channel } from '@/types'
import type { NHLBroadcast, NHLGame, NHLScoresResponse } from '@/types/nhl'

/** One of a game's broadcasts, resolved against the channel lineup. */
export interface BroadcastMatch {
  broadcast: NHLBroadcast
  result: MatcherResult
}

/** A game with each of its broadcasts resolved against the channel lineup. */
export interface GameRow {
  game: NHLGame
  /** Broadcasts in display order, each resolved against the channel list. */
  broadcasts: BroadcastMatch[]
  /** True when at least one broadcast resolves to a channel in the lineup. */
  playable: boolean
}

/** A live game you can put on: only its broadcasts that are on your channels. */
export interface GameOnNow {
  game: NHLGame
  /** The broadcasts that resolve to at least one channel, in display order. */
  broadcasts: BroadcastMatch[]
  /** Every channel carrying the game, in broadcast order, each once. */
  channels: Channel[]
}

// Broadcasts: CA first, then US; national markets before regional; then alpha.
function sortBroadcasts(a: NHLBroadcast, b: NHLBroadcast): number {
  const countryRank = (c: string) => (c === 'CA' ? 0 : c === 'US' ? 1 : 2)
  const marketRank = (m: string) => (m === 'N' ? 0 : 1)
  const c = countryRank(a.countryCode) - countryRank(b.countryCode)
  if (c !== 0) return c
  const m = marketRank(a.market) - marketRank(b.market)
  if (m !== 0) return m
  return a.network.localeCompare(b.network)
}

// Games: live -> scheduled -> final; within each status, games on your
// channels first; then by start time.
function sortGames(a: GameRow, b: GameRow): number {
  const statusOrder = { live: 0, scheduled: 1, final: 2 } as const
  const diff = statusOrder[a.game.status] - statusOrder[b.game.status]
  if (diff !== 0) return diff
  if (a.playable !== b.playable) return a.playable ? -1 : 1
  return a.game.startTime.localeCompare(b.game.startTime)
}

function matchGame(game: NHLGame, channels: Channel[], overrides: Record<string, string>): GameRow {
  const broadcasts = [...game.broadcasts].sort(sortBroadcasts).map((broadcast) => ({
    broadcast,
    result: matchNetworkToChannels(broadcast.network, channels, overrides),
  }))
  return { game, broadcasts, playable: broadcasts.some((b) => b.result.matched.length > 0) }
}

/**
 * Every game with its broadcasts resolved to channels (a pinned network wins
 * over a name match), live games first, then scheduled, then final; games on
 * your channels first within each.
 */
export function matchGames(
  games: readonly NHLGame[],
  channels: Channel[],
  overrides: Record<string, string> = {},
): GameRow[] {
  return games.map((game) => matchGame(game, channels, overrides)).sort(sortGames)
}

/** Every channel carrying a game, in broadcast order, each once. */
export function channelsOf(broadcasts: readonly BroadcastMatch[]): Channel[] {
  const byId = new Map(broadcasts.flatMap((b) => b.result.matched).map((c) => [c.id, c]))
  return [...byId.values()]
}

// Channels named in an 'Ask the group' message; the rest go unnamed, so a
// game on many feeds still makes a short message
const ASK_CHANNELS_NAMED = 3

/**
 * The chat message a viewer who can't change live TV sends to ask for a game:
 * the matchup, and where it's on when it is on your channels.
 */
export function askGroupMessage(game: NHLGame, channels: readonly Channel[]): string {
  const matchup = `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`
  const names = channels.slice(0, ASK_CHANNELS_NAMED).map((c) => c.name)
  if (names.length === 0) return `Can we watch ${matchup}?`
  const where = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
  return `Can we watch ${matchup}? It's on ${where}.`
}

/**
 * The live games you can put on right now, by start time: each live game
 * with a broadcast on one of your channels, keeping only those broadcasts.
 * Games not on your channels, and games not yet started or over, are left out.
 */
export function gamesOnNow(
  scores: NHLScoresResponse | null | undefined,
  channels: Channel[],
  overrides: Record<string, string> = {},
): GameOnNow[] {
  const live = (scores?.games ?? []).filter((game) => game.status === 'live')
  return matchGames(live, channels, overrides).flatMap(({ game, broadcasts }) => {
    const matched = broadcasts.filter((b) => b.result.matched.length > 0)
    if (matched.length === 0) return []
    return [{ game, broadcasts: matched, channels: channelsOf(matched) }]
  })
}
