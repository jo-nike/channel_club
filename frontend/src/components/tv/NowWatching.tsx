import { useNowPlaying } from '@/hooks/useNowPlaying'
import { useChannelStore } from '@/stores/channelStore'
import { useTVStore, describeLiveGuide } from '@/stores/tvStore'
import { useUIStore } from '@/stores/uiStore'
import { Skeleton } from '@/components/ui/skeleton'
import { LivePill } from '@/components/LivePill'

/**
 * The header's "what am I watching" block. Line 1 is the programme, or the
 * channel name when there's none; line 2 says which channel it is and how
 * long is left. Channel 0 with something on is marked LIVE, the club's shared
 * channel. Both lines truncate, so a long title can't make the header taller.
 *
 * While live TV is on and you're elsewhere, a 'Live now · Join' chip tunes to
 * channel 0 in one tap. It shows only where channel 0 isn't already one click
 * away: on phones (in place of line 2) and with the desktop sidebar collapsed.
 */
export function NowWatching({ isMobile }: { isMobile: boolean }) {
  const selectedChannel = useTVStore((s) => s.selectedChannel)
  const liveEPGStatus = useTVStore((s) => s.liveEPGStatus)
  const selectChannel = useTVStore((s) => s.selectChannel)
  const getUnifiedChannels = useTVStore((s) => s.getUnifiedChannels)
  const liveChannel = useChannelStore((s) => s.currentChannel)
  const isChannelSidebarCollapsed = useUIStore((s) => s.isChannelSidebarCollapsed)
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

  const showJoin = !isLive && liveChannel !== null && (isMobile || isChannelSidebarCollapsed)
  const joinChip = showJoin && (
    <button
      type="button"
      onClick={() => selectChannel(getUnifiedChannels()[0])}
      // A 44px touch area around the 24px chip, so the header keeps its height
      className="relative inline-flex min-h-6 min-w-0 max-w-xs items-center gap-1.5 rounded-full bg-live-surface px-2 text-xs leading-tight text-foreground hover:bg-live/20 pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-2.5"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-live" aria-hidden="true" />
      {/* On phones the prefix is for screen readers only, so who's here beside
          it squeezes nothing but the name; the dot and Join say it's live */}
      <span className="truncate">
        {/* The space sits outside, so the accessible name keeps it */}
        <span className="sr-only md:not-sr-only md:whitespace-nowrap">Live now:</span> {liveChannel.name}
      </span>
      <span aria-hidden="true">·</span>
      <span className="shrink-0 font-semibold text-live">Join</span>
    </button>
  )

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3" data-testid="now-watching">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium leading-tight">{title ?? selectedChannel.name}</p>
        {joinChip && isMobile ? (
          <div className="mt-0.5 flex min-w-0">{joinChip}</div>
        ) : (
          <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
            {isClubChannel && <LivePill className="mr-1.5 align-middle" />}
            {details.join(' · ')}
          </p>
        )}
      </div>
      {joinChip && !isMobile && joinChip}
    </div>
  )
}
