import { useEffect, useRef, useState, type Ref } from 'react'
import { ChevronLeft, ChevronRight, Radio } from 'lucide-react'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, describeLiveGuide } from '@/stores/tvStore'
import { getErsatzTVLogoUrl, fetchErsatzTVCurrentProgramme } from '@/services/ersatztvApi'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { findOnAir, getProgrammeState } from '@/lib/programmes'
import type { UnifiedChannel, ErsatzTVProgramme } from '@/types'

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

  const [channelProgrammes, setChannelProgrammes] = useState<Record<string, ErsatzTVProgramme>>({})
  const [currentTime, setCurrentTime] = useState(() => Date.now())

  // Get unified channel list
  const unifiedChannels = getUnifiedChannels()
  const hasLiveChannel = isLiveChannelActive()

  // Update current time every 30 seconds for time remaining calculations
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now()), 30 * 1000)
    return () => clearInterval(interval)
  }, [])

  // Fetch current programmes for ErsatzTV channels every 30 seconds
  useEffect(() => {
    const fetchAllCurrentProgrammes = async () => {
      const results: Record<string, ErsatzTVProgramme> = {}
      await Promise.all(
        ersatzTVChannels.map(async (channel) => {
          try {
            const data = await fetchErsatzTVCurrentProgramme(channel.id)
            if (data.current) {
              results[channel.id] = data.current
            }
          } catch {
            // Ignore individual failures
          }
        })
      )
      setChannelProgrammes(results)
    }

    if (ersatzTVChannels.length > 0) {
      fetchAllCurrentProgrammes()
      const interval = setInterval(fetchAllCurrentProgrammes, 30 * 1000)
      return () => clearInterval(interval)
    }
  }, [ersatzTVChannels])

  // Keep the selected tile in view when the rail collapses or the selection
  // changes while collapsed
  const tileRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectedChannelId = selectedChannel?.id
  useEffect(() => {
    if (!isCollapsed || !selectedChannelId) return
    tileRefs.current.get(selectedChannelId)?.scrollIntoView({ block: 'nearest' })
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
          className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              ref={(tile) => {
                if (tile) tileRefs.current.set(channel.id, tile)
                else tileRefs.current.delete(channel.id)
              }}
              channel={channel}
              isSelected={selectedChannel?.id === channel.id}
              hasLiveChannel={hasLiveChannel}
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
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Collapse channel sidebar"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      </div>

      {channelsLoading && <p role="status">Loading additional channels...</p>}
      {error && <div role="status" className="p-4">
        <p>{error}</p>
        <button onClick={() => loadChannels()}>Retry additional channels</button>
      </div>}
      <ul className="divide-y" role="list">
        {unifiedChannels.map((channel) => (
          <ChannelItem
            key={channel.id}
            channel={channel}
            isSelected={selectedChannel?.id === channel.id}
            onSelect={handleChannelClick}
            currentProgramme={
              channel.type === 'live'
                ? liveEPGTitle || describeLiveGuide(liveEPGStatus)
                : channelProgrammes[channel.id]?.title
            }
            programme={channel.type === 'live' ? undefined : channelProgrammes[channel.id]}
            currentTime={currentTime}
            hasLiveChannel={hasLiveChannel}
            onPickLive={onPickLive}
          />
        ))}
      </ul>
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
  onSelect: (channel: UnifiedChannel) => void
}

function CollapsedChannelButton({
  ref,
  channel,
  isSelected,
  hasLiveChannel,
  onSelect,
}: CollapsedChannelButtonProps) {
  const isLive = channel.type === 'live'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          onClick={() => onSelect(channel)}
          className={`
            relative flex h-10 shrink-0 scroll-my-1 items-center justify-center rounded-lg text-xs font-medium overflow-hidden
            hover:bg-foreground/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
            ${isLive ? 'w-auto min-w-10 px-1' : 'w-10'}
            ${isSelected ? 'ring-2 ring-primary bg-primary/10' : ''}
            ${isLive && hasLiveChannel ? 'bg-destructive/20 text-destructive' : 'bg-muted'}
          `}
          aria-label={isLive ? 'Live Channel' : `${channel.number} ${channel.name}`}
          aria-pressed={isSelected}
        >
          {isLive ? (
            hasLiveChannel ? (
              <Radio className="h-4 w-4 text-destructive" />
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
                className="absolute bottom-0 right-0 flex h-4 min-w-4 items-center justify-center rounded-tl-md bg-background/85 px-0.5 text-[10px] font-semibold leading-none tabular-nums text-foreground"
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
        <ChannelTooltipBody channel={channel} hasLiveChannel={hasLiveChannel} />
      </TooltipContent>
    </Tooltip>
  )
}

// Radix mounts tooltip content only while it's open, so the clock and the
// store reads below run only for the tile being hovered or focused.
function ChannelTooltipBody({
  channel,
  hasLiveChannel,
}: {
  channel: UnifiedChannel
  hasLiveChannel: boolean
}) {
  const now = useProgrammeClock()
  const programmes = useErsatztvStore((s) => s.programmesByChannel[channel.id])
  const liveEPG = useTVStore((s) => s.liveEPG)

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
        <p className="text-muted-foreground">Awaiting broadcast...</p>
      ) : (
        <>
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

interface ChannelItemProps {
  channel: UnifiedChannel
  isSelected: boolean
  onSelect: (channel: UnifiedChannel) => void
  currentProgramme?: string | null
  programme?: ErsatzTVProgramme
  currentTime: number
  hasLiveChannel: boolean
  onPickLive?: () => void
}

function formatTimeRemaining(programme: ErsatzTVProgramme, currentTime: number): string {
  const stopTime = new Date(programme.stop).getTime()
  const remainingMs = stopTime - currentTime

  if (remainingMs <= 0) return 'Ending...'

  const remainingMinutes = Math.ceil(remainingMs / (1000 * 60))

  if (remainingMinutes < 60) {
    return `${remainingMinutes}m left`
  }

  const hours = Math.floor(remainingMinutes / 60)
  const minutes = remainingMinutes % 60

  if (minutes === 0) {
    return `${hours}h left`
  }

  return `${hours}h ${minutes}m left`
}

function calculateProgress(programme: ErsatzTVProgramme, currentTime: number): number {
  const startTime = new Date(programme.start).getTime()
  const stopTime = new Date(programme.stop).getTime()
  const totalDuration = stopTime - startTime
  const elapsed = currentTime - startTime

  if (totalDuration <= 0) return 0

  return Math.min(100, Math.max(0, (elapsed / totalDuration) * 100))
}

function ChannelItem({
  channel,
  isSelected,
  onSelect,
  currentProgramme,
  programme,
  currentTime,
  hasLiveChannel,
  onPickLive,
}: ChannelItemProps) {
  const isLive = channel.type === 'live'
  const progress = programme ? calculateProgress(programme, currentTime) : 0
  const timeRemaining = programme ? formatTimeRemaining(programme, currentTime) : null
  // The empty live slot offers the picker next to the row (a sibling, since
  // buttons can't nest)
  const showPickLive = isLive && !hasLiveChannel && !!onPickLive

  return (
    <li className={showPickLive ? 'flex items-center bg-destructive/5 pr-3' : undefined}>
      <button
        onClick={() => onSelect(channel)}
        className={`
          flex ${showPickLive ? 'min-w-0 flex-1' : 'w-full'} items-center gap-3 p-3 text-left transition-colors
          hover:bg-accent focus:bg-accent focus:outline-none
          focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring
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
            <span className="text-sm font-medium text-muted-foreground">
              {channel.number}
            </span>
            <span className="truncate font-medium">
              {isLive ? (hasLiveChannel ? channel.name : 'Live') : channel.name}
            </span>
            {isLive && hasLiveChannel && (
              <span className="rounded bg-live px-1.5 py-0.5 text-[10px] font-bold uppercase text-live-foreground">
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
          {!isLive && programme && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary/60 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {timeRemaining}
              </span>
            </div>
          )}
        </div>

        {/* Playing indicator */}
        {isSelected && (
          <div className="shrink-0">
            <span
              className={`inline-flex h-3 w-3 animate-pulse rounded-full ${
                isLive ? 'bg-destructive' : 'bg-primary'
              }`}
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

