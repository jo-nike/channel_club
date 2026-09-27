import { describe, it, expect } from 'vitest'
import {
  calculateProgress,
  findOnAir,
  formatRemaining,
  formatRemainingSpoken,
  formatStartsIn,
  getProgrammeState,
} from './programmes'

const MINUTE = 60_000
const at = (iso: string) => new Date(iso).getTime()

describe('getProgrammeState', () => {
  const programme = { start: '2026-01-03T19:22:00Z', stop: '2026-01-03T19:47:00Z' }

  it('is future before the start', () => {
    expect(getProgrammeState(programme, at('2026-01-03T19:22:00Z') - 1)).toBe('future')
  })

  it('is now from the start instant (start is inclusive)', () => {
    expect(getProgrammeState(programme, at('2026-01-03T19:22:00Z'))).toBe('now')
  })

  it('is now until just before the stop', () => {
    expect(getProgrammeState(programme, at('2026-01-03T19:47:00Z') - 1)).toBe('now')
  })

  it('is past at the stop instant (stop is exclusive)', () => {
    expect(getProgrammeState(programme, at('2026-01-03T19:47:00Z'))).toBe('past')
  })
})

describe('findOnAir', () => {
  const schedule = [
    { id: 'a', start: '2026-01-03T19:00:00Z', stop: '2026-01-03T19:22:00Z' },
    { id: 'b', start: '2026-01-03T19:22:00Z', stop: '2026-01-03T19:47:00Z' },
    // 19:47-20:00 is a gap
    { id: 'c', start: '2026-01-03T20:00:00Z', stop: '2026-01-03T20:30:00Z' },
  ]

  it('returns the programme on air', () => {
    expect(findOnAir(schedule, at('2026-01-03T19:30:00Z'))?.id).toBe('b')
  })

  it('hands over at the boundary to the programme that starts then', () => {
    expect(findOnAir(schedule, at('2026-01-03T19:22:00Z'))?.id).toBe('b')
  })

  it('returns null inside a gap', () => {
    expect(findOnAir(schedule, at('2026-01-03T19:50:00Z'))).toBeNull()
  })

  it('returns null before and after the schedule and for an empty list', () => {
    expect(findOnAir(schedule, at('2026-01-03T18:00:00Z'))).toBeNull()
    expect(findOnAir(schedule, at('2026-01-03T21:00:00Z'))).toBeNull()
    expect(findOnAir([], at('2026-01-03T19:30:00Z'))).toBeNull()
  })
})

describe('formatStartsIn', () => {
  it('formats hours and minutes', () => {
    expect(formatStartsIn(108 * MINUTE)).toBe('In 1h 48m')
  })

  it('formats minutes only under an hour', () => {
    expect(formatStartsIn(12 * MINUTE)).toBe('In 12m')
  })

  it('formats whole hours without minutes', () => {
    expect(formatStartsIn(120 * MINUTE)).toBe('In 2h')
  })

  it('rounds a partial minute up', () => {
    expect(formatStartsIn(30_000)).toBe('In 1m')
    expect(formatStartsIn(11 * MINUTE + 1)).toBe('In 12m')
  })

  it('says starting now once the start is reached', () => {
    expect(formatStartsIn(0)).toBe('Starting now')
  })
})

describe('formatRemaining', () => {
  const now = at('2026-01-03T19:00:00Z')

  it('says Ending... at or after the stop', () => {
    expect(formatRemaining(now, now)).toBe('Ending...')
    expect(formatRemaining(now - MINUTE, now)).toBe('Ending...')
  })

  it('formats minutes under an hour', () => {
    expect(formatRemaining(now + 32 * MINUTE, now)).toBe('32m left')
  })

  it('rounds a partial minute up', () => {
    expect(formatRemaining(now + 1, now)).toBe('1m left')
  })

  it('formats whole hours without minutes', () => {
    expect(formatRemaining(now + 60 * MINUTE, now)).toBe('1h left')
  })

  it('formats hours and minutes', () => {
    expect(formatRemaining(now + 65 * MINUTE, now)).toBe('1h 5m left')
  })
})

describe('formatRemainingSpoken', () => {
  const now = at('2026-01-03T19:00:00Z')

  it('spells the units out, singular for one', () => {
    expect(formatRemainingSpoken(now + 32 * MINUTE, now)).toBe('32 minutes left')
    expect(formatRemainingSpoken(now + 1, now)).toBe('1 minute left')
    expect(formatRemainingSpoken(now + 60 * MINUTE, now)).toBe('1 hour left')
    expect(formatRemainingSpoken(now + 65 * MINUTE, now)).toBe('1 hour 5 minutes left')
    expect(formatRemainingSpoken(now + 121 * MINUTE, now)).toBe('2 hours 1 minute left')
  })

  it('says ending at or after the stop', () => {
    expect(formatRemainingSpoken(now, now)).toBe('ending')
  })
})

describe('calculateProgress', () => {
  const start = at('2026-01-03T19:00:00Z')
  const stop = start + 100 * MINUTE

  it('is the elapsed share of the programme', () => {
    expect(calculateProgress(start, stop, start + 25 * MINUTE)).toBe(25)
  })

  it('clamps to 0 before the start and 100 after the stop', () => {
    expect(calculateProgress(start, stop, start - MINUTE)).toBe(0)
    expect(calculateProgress(start, stop, stop + MINUTE)).toBe(100)
  })

  it('is 0 for a programme with no duration', () => {
    expect(calculateProgress(start, start, start)).toBe(0)
  })
})
