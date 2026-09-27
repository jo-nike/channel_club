import { useCallback } from 'react'
import { toast } from 'sonner'
import { useChannelStore } from '@/stores/channelStore'
import { setCurrentChannel as setCurrentChannelApi } from '@/services/api'
import type { Channel } from '@/types'

/**
 * Puts a channel on live TV (channel 0) for everyone. The store switches
 * straight away so the picker responds at once; if the server refuses, the
 * previous live channel comes back and a toast says why. Resolves to whether
 * the switch went through.
 *
 * The optimistic switch happens synchronously, before the returned promise
 * first yields, so callers can close their picker right after calling it.
 */
export function useSetLiveChannel() {
  const setCurrentChannel = useChannelStore((s) => s.setCurrentChannel)

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
    return true
  }, [setCurrentChannel])
}
