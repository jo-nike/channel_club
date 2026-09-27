import { describe, it, expect } from 'vitest'
import { buildProgrammeIndex, findCurrentAndNext, findInRange } from './programmeIndex'
import type { ErsatzTVProgramme } from '@/types'

const at = (iso: string) => new Date(iso).getTime()

function programme(id: string, start: string, stop: string): ErsatzTVProgramme {
  return { id, channelId: 'etv1', title: id, start, stop }
}

// Deliberately out of order: the index sorts by start time
const schedule = [
  programme('c', '2026-01-03T20:00:00Z', '2026-01-03T20:30:00Z'),
  programme('a', '2026-01-03T19:00:00Z', '2026-01-03T19:22:00Z'),
  // 19:47-20:00 is a gap
  programme('b', '2026-01-03T19:22:00Z', '2026-01-03T19:47:00Z'),
]

const ids = (result: ReturnType<typeof findCurrentAndNext>) => ({
  current: result.current?.programme.id ?? null,
  next: result.next?.programme.id ?? null,
})

describe('buildProgrammeIndex', () => {
  it('sorts each channel by start and parses the times once', () => {
    const index = buildProgrammeIndex({ etv1: schedule })

    const entries = index.get('etv1')
    expect(entries?.map((entry) => entry.programme.id)).toEqual(['a', 'b', 'c'])
    expect(entries?.[0]).toMatchObject({ startMs: at('2026-01-03T19:00:00Z'), stopMs: at('2026-01-03T19:22:00Z') })
  })

  it('does not reorder the store array it was given', () => {
    const programmes = [...schedule]
    buildProgrammeIndex({ etv1: programmes })

    expect(programmes.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })

  it('returns the same index for the same input object and a new one for a new object', () => {
    const programmesByChannel = { etv1: schedule }

    const first = buildProgrammeIndex(programmesByChannel)
    expect(buildProgrammeIndex(programmesByChannel)).toBe(first)
    expect(buildProgrammeIndex({ etv1: schedule })).not.toBe(first)
  })

  it('leaves out programmes whose times do not parse', () => {
    const index = buildProgrammeIndex({
      etv1: [...schedule, programme('broken', 'not a date', '2026-01-03T21:00:00Z')],
    })

    expect(index.get('etv1')?.map((entry) => entry.programme.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('findCurrentAndNext', () => {
  const index = buildProgrammeIndex({ etv1: schedule, etv2: [] })

  it('finds the programme on air and the one after it', () => {
    expect(ids(findCurrentAndNext(index, 'etv1', at('2026-01-03T19:30:00Z')))).toEqual({ current: 'b', next: 'c' })
  })

  it('treats the start instant as on air (start is inclusive)', () => {
    expect(ids(findCurrentAndNext(index, 'etv1', at('2026-01-03T19:22:00Z')))).toEqual({ current: 'b', next: 'c' })
  })

  it('moves on at the stop instant (stop is exclusive)', () => {
    expect(ids(findCurrentAndNext(index, 'etv1', at('2026-01-03T19:22:00Z') - 1))).toEqual({ current: 'a', next: 'b' })
  })

  it('has nothing on air in a gap but still knows what is next', () => {
    expect(ids(findCurrentAndNext(index, 'etv1', at('2026-01-03T19:47:00Z')))).toEqual({ current: null, next: 'c' })
    expect(ids(findCurrentAndNext(index, 'etv1', at('2026-01-03T19:59:00Z')))).toEqual({ current: null, next: 'c' })
  })

  it('has only a next programme before the schedule starts', () => {
    expect(ids(findCurrentAndNext(index, 'etv1', at('2026-01-03T18:00:00Z')))).toEqual({ current: null, next: 'a' })
  })

  it('has no next programme during the last one, and nothing after the schedule ends', () => {
    expect(ids(findCurrentAndNext(index, 'etv1', at('2026-01-03T20:10:00Z')))).toEqual({ current: 'c', next: null })
    expect(ids(findCurrentAndNext(index, 'etv1', at('2026-01-03T20:30:00Z')))).toEqual({ current: null, next: null })
  })

  it('finds nothing on a channel with no programmes or no entry', () => {
    const now = at('2026-01-03T19:30:00Z')
    expect(ids(findCurrentAndNext(index, 'etv2', now))).toEqual({ current: null, next: null })
    expect(ids(findCurrentAndNext(index, 'unknown', now))).toEqual({ current: null, next: null })
  })

  it('agrees with a linear scan at every minute of a long schedule', () => {
    const start = at('2026-01-03T00:00:00Z')
    const MINUTE = 60_000
    // Back-to-back 25-minute programmes with a 5-minute gap after every third
    const long: ErsatzTVProgramme[] = []
    let cursor = start
    for (let i = 0; i < 60; i++) {
      const stop = cursor + 25 * MINUTE
      long.push(programme(`p${i}`, new Date(cursor).toISOString(), new Date(stop).toISOString()))
      cursor = i % 3 === 2 ? stop + 5 * MINUTE : stop
    }
    const longIndex = buildProgrammeIndex({ etv1: long })

    for (let now = start - 30 * MINUTE; now < cursor + 30 * MINUTE; now += MINUTE) {
      const current = long.find((p) => at(p.start) <= now && now < at(p.stop))?.id ?? null
      const next = long.find((p) => at(p.start) > now)?.id ?? null
      expect(ids(findCurrentAndNext(longIndex, 'etv1', now))).toEqual({ current, next })
    }
  })
})

describe('findInRange', () => {
  const index = buildProgrammeIndex({ etv1: schedule, etv2: [] })
  const range = (from: string, to: string) =>
    findInRange(index, 'etv1', at(from), at(to)).map((entry) => entry.programme.id)

  it('finds the programmes on air at any point in the range, in start order', () => {
    expect(range('2026-01-03T19:10:00Z', '2026-01-03T20:10:00Z')).toEqual(['a', 'b', 'c'])
    expect(range('2026-01-03T19:30:00Z', '2026-01-03T19:40:00Z')).toEqual(['b'])
  })

  it('leaves out a programme that stops at the range start or starts at its end', () => {
    // a stops at 19:22 and c starts at 20:00
    expect(range('2026-01-03T19:22:00Z', '2026-01-03T20:00:00Z')).toEqual(['b'])
  })

  it('finds nothing in a gap, before the schedule, after it, or in an empty range', () => {
    expect(range('2026-01-03T19:50:00Z', '2026-01-03T19:55:00Z')).toEqual([])
    expect(range('2026-01-03T17:00:00Z', '2026-01-03T19:00:00Z')).toEqual([])
    expect(range('2026-01-03T20:30:00Z', '2026-01-03T22:00:00Z')).toEqual([])
    expect(range('2026-01-03T19:30:00Z', '2026-01-03T19:30:00Z')).toEqual([])
  })

  it('finds nothing on a channel with no programmes or no entry', () => {
    expect(findInRange(index, 'etv2', at('2026-01-03T19:00:00Z'), at('2026-01-03T21:00:00Z'))).toEqual([])
    expect(findInRange(index, 'unknown', at('2026-01-03T19:00:00Z'), at('2026-01-03T21:00:00Z'))).toEqual([])
  })

  it('agrees with a linear filter over every range of a long schedule', () => {
    const start = at('2026-01-03T00:00:00Z')
    const MINUTE = 60_000
    // Back-to-back 25-minute programmes with a 5-minute gap after every third
    const long: ErsatzTVProgramme[] = []
    let cursor = start
    for (let i = 0; i < 40; i++) {
      const stop = cursor + 25 * MINUTE
      long.push(programme(`p${i}`, new Date(cursor).toISOString(), new Date(stop).toISOString()))
      cursor = i % 3 === 2 ? stop + 5 * MINUTE : stop
    }
    const longIndex = buildProgrammeIndex({ etv1: long })

    for (let from = start - 30 * MINUTE; from < cursor + 30 * MINUTE; from += 7 * MINUTE) {
      for (const length of [1, 20, 95, 400]) {
        const to = from + length * MINUTE
        const expected = long.filter((p) => at(p.stop) > from && at(p.start) < to).map((p) => p.id)
        expect(findInRange(longIndex, 'etv1', from, to).map((entry) => entry.programme.id)).toEqual(expected)
      }
    }
  })
})
