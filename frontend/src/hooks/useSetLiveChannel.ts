import { useCallback } from 'react'
import { toast } from 'sonner'
import { useChannelStore } from '@/stores/channelStore'
import { useAuthStore } from '@/stores/authStore'
import { useRecentLiveStore } from '@/stores/recentLiveStore'
import { useTVStore } from '@/stores/tvStore'
import { setCurrentChannel as setCurrentChannelApi } from '@/services/api'
import type { Channel } from '@/types'

/**
 * Puts a channel on live TV (channel 0) for everyone. The store switches
 * straight away so the live switcher responds at once; if the server refuses, the
 * previous live channel comes back and a toast says why. Resolves to whether
 * the switch went through. Only a switch the server accepted is remembered in
 * the signed-in person's recent live channels, which the admin On air card
 * and the Live TV switcher (for everyone allowed to switch) offer back.
 *
 * With `tuneActor`, the person who switched is also tuned to channel 0 once
 * the server has accepted the switch, so they land on what they picked. Only
 * the Live TV switcher asks for it: an admin switching from the admin panel
 * may want to stay on their own channel.
 *
 * The optimistic switch happens synchronously, before the returned promise
 * first yields, so callers can close their switcher right after calling it.
 */
export function useSetLiveChannel({ tuneActor = false }: { tuneActor?: boolean } = {}) {
  const setCurrentChannel = useChannelStore((s) => s.setCurrentChannel)
  const username = useAuthStore((s) => s.username)
  const recordRecent = useRecentLiveStore((s) => s.record)

  return useCallback(async (channel: Channel): Promise<boolean> => {
    const previousChannel = useChannelStore.getState().currentChannel
    setCurrentChannel(channel)

    try {
      await setCurrentChannelApi(channel)
    } catch (e) {
      // Revert on failure
      setCurrentChannel(previousChannel)
      toast.error('Failed to change channel', {
        description: e instanceof Error ? e.message : 'Please try again',
      })
      return false
    }
    if (username) recordRecent(username, channel.id)
    if (tuneActor) {
      const { getUnifiedChannels, selectChannel } = useTVStore.getState()
      selectChannel(getUnifiedChannels()[0])
    }
    return true
  }, [setCurrentChannel, username, recordRecent, tuneActor])
}
