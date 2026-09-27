import { useNowPlaying } from '@/hooks/useNowPlaying'
import { useTVStore, describeLiveGuide } from '@/stores/tvStore'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The header's "what am I watching" block. Line 1 is the programme, or the
 * channel name when there's none; line 2 says which channel it is and how
 * long is left. Channel 0 with something on is marked LIVE, the club's shared
 * channel. Both lines truncate, so a long title can't make the header taller.
 */
export function NowWatching() {
  const selectedChannel = useTVStore((s) => s.selectedChannel)
  const liveEPGStatus = useTVStore((s) => s.liveEPGStatus)
  const { title, timeLeft, isLive, hasLiveChannel } = useNowPlaying(selectedChannel)

  if (!selectedChannel) {
    return (
      <div className="min-w-0 flex-1" data-testid="now-watching" aria-busy="true">
        <p className="truncate text-sm font-medium leading-tight text-muted-foreground">Tuning in...</p>
        <Skeleton className="mt-1 h-3 w-40 max-w-full" data-testid="now-watching-skeleton" />
      </div>
    )
  }

  const isClubChannel = isLive && hasLiveChannel
  const details: string[] = [isClubChannel ? 'Club channel' : `CH ${selectedChannel.number}`]
  if (title) {
    details.push(selectedChannel.name)
    if (timeLeft) details.push(timeLeft)
  } else if (isClubChannel) {
    // Live with no guide data: say why rather than leave line 2 bare
    details.push(describeLiveGuide(liveEPGStatus))
  } else if (isLive) {
    details.push('Nothing on yet')
  }

  return (
    <div className="min-w-0 flex-1" data-testid="now-watching">
      <p className="truncate text-sm font-medium leading-tight">{title ?? selectedChannel.name}</p>
      <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
        {isClubChannel && (
          <span className="mr-1.5 rounded bg-live px-1.5 py-px align-middle text-[10px] font-bold uppercase leading-none text-live-foreground">
            Live
          </span>
        )}
        {details.join(' · ')}
      </p>
    </div>
  )
}
