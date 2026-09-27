import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import type { UnifiedChannel } from '@/types'

export interface NowPlaying {
  // Title of the programme on air, or null when unknown or nothing is on
  title: string | null
}

/**
 * What is on a channel right now: the live guide's current programme for the
 * live slot, or the ErsatzTV schedule entry covering the shared programme
 * clock (re-evaluated every 30s) for other channels.
 */
export function useNowPlaying(channel: UnifiedChannel | null): NowPlaying {
  const programmeTime = useProgrammeClock()
  const liveTitle = useTVStore((s) => s.liveEPG?.currentProgram?.title ?? null)
  const programmes = useErsatztvStore((s) => (channel ? s.programmesByChannel[channel.id] : undefined))

  const title = (() => {
    if (!channel) return null

    if (channel.type === 'live') {
      return liveTitle
    }

    if (!programmes) return null
    const now = new Date(programmeTime)
    const current = programmes.find(
      (p) => new Date(p.start) <= now && new Date(p.stop) > now
    )
    return current?.title ?? null
  })()

  return { title }
}
