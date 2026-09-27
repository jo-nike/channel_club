import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * How late a reminder may still go off. A background tab's timers can be
 * throttled to about once a minute, and a sleeping laptop's much longer; past
 * this, "starts now" would no longer be true, so the reminder is dropped.
 */
export const REMINDER_GRACE_MS = 5 * 60_000

/** A programme someone asked to be reminded of when it starts. */
export interface ProgrammeReminder {
  programmeId: string
  /** A unified channel id: an ErsatzTV channel, or the live slot. */
  channelId: string
  /** The channel's name when the reminder was set, in case it's gone by then. */
  channelName: string
  /**
   * On the live slot, the id of the live channel it carried when the reminder
   * was set. The admin can put another channel on the slot before the start,
   * and its programmes have ids from their start times, so the slot and
   * programme ids alone can't tell the two channels' programmes apart.
   */
  liveChannelId?: string
  title: string
  startMs: number
}

/** A reminder whose start is too long ago to go off any more. */
export function isReminderExpired(reminder: ProgrammeReminder, nowMs: number): boolean {
  return nowMs - reminder.startMs > REMINDER_GRACE_MS
}

const isSameReminder = (a: ProgrammeReminder, channelId: string, programmeId: string, liveChannelId?: string) =>
  a.channelId === channelId && a.programmeId === programmeId && a.liveChannelId === liveChannelId

interface ReminderState {
  /** Reminders set in this browser, in the order they were set. */
  reminders: ProgrammeReminder[]
  /** Set a reminder; setting one that's already set changes nothing. */
  add: (reminder: ProgrammeReminder) => void
  remove: (channelId: string, programmeId: string, liveChannelId?: string) => void
  /** Drop the reminders that have expired by nowMs. */
  prune: (nowMs: number) => void
}

export const useReminderStore = create<ReminderState>()(
  persist(
    (set) => ({
      reminders: [],

      add: (reminder) =>
        set((state) =>
          state.reminders.some((r) =>
            isSameReminder(r, reminder.channelId, reminder.programmeId, reminder.liveChannelId)
          )
            ? state
            : { reminders: [...state.reminders, reminder] }
        ),

      remove: (channelId, programmeId, liveChannelId) =>
        set((state) => ({
          reminders: state.reminders.filter((r) => !isSameReminder(r, channelId, programmeId, liveChannelId)),
        })),

      prune: (nowMs) =>
        set((state) =>
          state.reminders.some((r) => isReminderExpired(r, nowMs))
            ? { reminders: state.reminders.filter((r) => !isReminderExpired(r, nowMs)) }
            : state
        ),
    }),
    {
      name: 'reminder-storage',
      partialize: (state) => ({ reminders: state.reminders }),
      // Reminders for programmes that started while no tab was open are dropped
      // on load rather than kept forever
      merge: (persisted, current) => {
        const saved = (persisted as Partial<Pick<ReminderState, 'reminders'>> | undefined)?.reminders
        const nowMs = Date.now()
        return {
          ...current,
          reminders: Array.isArray(saved) ? saved.filter((r) => !isReminderExpired(r, nowMs)) : current.reminders,
        }
      },
    }
  )
)

/**
 * Whether a reminder is set for this programme on this channel (and, on the
 * live slot, while it carries the same live channel).
 */
export function useHasReminder(
  channelId: string | undefined,
  programmeId: string | undefined,
  liveChannelId?: string
): boolean {
  return useReminderStore((s) =>
    channelId !== undefined && programmeId !== undefined
      ? s.reminders.some((r) => isSameReminder(r, channelId, programmeId, liveChannelId))
      : false
  )
}
