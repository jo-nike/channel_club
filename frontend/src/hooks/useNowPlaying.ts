import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { calculateProgress, findOnAir, formatRemaining } from '@/lib/programmes'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore } from '@/stores/tvStore'
import type { UnifiedChannel } from '@/types'

export interface NowPlaying {
  // Title of the programme on air, or null when unknown or nothing is on
  title: string | null
  // The programme's start and stop in epoch ms, or null with no programme
  startMs: number | null
  endMs: number | null
  // '32m left', '1h 5m left' or 'Ending...', or null with no programme
  timeLeft: string | null
  // How far through the programme the clock is, 0..100, or null with no programme
  progress: number | null
  // The channel is the live slot (channel 0)
  isLive: boolean
  // Something is on live TV, whichever channel this is
  hasLiveChannel: boolean
}

interface ProgrammeWindow {
  title: string
  startMs: number
  endMs: number
}

/**
 * What is on a channel right now: the live guide's current programme for the
 * live slot, or the ErsatzTV schedule entry covering the shared programme
 * clock (re-evaluated every 30s) for other channels. Both are normalised to
 * one shape, with the time left and progress measured on the same clock.
 */
export function useNowPlaying(channel: UnifiedChannel | null): NowPlaying {
  const programmeTime = useProgrammeClock()
  const liveProgram = useTVStore((s) => s.liveEPG?.currentProgram ?? null)
  const programmes = useErsatztvStore((s) => (channel ? s.programmesByChannel[channel.id] : undefined))
  const hasLiveChannel = useChannelStore((s) => s.currentChannel !== null)
  const isLive = channel?.type === 'live'

  const programme = ((): ProgrammeWindow | null => {
    if (!channel) return null

    if (isLive) {
      if (!liveProgram) return null
      return {
        title: liveProgram.title,
        startMs: new Date(liveProgram.startTime).getTime(),
        endMs: new Date(liveProgram.endTime).getTime(),
      }
    }

    if (!programmes) return null
    const current = findOnAir(programmes, programmeTime)
    if (!current) return null
    return {
      title: current.title,
      startMs: new Date(current.start).getTime(),
      endMs: new Date(current.stop).getTime(),
    }
  })()

  if (!programme) {
    return { title: null, startMs: null, endMs: null, timeLeft: null, progress: null, isLive, hasLiveChannel }
  }

  return {
    ...programme,
    timeLeft: formatRemaining(programme.endMs, programmeTime),
    progress: calculateProgress(programme.startMs, programme.endMs, programmeTime),
    isLive,
    hasLiveChannel,
  }
}
