import { describe, expect, it } from 'vitest'
import {
  buildTitleIndex,
  filterChannels,
  isFilterActive,
  matchChannel,
  TITLE_SEARCH_HORIZON_MS,
  type ChannelFilterContext,
} from './channelSearch'
import type { ErsatzTVProgramme, UnifiedChannel } from '@/types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
// 20:10 UTC: ten minutes into an hour, so the hour the index is built for is easy to follow
const NOW = Date.UTC(2026, 8, 27, 20, 10)

function programme(channelId: string, title: string, startOffsetMs: number, durationMs: number): ErsatzTVProgramme {
  return {
    id: `${channelId}-${title}-${startOffsetMs}`,
    channelId,
    title,
    start: new Date(NOW + startOffsetMs).toISOString(),
    stop: new Date(NOW + startOffsetMs + durationMs).toISOString(),
  }
}

const channel = (id: string, name: string, number: number): UnifiedChannel => ({
  id,
  name,
  number,
  streamUrl: '',
  type: 'ersatztv',
})

const live: UnifiedChannel = { id: 'live-channel-0', name: 'TSN 5', number: 0, streamUrl: '', type: 'live' }
const movies = channel('etv1', 'Movies', 1)
const cartoons = channel('etv2', 'Cartoons', 2)
const news = channel('etv3', 'News', 3)
const sports = channel('etv30', 'Sports', 30)

describe('buildTitleIndex and matchChannel', () => {
  it('matches a title on now', () => {
    const index = buildTitleIndex({ etv2: [programme('etv2', 'The Simpsons', -5 * MINUTE, 30 * MINUTE)] }, NOW)

    expect(matchChannel(cartoons, 'simpsons', index, NOW)).toBe(true)
  })

  it('matches a title starting within the next 12 hours, and not one starting after', () => {
    const programmesByChannel = {
      etv2: [programme('etv2', 'Futurama', TITLE_SEARCH_HORIZON_MS - MINUTE, 30 * MINUTE)],
      etv3: [programme('etv3', 'Futurama', TITLE_SEARCH_HORIZON_MS + MINUTE, 30 * MINUTE)],
    }
    const index = buildTitleIndex(programmesByChannel, NOW)

    expect(TITLE_SEARCH_HORIZON_MS).toBe(12 * HOUR)
    expect(matchChannel(cartoons, 'futurama', index, NOW)).toBe(true)
    expect(matchChannel(news, 'futurama', index, NOW)).toBe(false)
  })

  it("doesn't match a programme that has already ended, even earlier in the same hour", () => {
    // 20:00-20:05, over by 20:10
    const index = buildTitleIndex({ etv2: [programme('etv2', 'Archer', -10 * MINUTE, 5 * MINUTE)] }, NOW)

    expect(matchChannel(cartoons, 'archer', index, NOW)).toBe(false)
  })

  it('keeps the 12-hour window exact later in the hour the index was built for', () => {
    const programmesByChannel = { etv2: [programme('etv2', 'Futurama', 12 * HOUR + 30 * MINUTE, 30 * MINUTE)] }
    const later = NOW + 40 * MINUTE // 20:50, same hour

    const index = buildTitleIndex(programmesByChannel, later)

    expect(index).toBe(buildTitleIndex(programmesByChannel, NOW))
    expect(matchChannel(cartoons, 'futurama', index, NOW)).toBe(false)
    expect(matchChannel(cartoons, 'futurama', index, later)).toBe(true)
  })

  it('is built once per programme refresh and hour', () => {
    const programmesByChannel = { etv2: [programme('etv2', 'The Simpsons', 0, 30 * MINUTE)] }
    const first = buildTitleIndex(programmesByChannel, NOW)

    expect(buildTitleIndex(programmesByChannel, NOW + 30 * MINUTE)).toBe(first)
    expect(buildTitleIndex(programmesByChannel, NOW + HOUR)).not.toBe(first)
    expect(buildTitleIndex({ ...programmesByChannel }, NOW)).not.toBe(first)
  })

  it('matches names ignoring case and surrounding space', () => {
    const index = buildTitleIndex({}, NOW)

    expect(matchChannel(cartoons, '  CART ', index, NOW)).toBe(true)
    expect(matchChannel(cartoons, 'news', index, NOW)).toBe(false)
  })

  it('matches channel numbers from their first digit, like a remote', () => {
    const index = buildTitleIndex({}, NOW)

    expect(matchChannel(news, '3', index, NOW)).toBe(true)
    expect(matchChannel(sports, '3', index, NOW)).toBe(true)
    expect(matchChannel(sports, '30', index, NOW)).toBe(true)
    expect(matchChannel(news, '30', index, NOW)).toBe(false)
    expect(matchChannel(sports, '0', index, NOW)).toBe(false)
  })

  it('matches everything on an empty query', () => {
    expect(matchChannel(cartoons, '   ', buildTitleIndex({}, NOW), NOW)).toBe(true)
  })
})

describe('filterChannels', () => {
  const channels = [live, movies, cartoons, news, sports]
  const context = (overrides: Partial<ChannelFilterContext> = {}): ChannelFilterContext => ({
    favouriteChannelIds: [],
    recentChannelIds: [],
    titleIndex: buildTitleIndex(
      {
        etv2: [programme('etv2', 'The Simpsons', 0, 30 * MINUTE)],
        etv30: [programme('etv30', 'The Simpsons Movie', 2 * HOUR, 90 * MINUTE)],
      },
      NOW
    ),
    nowMs: NOW,
    ...overrides,
  })
  const ids = (list: UnifiedChannel[]) => list.map((c) => c.id)

  it('returns the list untouched with no filter', () => {
    expect(filterChannels(channels, { query: ' ', mode: 'all' }, context())).toBe(channels)
    expect(isFilterActive({ query: ' ', mode: 'all' })).toBe(false)
  })

  it('keeps row 0 first and the channels whose name, number or upcoming titles match', () => {
    const result = filterChannels(channels, { query: 'simpsons', mode: 'all' }, context())

    expect(ids(result)).toEqual(['live-channel-0', 'etv2', 'etv30'])
  })

  it('keeps row 0 even when nothing else matches', () => {
    expect(ids(filterChannels(channels, { query: 'zzz', mode: 'all' }, context()))).toEqual(['live-channel-0'])
  })

  it('lists the favourites in channel order', () => {
    const result = filterChannels(channels, { query: '', mode: 'favourites' }, context({ favouriteChannelIds: ['etv30', 'etv1'] }))

    expect(ids(result)).toEqual(['live-channel-0', 'etv1', 'etv30'])
    expect(isFilterActive({ query: '', mode: 'favourites' })).toBe(true)
  })

  it('lists the recents most recent first, skipping channels no longer listed', () => {
    const result = filterChannels(
      channels,
      { query: '', mode: 'recent' },
      context({ recentChannelIds: ['etv3', 'gone', 'etv1', 'etv2'] })
    )

    expect(ids(result)).toEqual(['live-channel-0', 'etv3', 'etv1', 'etv2'])
  })

  it('narrows the chosen set with the query', () => {
    const result = filterChannels(
      channels,
      { query: 'simpsons', mode: 'favourites' },
      context({ favouriteChannelIds: ['etv1', 'etv30'] })
    )

    expect(ids(result)).toEqual(['live-channel-0', 'etv30'])
  })
})
