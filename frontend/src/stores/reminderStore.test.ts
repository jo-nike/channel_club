import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  REMINDER_GRACE_MS,
  isReminderExpired,
  useHasReminder,
  useReminderStore,
  type ProgrammeReminder,
} from './reminderStore'

const NOW = new Date('2026-01-03T19:00:00Z').getTime()

const reminder = (programmeId: string, startMs: number, channelId = 'ch1'): ProgrammeReminder => ({
  programmeId,
  channelId,
  channelName: 'Cartoons',
  title: `Show ${programmeId}`,
  startMs,
})

const ids = () => useReminderStore.getState().reminders.map((r) => r.programmeId)

describe('reminderStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    useReminderStore.setState({ reminders: [] })
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds reminders', () => {
    const { add } = useReminderStore.getState()
    add(reminder('a', NOW + 60_000))
    add(reminder('b', NOW + 120_000))

    expect(ids()).toEqual(['a', 'b'])
  })

  it('does not add the same programme twice', () => {
    const { add } = useReminderStore.getState()
    add(reminder('a', NOW + 60_000))
    add(reminder('a', NOW + 60_000))

    expect(ids()).toEqual(['a'])
  })

  it('tells programmes with the same id on different channels apart', () => {
    const { add, remove } = useReminderStore.getState()
    add(reminder('a', NOW + 60_000, 'ch1'))
    add(reminder('a', NOW + 60_000, 'ch2'))
    remove('ch1', 'a')

    expect(useReminderStore.getState().reminders.map((r) => r.channelId)).toEqual(['ch2'])
  })

  it('tells the live slot apart by the live channel it carried', () => {
    const { add, remove } = useReminderStore.getState()
    add({ ...reminder('live-a', NOW + 60_000, 'live-channel-0'), liveChannelId: '7' })
    add({ ...reminder('live-a', NOW + 60_000, 'live-channel-0'), liveChannelId: '9' })
    remove('live-channel-0', 'live-a', '7')

    expect(useReminderStore.getState().reminders.map((r) => r.liveChannelId)).toEqual(['9'])
  })

  it('removes a reminder', () => {
    const { add, remove } = useReminderStore.getState()
    add(reminder('a', NOW + 60_000))
    add(reminder('b', NOW + 120_000))
    remove('ch1', 'a')

    expect(ids()).toEqual(['b'])
  })

  it('prunes only reminders past the grace period', () => {
    const { add, prune } = useReminderStore.getState()
    add(reminder('long-gone', NOW - REMINDER_GRACE_MS - 1))
    add(reminder('just-started', NOW - 30_000))
    add(reminder('later', NOW + 60_000))
    prune(NOW)

    expect(ids()).toEqual(['just-started', 'later'])
  })

  it('isReminderExpired is false up to the grace period and true after it', () => {
    expect(isReminderExpired(reminder('a', NOW - REMINDER_GRACE_MS), NOW)).toBe(false)
    expect(isReminderExpired(reminder('a', NOW - REMINDER_GRACE_MS - 1), NOW)).toBe(true)
  })

  it("persists under 'reminder-storage'", () => {
    useReminderStore.getState().add(reminder('a', NOW + 60_000))

    const saved = JSON.parse(localStorage.getItem('reminder-storage') ?? '{}')
    expect(saved.state.reminders).toEqual([reminder('a', NOW + 60_000)])
  })

  it('drops expired reminders when it loads', async () => {
    localStorage.setItem(
      'reminder-storage',
      JSON.stringify({
        state: { reminders: [reminder('expired', NOW - REMINDER_GRACE_MS - 1), reminder('upcoming', NOW + 60_000)] },
        version: 0,
      })
    )

    await useReminderStore.persist.rehydrate()

    expect(ids()).toEqual(['upcoming'])
  })

  describe('useHasReminder', () => {
    it('says whether that programme on that channel has a reminder', () => {
      useReminderStore.getState().add(reminder('a', NOW + 60_000))

      expect(renderHook(() => useHasReminder('ch1', 'a')).result.current).toBe(true)
      expect(renderHook(() => useHasReminder('ch2', 'a')).result.current).toBe(false)
      expect(renderHook(() => useHasReminder(undefined, undefined)).result.current).toBe(false)
    })

    it('on the live slot, only while it carries the same live channel', () => {
      useReminderStore.getState().add({ ...reminder('live-a', NOW + 60_000, 'live-channel-0'), liveChannelId: '7' })

      expect(renderHook(() => useHasReminder('live-channel-0', 'live-a', '7')).result.current).toBe(true)
      expect(renderHook(() => useHasReminder('live-channel-0', 'live-a', '9')).result.current).toBe(false)
      expect(renderHook(() => useHasReminder('live-channel-0', 'live-a')).result.current).toBe(false)
    })
  })
})
