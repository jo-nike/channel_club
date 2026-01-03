import { useState, useEffect } from 'react'
import { useChannelStore } from '@/stores/channelStore'
import { fetchNowPlaying } from '@/services/api'
import type { EPGResponse } from '@/types'

export function useEPG() {
  const currentChannel = useChannelStore((s) => s.currentChannel)
  const [epg, setEPG] = useState<EPGResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!currentChannel?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: resetting EPG when channel is deselected
      setEPG(null)
      return
    }

    let cancelled = false
    setIsLoading(true)

    fetchNowPlaying(currentChannel.id)
      .then((data) => {
        if (!cancelled) {
          setEPG(data)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEPG(null)
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentChannel?.id])

  return { epg, isLoading }
}
