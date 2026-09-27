/**
 * Programme time helpers shared by the guide, the channel list and the
 * programme dialog. Times are ISO 8601 strings on programmes and epoch
 * milliseconds everywhere else.
 */

export type ProgrammeState = 'past' | 'now' | 'future'

interface ProgrammeTimes {
  start: string
  stop: string
}

/** Where a programme sits relative to now: start is inclusive, stop is exclusive. */
export function getProgrammeState(programme: ProgrammeTimes, nowMs: number): ProgrammeState {
  if (nowMs < new Date(programme.start).getTime()) return 'future'
  if (nowMs < new Date(programme.stop).getTime()) return 'now'
  return 'past'
}

/** The programme on air at nowMs, or null when the schedule has a gap there. */
export function findOnAir<T extends ProgrammeTimes>(programmes: readonly T[], nowMs: number): T | null {
  return programmes.find((programme) => getProgrammeState(programme, nowMs) === 'now') ?? null
}

function formatMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

/** 'In 1h 48m', 'In 12m'. Partial minutes round up, so the last minute reads 'In 1m'. */
export function formatStartsIn(ms: number): string {
  if (ms <= 0) return 'Starting now'
  return `In ${formatMinutes(Math.ceil(ms / 60_000))}`
}

/** '32m left', '1h 5m left', '2h left', or 'Ending...' once the stop time has passed. */
export function formatRemaining(stopMs: number, nowMs: number): string {
  const remainingMs = stopMs - nowMs
  if (remainingMs <= 0) return 'Ending...'
  return `${formatMinutes(Math.ceil(remainingMs / 60_000))} left`
}

/** How far through the programme nowMs is, clamped to 0..100. */
export function calculateProgress(startMs: number, stopMs: number, nowMs: number): number {
  const totalDuration = stopMs - startMs
  if (totalDuration <= 0) return 0
  return Math.min(100, Math.max(0, ((nowMs - startMs) / totalDuration) * 100))
}
