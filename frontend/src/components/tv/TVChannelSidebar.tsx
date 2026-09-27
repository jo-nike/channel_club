import { useEffect, useRef, type Ref } from 'react'
import { AudioLines, ChevronLeft, ChevronRight, Radio } from 'lucide-react'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, describeLiveGuide } from '@/stores/tvStore'
import { getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { calculateProgress, findOnAir, formatRemaining, getProgrammeState } from '@/lib/programmes'
import { buildProgrammeIndex, findCurrentAndNext, type IndexedProgramme } from '@/lib/programmeIndex'
import { cn } from '@/lib/utils'
import type { UnifiedChannel } from '@/types'

interface TVChannelSidebarProps {
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  liveEPGTitle?: string | null
  // Opens the live channel picker; only for people allowed to change live TV
  onPickLive?: () => void
}

export function TVChannelSidebar({
  isCollapsed = false,
  onToggleCollapse,
  liveEPGTitle,
  onPickLive,
}: TVChannelSidebarProps) {
  const { channels: ersatzTVChannels, channelsLoading, error, loadChannels } = useErsatztvStore()
  const { selectedChannel, selectChannel, getUnifiedChannels, isLiveChannelActive, liveEPGStatus } = useTVStore()
  // Now/next come from the guide's programmes, which TVView refreshes every
  // 2h, so a schedule edit in ErsatzTV shows here on that refresh
  const programmesByChannel = useErsatztvStore((s) => s.programmesByChannel)
  const now = useProgrammeClock()
  const programmeIndex = buildProgrammeIndex(programmesByChannel)

  // Get unified channel list
  const unifiedChannels = getUnifiedChannels()
  const hasLiveChannel = isLiveChannelActive()

  // Keep the selected channel in view: when the list mounts (a restored
  // channel may be far down), when the rail collapses or expands, and when
  // the selection changes. Only one of the rail or the list is mounted, so
  // they share the map.
  const channelRefs = useRef(new Map<string, HTMLButtonElement>())
  const setChannelRef = (channelId: string) => (element: HTMLButtonElement | null) => {
    if (element) channelRefs.current.set(channelId, element)
    else channelRefs.current.delete(channelId)
  }
  const selectedChannelId = selectedChannel?.id
  useEffect(() => {
    if (!selectedChannelId) return
    channelRefs.current.get(selectedChannelId)?.scrollIntoView({ block: 'nearest' })
  }, [isCollapsed, selectedChannelId])

  const handleChannelClick = (channel: UnifiedChannel) => {
    selectChannel(channel)
  }

  // Collapsed state
  if (isCollapsed) {
    return (
      <aside className="flex h-full w-16 flex-col items-center border-r bg-card py-2 rounded-r-lg overflow-hidden">
        <button
          onClick={onToggleCollapse}
          className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent"
          aria-label="Expand channel sidebar"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
        {/* No scrollbar: a classic 15px one would widen the list past the 64px rail
            and push the tiles off-centre. Wheel, touch and keyboard focus still scroll it. */}
        <div className="mt-2 flex w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-3 pt-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {unifiedChannels.map((channel) => (
            <CollapsedChannelButton
              key={channel.id}
              ref={setChannelRef(channel.id)}
              channel={channel}
              isSelected={selectedChannel?.id === channel.id}
              hasLiveChannel={hasLiveChannel}
              canPickLive={!!onPickLive}
              onSelect={handleChannelClick}
            />
          ))}
        </div>
      </aside>
    )
  }

  // Expanded state
  return (
    <aside className="epg-scroll h-full w-72 overflow-y-auto border-r bg-card rounded-r-lg">
      <div className="sticky top-0 flex items-center justify-between border-b bg-card/95 p-4 backdrop-blur">
        <h2 className="text-lg font-semibold">Channels</h2>
        <button
          onClick={onToggleCollapse}
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
          aria-label="Collapse channel sidebar"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      </div>

      <ul className="divide-y" role="list">
        {unifiedChannels.map((channel) => {
          const { current: onAir, next } =
            channel.type === 'live'
              ? { current: null, next: null }
              : findCurrentAndNext(programmeIndex, channel.id, now)
          return (
            <ChannelItem
              key={channel.id}
              ref={setChannelRef(channel.id)}
              channel={channel}
              isSelected={selectedChannel?.id === channel.id}
              onSelect={handleChannelClick}
              currentProgramme={
                channel.type === 'live' ? liveEPGTitle || describeLiveGuide(liveEPGStatus) : onAir?.programme.title
              }
              onAir={onAir}
              next={next}
              currentTime={now}
              hasLiveChannel={hasLiveChannel}
              onPickLive={onPickLive}
            />
          )
        })}
      </ul>
      {/* The live row above doesn't wait for ErsatzTV */}
      {channelsLoading && ersatzTVChannels.length === 0 && <SidebarSkeleton />}
      {/* The error's details are in the toast TVView shows; this keeps a retry where the channels would be */}
      {error && (
        <div className="m-3 rounded-lg border bg-background/50 p-4">
          <p className="text-sm text-destructive">Couldn't load channels 1-36</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => loadChannels()}>
            Retry
          </Button>
        </div>
      )}
    </aside>
  )
}

