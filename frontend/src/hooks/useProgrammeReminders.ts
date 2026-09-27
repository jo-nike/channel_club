import { useEffect } from 'react'
import { toast } from 'sonner'
import { useReminderStore, type ProgrammeReminder } from '@/stores/reminderStore'
import { useTVStore, LIVE_CHANNEL_ID } from '@/stores/tvStore'

// Long enough to notice while watching something else
const REMINDER_TOAST_DURATION = 20_000

/**
 * The unified channel a reminder is for, as it is now. The live slot counts
 * only while it still carries the live channel the reminder was set on: once
 * the admin has put another channel there, the programme isn't on it.
 */
function findChannel(reminder: ProgrammeReminder) {
  const channel = useTVStore.getState().getUnifiedChannels().find((c) => c.id === reminder.channelId)
  if (channel?.id === LIVE_CHANNEL_ID && channel.backendId !== reminder.liveChannelId) return undefined
  return channel
}

/**
 * '{title} starts now on {channel}', with a Watch action unless you're already
 * on it. When the channel is gone, or the live slot now carries another
 * channel, it names the channel as it was saved and offers no Watch.
 */
function notify(reminder: ProgrammeReminder) {
  const channel = findChannel(reminder)
  const isWatching = useTVStore.getState().selectedChannel?.id === reminder.channelId

  toast(`${reminder.title} starts now on ${channel?.name ?? reminder.channelName}`, {
    id: ['reminder', reminder.channelId, reminder.liveChannelId, reminder.programmeId].filter(Boolean).join('-'),
    duration: REMINDER_TOAST_DURATION,
    action:
      channel && !isWatching
        ? {
            label: 'Watch',
            onClick: () => {
              // Looked up again on click: the live slot's channel may have changed
              const current = findChannel(reminder)
              if (current) useTVStore.getState().selectChannel(current)
            },
          }
        : undefined,
  })
}

/** Toast every reminder whose start has come, and forget it; drop expired ones silently. */
function fireDueReminders() {
  const nowMs = Date.now()
  const { prune, remove } = useReminderStore.getState()
  prune(nowMs)
  for (const reminder of useReminderStore.getState().reminders) {
    if (reminder.startMs <= nowMs) {
      notify(reminder)
      remove(reminder.channelId, reminder.programmeId, reminder.liveChannelId)
    }
  }
}

/**
 * Goes off at the start of each programme with a reminder set, as an in-app
 * toast. It only runs while a tab is open: there are no push notifications.
 * One timeout, to the next start, rescheduled whenever the reminders change.
 */
export function useProgrammeReminders() {
  const reminders = useReminderStore((s) => s.reminders)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const pending = useReminderStore.getState().reminders
      if (pending.length === 0) return
      const nextStartMs = Math.min(...pending.map((r) => r.startMs))
      timer = setTimeout(() => {
        fireDueReminders()
        // A timer can fire a moment before the wall clock reaches the start,
        // leaving nothing due and the reminders unchanged: wait again
        schedule()
      }, Math.max(0, nextStartMs - Date.now()))
    }
    schedule()
    return () => clearTimeout(timer)
  }, [reminders])
}
