/**
 * A per-channel index over the guide's programmes, for asking "what's on now
 * and what's next" many times a minute without re-parsing ISO strings or
 * scanning every programme. Built from the store's programmesByChannel, which
 * keeps its shape; the index is derived and cached per input object.
 */
import type { ErsatzTVProgramme } from '@/types'

export interface IndexedProgramme {
  programme: ErsatzTVProgramme
  startMs: number
  stopMs: number
}

/** Each channel's programmes, sorted by start time, with times parsed once. */
export type ProgrammeIndex = ReadonlyMap<string, readonly IndexedProgramme[]>

export interface CurrentAndNext {
  /** On air at nowMs (start inclusive, stop exclusive), or null in a gap. */
  current: IndexedProgramme | null
  /** The first programme starting after nowMs, or null when there is none. */
  next: IndexedProgramme | null
}

// Keyed by the programmesByChannel object itself: the store replaces it on
// every refresh, so an identical object means an identical index.
const cache = new WeakMap<Record<string, readonly ErsatzTVProgramme[]>, ProgrammeIndex>()

export function buildProgrammeIndex(
  programmesByChannel: Record<string, readonly ErsatzTVProgramme[]>
): ProgrammeIndex {
  const cached = cache.get(programmesByChannel)
  if (cached) return cached

  const index = new Map<string, readonly IndexedProgramme[]>()
  for (const [channelId, programmes] of Object.entries(programmesByChannel)) {
    const entries = programmes
      .map((programme) => ({
        programme,
        startMs: new Date(programme.start).getTime(),
        stopMs: new Date(programme.stop).getTime(),
      }))
      // An unparseable time would make the sort and the search meaningless
      .filter((entry) => Number.isFinite(entry.startMs) && Number.isFinite(entry.stopMs))
      .sort((a, b) => a.startMs - b.startMs)
    index.set(channelId, entries)
  }
  cache.set(programmesByChannel, index)
  return index
}

/**
 * The programme on air on a channel at nowMs and the one after it, found by
 * binary search. Assumes the schedule doesn't overlap, as ErsatzTV's doesn't.
 */
export function findCurrentAndNext(index: ProgrammeIndex, channelId: string, nowMs: number): CurrentAndNext {
  const entries = index.get(channelId)
  if (!entries) return { current: null, next: null }

  // First entry that starts after nowMs; the one before it is the latest to have started
  let low = 0
  let high = entries.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (entries[mid].startMs <= nowMs) low = mid + 1
    else high = mid
  }

  const latestStarted = low > 0 ? entries[low - 1] : null
  return {
    current: latestStarted && nowMs < latestStarted.stopMs ? latestStarted : null,
    next: entries[low] ?? null,
  }
}

/**
 * A channel's programmes that overlap [fromMs, toMs): on air at some point
 * in the range. Found by binary search, so it assumes the schedule doesn't
 * overlap (stop times then sort with start times), as findCurrentAndNext does.
 */
export function findInRange(
  index: ProgrammeIndex,
  channelId: string,
  fromMs: number,
  toMs: number
): readonly IndexedProgramme[] {
  const entries = index.get(channelId)
  if (!entries || fromMs >= toMs) return []

  // First entry still on air at fromMs
  let first = 0
  let high = entries.length
  while (first < high) {
    const mid = (first + high) >>> 1
    if (entries[mid].stopMs <= fromMs) first = mid + 1
    else high = mid
  }

  // First entry starting at or after toMs
  let end = first
  high = entries.length
  while (end < high) {
    const mid = (end + high) >>> 1
    if (entries[mid].startMs < toMs) end = mid + 1
    else high = mid
  }

  return entries.slice(first, end)
}
