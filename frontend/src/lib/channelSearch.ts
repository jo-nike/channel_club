/**
 * Channel search for the sidebar and the guide: a channel matches on its
 * name, its number, or the title of a programme on now or in the next 12
 * hours. Titles come from a precomputed index, so a keystroke doesn't parse
 * or scan every programme in the 48-hour guide.
 */
import { buildProgrammeIndex, findInRange } from '@/lib/programmeIndex'
import type { ChannelFilter } from '@/stores/channelPrefsStore'
import type { ErsatzTVProgramme, UnifiedChannel } from '@/types'

/** How far ahead programme titles are searched. */
export const TITLE_SEARCH_HORIZON_MS = 12 * 60 * 60 * 1000

const HOUR_MS = 60 * 60 * 1000

export interface IndexedTitle {
  /** Lowercased, ready to compare with a normalised query. */
  title: string
  startMs: number
  stopMs: number
}

/** Each channel's programme titles around the search window, in time order. */
export type TitleIndex = ReadonlyMap<string, readonly IndexedTitle[]>

// Keyed by the programmesByChannel object, which the store replaces on every
// refresh, and rebuilt when the hour or the horizon changes
const cache = new WeakMap<Record<string, readonly ErsatzTVProgramme[]>, { key: string; index: TitleIndex }>()

/**
 * The title index for searches made during nowMs's hour. It holds the
 * programmes on air at any point from the start of that hour to horizonMs
 * after its end, so it serves every moment of the hour; matchChannel then
 * narrows each search to [now, now + horizon). Memoised on
 * programmesByChannel and the hour, so the sidebar and the guide share one.
 */
export function buildTitleIndex(
  programmesByChannel: Record<string, readonly ErsatzTVProgramme[]>,
  nowMs: number,
  horizonMs: number = TITLE_SEARCH_HORIZON_MS
): TitleIndex {
  const hourStartMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  const key = `${hourStartMs}/${horizonMs}`
  const cached = cache.get(programmesByChannel)
  if (cached?.key === key) return cached.index

  const programmeIndex = buildProgrammeIndex(programmesByChannel)
  const index = new Map<string, readonly IndexedTitle[]>()
  for (const channelId of programmeIndex.keys()) {
    const entries = findInRange(programmeIndex, channelId, hourStartMs, hourStartMs + HOUR_MS + horizonMs)
    index.set(
      channelId,
      entries.map(({ programme, startMs, stopMs }) => ({ title: programme.title.toLowerCase(), startMs, stopMs }))
    )
  }
  cache.set(programmesByChannel, { key, index })
  return index
}

/** A query as matched: trimmed and lowercased. */
export function normaliseQuery(query: string): string {
  return query.trim().toLowerCase()
}

/**
 * Whether a channel matches a search: its name contains the query, its
 * number starts with it (typing '3' finds 3 and 30-39, like a remote), or a
 * programme on it now or starting within horizonMs of nowMs has the query in
 * its title. An empty query matches every channel.
 */
export function matchChannel(
  channel: UnifiedChannel,
  query: string,
  index: TitleIndex,
  nowMs: number,
  horizonMs: number = TITLE_SEARCH_HORIZON_MS
): boolean {
  const q = normaliseQuery(query)
  if (!q) return true
  if (channel.name.toLowerCase().includes(q)) return true
  if (/^\d+$/.test(q) && String(channel.number).startsWith(q)) return true
  const endMs = nowMs + horizonMs
  return (index.get(channel.id) ?? []).some(
    (entry) => entry.stopMs > nowMs && entry.startMs < endMs && entry.title.includes(q)
  )
}

export interface ChannelFilterContext {
  favouriteChannelIds: readonly string[]
  recentChannelIds: readonly string[]
  titleIndex: TitleIndex
  nowMs: number
}

/** Whether a filter narrows the list at all. */
export function isFilterActive(filter: ChannelFilter): boolean {
  return filter.mode !== 'all' || normaliseQuery(filter.query) !== ''
}

/**
 * The channels a filter leaves, in list order. The live slot (row 0) always
 * stays, first. Favourites keep channel order; Recent lists the most recent
 * first. The query then narrows whichever set the mode picked. With no
 * filter the list comes back as it was given.
 */
export function filterChannels(
  channels: UnifiedChannel[],
  filter: ChannelFilter,
  { favouriteChannelIds, recentChannelIds, titleIndex, nowMs }: ChannelFilterContext
): UnifiedChannel[] {
  if (!isFilterActive(filter)) return channels

  const live = channels.filter((channel) => channel.type === 'live')
  let rest = channels.filter((channel) => channel.type !== 'live')
  if (filter.mode === 'favourites') {
    const favourites = new Set(favouriteChannelIds)
    rest = rest.filter((channel) => favourites.has(channel.id))
  } else if (filter.mode === 'recent') {
    const byId = new Map(rest.map((channel) => [channel.id, channel]))
    rest = recentChannelIds.flatMap((id) => byId.get(id) ?? [])
  }

  return [...live, ...rest.filter((channel) => matchChannel(channel, filter.query, titleIndex, nowMs))]
}
