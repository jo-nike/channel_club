import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatDuration } from './utils'

describe('formatDuration', () => {
  beforeEach(() => {
    // Mock current time to 2026-01-04T12:00:00Z for consistent tests
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-04T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should format duration less than an hour', () => {
    // 30 minutes ago
    const thirtyMinutesAgo = '2026-01-04T11:30:00Z'
    expect(formatDuration(thirtyMinutesAgo)).toBe('30m')
  })

  it('should format duration of exactly 1 hour', () => {
    // 1 hour ago
    const oneHourAgo = '2026-01-04T11:00:00Z'
    expect(formatDuration(oneHourAgo)).toBe('1h 0m')
  })

  it('should format duration with hours and minutes', () => {
    // 2 hours and 15 minutes ago
    const twoHoursFifteenMinutesAgo = '2026-01-04T09:45:00Z'
    expect(formatDuration(twoHoursFifteenMinutesAgo)).toBe('2h 15m')
  })

  it('should format very short durations', () => {
    // 5 minutes ago
    const fiveMinutesAgo = '2026-01-04T11:55:00Z'
    expect(formatDuration(fiveMinutesAgo)).toBe('5m')
  })

  it('should format 0 minutes as 0m', () => {
    // Just now
    const now = '2026-01-04T12:00:00Z'
    expect(formatDuration(now)).toBe('0m')
  })

  it('should handle many hours', () => {
    // 10 hours ago
    const tenHoursAgo = '2026-01-04T02:00:00Z'
    expect(formatDuration(tenHoursAgo)).toBe('10h 0m')
  })

  it('should handle complex hours and minutes', () => {
    // 4 hours and 45 minutes ago
    const complexDuration = '2026-01-04T07:15:00Z'
    expect(formatDuration(complexDuration)).toBe('4h 45m')
  })
})
