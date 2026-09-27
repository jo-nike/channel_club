import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { useChannelStore, type LiveChannelChange } from '@/stores/channelStore'

/** How long a change to the shared live channel is announced */
export const LIVE_CHANGE_ANNOUNCE_MS = 5000

/**
 * A change to the shared live channel to announce to a viewer on channel 0,
 * for 5s, or null. Only changes that arrive while `isOnLive` count, not the
 * last one before; your own change and live TV stopping (the player says who
 * stopped it) aren't announced. A second change restarts the 5s. The info
 * rail and, in TV theater where the rail stays away, the channel banner tell
 * it; viewers on other channels get the toast instead.
 */
export function useLiveChangeAnnouncement(isOnLive: boolean): LiveChannelChange | null {
  const [liveChange, setLiveChange] = useState<LiveChannelChange | null>(null)

  useEffect(() => {
    if (!isOnLive) return
    const unsubscribe = useChannelStore.subscribe((state, prev) => {
      const change = state.lastChange
      if (change === prev.lastChange) return
      const isOwn = change?.by != null && change.by === useAuthStore.getState().username
      setLiveChange(change?.channelName && !isOwn ? change : null)
    })
    return () => {
      unsubscribe()
      setLiveChange(null)
    }
  }, [isOnLive])

  // Keyed on the change, so a second change restarts the 5s
  useEffect(() => {
    if (!liveChange) return
    const timer = setTimeout(() => setLiveChange(null), LIVE_CHANGE_ANNOUNCE_MS)
    return () => clearTimeout(timer)
  }, [liveChange])

  return liveChange
}
