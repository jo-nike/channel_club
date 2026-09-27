import type { Channel } from '@/types'

/**
 * Aliases for NHL broadcast network codes.
 * Keys are compact NHL network codes (see `compact()`: 'SN-PIT' -> 'snpit',
 * 'MSG+' -> 'msgplus'); values are phrases to look for in Dispatcharr channel
 * names. The code itself is always tried as well, so codes whose channel names
 * spell them out ('TSN5' -> 'TSN 5') need no entry, except to mark a numbered
 * feed family (see `NUMBERED_FEED_PREFIXES`): 'rds2' is listed so that plain
 * 'RDS' stays off 'RDS 2'.
 */
const NETWORK_ALIASES: Record<string, string[]> = {
  // Canadian national
  sn: ['sportsnet'],
  sn1: ['sportsnet one', 'sn1'],
  sn360: ['sportsnet 360'],
  sno: ['sportsnet ontario'],
  snw: ['sportsnet west'],
  sne: ['sportsnet east'],
  snp: ['sportsnet pacific'],
  snpit: ['sportsnet pittsburgh'],
  tsn: ['tsn', 'tsn 1', 'tsn 2', 'tsn 3', 'tsn 4', 'tsn 5'],
  tvas: ['tva sports'],
  tvas2: ['tva sports 2'],
  rds2: ['rds 2'],
  cbc: ['cbc'],
  city: ['citytv', 'city tv'],
  // US national
  espn: ['espn'],
  espn2: ['espn 2', 'espn2'],
  tnt: ['tnt'],
  tbs: ['tbs'],
  abc: ['abc'],
  nbc: ['nbc'],
  truetv: ['tru tv', 'truetv'],
  nhln: ['nhl network'],
  // US regional — FanDuel Sports Network (formerly Bally)
  fdsnso: ['fanduel sports south', 'bally sports south'],
  fdsnno: ['fanduel sports north', 'bally sports north'],
  fdsnwi: ['fanduel sports wisconsin', 'bally sports wisconsin'],
  fdsndet: ['fanduel sports detroit', 'bally sports detroit'],
  fdsnoh: ['fanduel sports ohio', 'bally sports ohio'],
  fdsnsw: ['fanduel sports southwest', 'bally sports southwest'],
  fdsnfl: ['fanduel sports florida', 'bally sports florida'],
  fdsnsu: ['fanduel sports sun', 'bally sports sun'],
  fdsnaz: ['fanduel sports arizona', 'bally sports arizona'],
  // US regional — NBC Sports RSNs
  nbcsp: ['nbc sports philadelphia'],
  nbcsca: ['nbc sports california'],
  nbcsba: ['nbc sports bay area'],
  nbcsbos: ['nbc sports boston'],
  nbcswa: ['nbc sports washington'],
  // US regional — MSG
  msg: ['msg', 'madison square garden'],
  msgplus: ['msg+', 'msg plus'],
  msgsn: ['msg sportsnet'],
  msgsn2: ['msg sportsnet 2'],
  // US regional — others
  nesn: ['nesn', 'new england sports'],
  alt: ['altitude'],
  alt2: ['altitude 2'],
  rootnw: ['root sports northwest', 'root nw'],
  victoryplus: ['victory+', 'victory plus'],
  scripps: ['scripps'],
}

/** Channel-name tokens that carry no network identity (quality and country tags). */
const IGNORED_NAME_TOKENS = new Set(['hd', 'us', 'usa', 'ca', 'can'])

const NUMERIC_TOKEN = /^\d+$/

/** Lowercase and split on anything that isn't a letter or digit; '+' reads as 'plus'. */
function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Tokens joined without spaces, so 'SN-PIT', 'sn pit' and 'SNPIT' all read 'snpit'. */
function compact(input: string): string {
  return tokenize(input).join('')
}

/**
 * Phrases that have numbered sibling feeds in the alias table ('tsn' because
 * of 'tsn5', 'espn' because of 'espn2', 'sportsnet' because of 'sportsnet360').
 * Only these refuse a match that is followed by a number, so 'ESPN' stays off
 * 'ESPN 2' while 'ABC' still matches a local affiliate listed as 'ABC 7'.
 */
const NUMBERED_FEED_PREFIXES = new Set(
  Object.entries(NETWORK_ALIASES)
    .flatMap(([key, aliases]) => [key, ...aliases.map(compact)])
    .map((phrase) => /^(.*[a-z])\d+$/.exec(phrase)?.[1])
    .filter((prefix): prefix is string => prefix !== undefined),
)

/**
 * True when some contiguous run of `tokens`, joined without spaces, equals
 * `phrase` and, for a numbered feed family, is not immediately followed by a
 * number. The number rule keeps 'ESPN' off 'ESPN 2', 'TVAS' off 'TVA Sports 2'
 * and 'SN' off 'Sportsnet 360'; whole tokens keep 'TSN' off 'Sportsnet'.
 */
function containsPhrase(tokens: string[], phrase: string): boolean {
  for (let start = 0; start < tokens.length; start++) {
    let joined = ''
    for (let end = start; end < tokens.length; end++) {
      joined += tokens[end]
      if (!phrase.startsWith(joined)) break
      if (joined === phrase) {
        const next = tokens[end + 1]
        if (next === undefined || !NUMERIC_TOKEN.test(next) || !NUMBERED_FEED_PREFIXES.has(phrase)) {
          return true
        }
      }
    }
  }
  return false
}

export interface MatcherResult {
  /** Channels matched for this network (may be empty). */
  matched: Channel[]
  /** True when the match came from a user-defined override. */
  isOverride: boolean
}

/**
 * Resolve an NHL broadcast network to Dispatcharr channels.
 *
 * Two-stage:
 *   1. If the user pinned this network in `overrides` and that channel still
 *      exists, return exactly that channel (isOverride=true).
 *   2. Otherwise, match the network code and its aliases against whole tokens
 *      of each channel name. A code that is empty after tokenising matches
 *      nothing.
 */
export function matchNetworkToChannels(
  network: string,
  channels: Channel[],
  overrides: Record<string, string> = {},
): MatcherResult {
  const overrideId = overrides[network]
  if (overrideId) {
    const pinned = channels.find((c) => c.id === overrideId)
    if (pinned) {
      return { matched: [pinned], isOverride: true }
    }
    // Override points to a channel that no longer exists — fall through to auto.
  }

  const code = compact(network)
  if (!code) return { matched: [], isOverride: false }
  const phrases = [code, ...(NETWORK_ALIASES[code] ?? []).map(compact)]

  const matched = channels.filter((channel) => {
    const tokens = tokenize(channel.name).filter((t) => !IGNORED_NAME_TOKENS.has(t))
    return phrases.some((phrase) => containsPhrase(tokens, phrase))
  })

  return { matched, isOverride: false }
}
