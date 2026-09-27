import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { findOnAir, formatRemaining, formatStartsIn, getProgrammeState } from '@/lib/programmes'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, LIVE_CHANNEL_ID } from '@/stores/tvStore'
import type { ErsatzTVProgramme } from '@/types'

/** The channel a programme is on: an ErsatzTV channel, or the live slot. */
export interface ProgrammeDetailsChannel {
  id: string
  name: string
}

interface ProgrammeDetailsModalProps {
  programme: ErsatzTVProgramme | null
  channel: ProgrammeDetailsChannel | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onWatch: (channel: ProgrammeDetailsChannel) => void
}

export function ProgrammeDetailsModal({
  programme,
  channel,
  open,
  onOpenChange,
  onWatch,
}: ProgrammeDetailsModalProps) {
  const now = useProgrammeClock()
  const selectedChannelId = useTVStore((s) => s.selectedChannel?.id)
  // The live slot's schedule is the live channel's, from the live guide
  const isLiveSlot = channel?.id === LIVE_CHANNEL_ID
  const liveProgrammes = useTVStore((s) => (isLiveSlot ? s.liveProgrammes : undefined))
  const ersatzProgrammes = useErsatztvStore((s) =>
    channel && !isLiveSlot ? s.programmesByChannel[channel.id] : undefined
  )
  const channelProgrammes = liveProgrammes ?? ersatzProgrammes

  if (!programme || !channel) return null

  const state = getProgrammeState(programme, now)
  const isWatching = selectedChannelId === channel.id
  const onAirNow = findOnAir(channelProgrammes ?? [], now)

  const startTime = new Date(programme.start)
  const endTime = new Date(programme.stop)
  const duration = Math.round(
    (endTime.getTime() - startTime.getTime()) / (1000 * 60)
  )

  const handleWatch = () => {
    onWatch(channel)
    onOpenChange(false)
  }

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const status =
    state === 'future'
      ? formatStartsIn(startTime.getTime() - now)
      : state === 'now'
        ? formatRemaining(endTime.getTime(), now)
        : `Ended at ${formatTime(endTime)}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl">{programme.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1">
              {(programme.season != null || programme.episode != null || programme.year) && (
                <p className="text-sm text-muted-foreground">
                  {[
                    (programme.season != null || programme.episode != null) &&
                      [
                        programme.season != null && `S${String(programme.season).padStart(2, '0')}`,
                        programme.episode != null && `E${String(programme.episode).padStart(2, '0')}`,
                      ].filter(Boolean).join(''),
                    programme.year,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
              <p className="text-muted-foreground">
                {status} · {formatTime(startTime)} - {formatTime(endTime)} ({duration} min) · {channel.name}
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {programme.description ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <p>{programme.description}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No description available
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:items-center">
          {state === 'now' ? (
            isWatching ? (
              <p className="text-sm font-medium">You're watching this</p>
            ) : (
              <Button onClick={handleWatch}>Watch now</Button>
            )
          ) : (
            // Upcoming or ended: the only honest action is the channel as it is now.
            <>
              {onAirNow && (
                <p className="text-sm text-muted-foreground sm:mr-auto">
                  On now: {onAirNow.title}
                </p>
              )}
              {isWatching ? (
                <p className="text-sm font-medium">You're watching {channel.name}</p>
              ) : (
                <Button variant="ghost" onClick={handleWatch}>
                  Watch {channel.name} now
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