// ============================================================================
// Collapsed Channel Button
// ============================================================================

interface CollapsedChannelButtonProps {
  ref?: Ref<HTMLButtonElement>
  channel: UnifiedChannel
  isSelected: boolean
  hasLiveChannel: boolean
  // Whether this viewer may put something on live TV (changes the empty-slot copy)
  canPickLive: boolean
  onSelect: (channel: UnifiedChannel) => void
}

function CollapsedChannelButton({
  ref,
  channel,
  isSelected,
  hasLiveChannel,
  canPickLive,
  onSelect,
}: CollapsedChannelButtonProps) {
  const isLive = channel.type === 'live'
  const isLiveOn = isLive && hasLiveChannel

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          onClick={() => onSelect(channel)}
          className={cn(
            'relative flex h-10 shrink-0 scroll-my-1 items-center justify-center rounded-lg font-display text-sm font-extrabold tabular-nums overflow-hidden',
            'hover:bg-foreground/10 focus-visible:-outline-offset-2',
            isLive ? 'w-auto min-w-10 px-1' : 'w-10',
            isSelected && 'ring-2 ring-primary',
            // One background: the live tint wins (the ring marks selection), then selection, then muted
            isLiveOn ? 'bg-live/20 text-live' : isSelected ? 'bg-primary/10' : 'bg-muted'
          )}
          aria-label={isLive ? 'Live Channel' : `${channel.number} ${channel.name}`}
          aria-pressed={isSelected}
        >
          {isLive ? (
            hasLiveChannel ? (
              <Radio className="h-4 w-4 text-live" />
            ) : (
              '0'
            )
          ) : channel.logoUrl ? (
            <>
              <img
                src={getErsatzTVLogoUrl(channel.id)}
                alt=""
                className="h-full w-full object-contain"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
              {/* The aria-label already carries the number */}
              <span
                aria-hidden="true"
                className="absolute bottom-0 right-0 flex h-4 min-w-4 items-center justify-center rounded-tl-md bg-background/85 px-0.5 text-xs leading-none text-foreground"
              >
                {channel.number}
              </span>
            </>
          ) : (
            channel.number
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <ChannelTooltipBody channel={channel} hasLiveChannel={hasLiveChannel} canPickLive={canPickLive} />
      </TooltipContent>
    </Tooltip>
  )
}

// Radix mounts tooltip content only while it's open, so the clock and the
// store reads below run only for the tile being hovered or focused.
function ChannelTooltipBody({
  channel,
  hasLiveChannel,
  canPickLive,
}: {
  channel: UnifiedChannel
  hasLiveChannel: boolean
  canPickLive: boolean
}) {
  const now = useProgrammeClock()
  const programmes = useErsatztvStore((s) => s.programmesByChannel[channel.id])
  const liveEPG = useTVStore((s) => s.liveEPG)
  const liveEPGStatus = useTVStore((s) => s.liveEPGStatus)

  const isLive = channel.type === 'live'
  let nowTitle: string | undefined
  let nextTitle: string | undefined
  if (isLive) {
    nowTitle = liveEPG?.currentProgram?.title
    nextTitle = liveEPG?.nextProgram?.title
  } else if (programmes) {
    nowTitle = findOnAir(programmes, now)?.title
    nextTitle = programmes.find((p) => getProgrammeState(p, now) === 'future')?.title
  }

  return (
    <div className="max-w-56 space-y-0.5">
      <p className="font-medium">
        <span className="tabular-nums">{channel.number}</span> {channel.name}
      </p>
      {isLive && !hasLiveChannel ? (
        // Same copy as the expanded live row
        <p className="text-muted-foreground">
          {canPickLive ? 'Nothing on yet' : 'Waiting for someone to put something on'}
        </p>
      ) : (
        <>
          {/* Live TV is on but the guide has no title: say why, like the expanded row */}
          {isLive && !nowTitle && (
            <p className="text-muted-foreground">{describeLiveGuide(liveEPGStatus)}</p>
          )}
          {nowTitle && (
            <p className="truncate">
              <span className="text-muted-foreground">Now</span> {nowTitle}
            </p>
          )}
          {nextTitle && (
            <p className="truncate">
              <span className="text-muted-foreground">Next</span> {nextTitle}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ============================================================================
// Expanded Channel Item
// ============================================================================

// Created once: the Next line formats a time on every row on every tick
const nextTimeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

interface ChannelItemProps {
  ref?: Ref<HTMLButtonElement>
  channel: UnifiedChannel
  isSelected: boolean
  onSelect: (channel: UnifiedChannel) => void
  currentProgramme?: string | null
  // The ErsatzTV programme on air, with its parsed times
  onAir: IndexedProgramme | null
  // The ErsatzTV programme after it (or after the gap)
  next: IndexedProgramme | null
  currentTime: number
  hasLiveChannel: boolean
  onPickLive?: () => void
}

function ChannelItem({
  ref,
  channel,
  isSelected,
  onSelect,
  currentProgramme,
  onAir,
  next,
  currentTime,
  hasLiveChannel,
  onPickLive,
}: ChannelItemProps) {
  const isLive = channel.type === 'live'
  const progress = onAir ? calculateProgress(onAir.startMs, onAir.stopMs, currentTime) : 0
  const timeRemaining = onAir ? formatRemaining(onAir.stopMs, currentTime) : null
  // The empty live slot offers the picker next to the row (a sibling, since
  // buttons can't nest)
  const showPickLive = isLive && !hasLiveChannel && !!onPickLive

  return (
    <li className={showPickLive ? 'flex items-center bg-destructive/5 pr-3' : undefined}>
      {/* scroll-mt clears the sticky Channels header when the row is scrolled into view */}
      <button
        ref={ref}
        onClick={() => onSelect(channel)}
        className={`
          flex ${showPickLive ? 'min-w-0 flex-1' : 'w-full'} scroll-mt-17 items-center gap-3 p-3 text-left transition-colors
          hover:bg-accent focus-visible:-outline-offset-2
          ${isSelected ? 'bg-primary/10 border-l-4 border-primary' : ''}
          ${isLive ? 'bg-destructive/5' : ''}
        `}
        aria-pressed={isSelected}
        aria-label={isLive ? 'Live Channel' : `${channel.number} ${channel.name}`}
      >
        {/* Channel logo / icon */}
        <div
          className={`h-12 w-12 shrink-0 overflow-hidden rounded flex items-center justify-center ${
            isLive ? 'bg-destructive/20' : 'bg-muted'
          }`}
        >
          {isLive ? (
            <Radio className="h-6 w-6 text-destructive" />
          ) : channel.logoUrl ? (
            <img
              src={getErsatzTVLogoUrl(channel.id)}
              alt={`${channel.name} logo`}
              className="h-full w-full object-contain"
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : null}
        </div>

        {/* Channel info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-lg font-extrabold leading-none tabular-nums text-muted-foreground">
              {channel.number}
            </span>
            <span className="truncate font-medium">
              {isLive ? (hasLiveChannel ? channel.name : 'Live') : channel.name}
            </span>
            {isLive && hasLiveChannel && (
              <span className="rounded bg-live px-1.5 py-0.5 text-[11px] font-bold uppercase text-live-foreground">
                Live
              </span>
            )}
          </div>
          <p className="truncate text-sm text-muted-foreground">
            {isLive
              ? hasLiveChannel
                ? currentProgramme
                : onPickLive
                  ? 'Nothing on yet'
                  : 'Waiting for someone to put something on'
              : currentProgramme || 'Now playing...'}
          </p>
          {/* Progress bar and time remaining for ErsatzTV channels */}
          {!isLive && onAir && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/60 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {timeRemaining}
              </span>
            </div>
          )}
          {/* The line is always there on ErsatzTV rows, so rows don't grow when the guide arrives */}
          {!isLive && (
            <p className="mt-1 h-4 truncate text-xs leading-4 text-muted-foreground">
              {next && `Next ${nextTimeFormat.format(next.startMs)} · ${next.programme.title}`}
            </p>
          )}
        </div>

        {/* Playing indicator: static, so nothing blinks beside the video */}
        {isSelected && (
          <div className="shrink-0">
            <AudioLines
              className={`h-4 w-4 ${isLive ? 'text-live' : 'text-primary'}`}
              aria-hidden="true"
              data-testid="now-playing-indicator"
            />
          </div>
        )}
      </button>
      {showPickLive && (
        <Button size="sm" onClick={onPickLive}>
          Pick a channel
        </Button>
      )}
    </li>
  )
}

// ============================================================================
// Skeleton
// ============================================================================

// Placeholder rows shaped like ChannelItem (48px logo, name, programme line)
// while the ErsatzTV channels load
const SKELETON_ROWS = 6

function SidebarSkeleton() {
  return (
    <div role="status" className="divide-y" data-testid="sidebar-skeleton">
      <span className="sr-only">Loading channels</span>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-3" aria-hidden="true">
          <Skeleton className="h-12 w-12 shrink-0 rounded" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
