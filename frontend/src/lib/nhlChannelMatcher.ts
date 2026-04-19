import type { Channel } from '@/types'

/**
 * Aliases for NHL broadcast network codes.
 * Keys are normalized NHL network codes; values are substrings to search for
 * in normalized Dispatcharr channel names. Codes not listed here fall through
 * to a direct substring match on the raw code itself.
 */
const NETWORK_ALIASES: Record<string, string[]> = {
  // Canadian national
  sn: ['sportsnet'],
  sn1: ['sportsnet one', 'sn1'],
  sno: ['sportsnet ontario'],
  snw: ['sportsnet west'],
  sne: ['sportsnet east'],
  snp: ['sportsnet pacific'],
  'sn-pit': ['sportsnet pittsburgh'],
  tvas: ['tva sports', 'tva'],
  cbc: ['cbc'],
  citytv: ['citytv', 'city tv'],
  // US national
  espn: ['espn'],
  espn2: ['espn 2', 'espn2'],
  tnt: ['tnt'],
  tbs: ['tbs'],
  abc: ['abc'],
  nbc: ['nbc'],
  truetv: ['tru tv', 'truetv'],
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
  'msg+': ['msg+', 'msg plus'],
  msgsn: ['msg sportsnet'],
  // US regional — others
  nesn: ['nesn', 'new england sports'],
  altitude: ['altitude'],
  'root-nw': ['root sports northwest', 'root nw'],
  'victory+': ['victory+', 'victory plus'],
  scripps: ['scripps'],
}

/** Normalize a channel or network name for matching. */
function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/\bhd\b/g, '')
    .replace(/\busa?\b/g, '')
    .replace(/\bcan?\b/g, '')
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
 *   2. Otherwise, fuzzy-match the network code to channel names via an alias
 *      table, falling back to direct substring match on the raw code.
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

  const code = normalize(network)
  const aliases = NETWORK_ALIASES[code] ?? [code]

  const matched = channels.filter((channel) => {
    const name = normalize(channel.name)
    return aliases.some((alias) => name.includes(alias))
  })

  return { matched, isOverride: false }
}
