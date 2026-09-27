import { memo, useEffect, useRef, useMemo, useCallback, type ReactNode, type UIEvent } from 'react'
import { ChevronLeft, ChevronRight, Radio } from 'lucide-react'
import { useTVStore, LIVE_CHANNEL_ID, buildUnifiedChannels, describeLiveGuide } from '@/stores/tvStore'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { scrollBehavior } from '@/lib/motion'
import { buildProgrammeIndex, findCurrentAndNext, type ProgrammeIndex } from '@/lib/programmeIndex'
import { calculateProgress, formatRemaining, getProgrammeState, type ProgrammeState } from '@/lib/programmes'
import { cn } from '@/lib/utils'
import type { UnifiedChannel, ErsatzTVProgramme, EPGResponse } from '@/types'

// Grid constants
const SLOT_WIDTH = 150 // pixels per 30 minutes
const HOUR_WIDTH = SLOT_WIDTH * 2
const ROW_HEIGHT = 64 // pixels per channel row
// Wide enough for the channel name: with the guide open it's the only channel list
const CHANNEL_LABEL_WIDTH = 208
const PROGRAMME_GAP = 3 // pixels between programme boxes
// Where a block's title sticks while the block scrolls under the channel column
const PROGRAMME_TEXT_STICKY_LEFT = CHANNEL_LABEL_WIDTH + 8
// Narrower blocks show no text; a tooltip and their accessible name carry it
const PROGRAMME_TEXT_MIN_WIDTH = 48
// The grid's horizontal scroll, kept as a CSS variable on the scroller so
// sticky text can fit the part of its box right of the channel column
// without a render per scroll
const SCROLL_X_VAR = '--guide-scroll-x'

interface TVEPGGridProps {
  hours?: number
  programmesByChannel: Record<string, ErsatzTVProgramme[]>
  loading?: boolean
  liveEPG?: EPGResponse | null
  onProgrammeClick?: (programme: ErsatzTVProgramme, channel: UnifiedChannel) => void
  onChannelClick?: (channel: UnifiedChannel) => void
  // Opens the live channel picker; only for people allowed to change live TV
  onPickLive?: () => void
}

export function TVEPGGrid({
  hours = 6,
  programmesByChannel,
  loading = false,
  liveEPG,
  onProgrammeClick,
  onChannelClick,
  onPickLive,
}: TVEPGGridProps) {
  const { isLiveChannelActive, liveEPGStatus, selectedChannel } = useTVStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  // The shared programme clock: the now marker and the blocks' past/now/future
  const now = useProgrammeClock()

  // Kept stable between clock ticks so the memoised programme blocks, which
  // get their channel, can skip re-rendering
  const liveChannel = useChannelStore((s) => s.currentChannel)
  const ersatzTVChannels = useErsatztvStore((s) => s.channels)
  const unifiedChannels = useMemo(
    () => buildUnifiedChannels(liveChannel, ersatzTVChannels),
    [liveChannel, ersatzTVChannels]
  )
  const hasLiveChannel = isLiveChannelActive()

  // Calculate time range - start 30 min before current rounded time
  const startTime = useMemo(() => {
    const now = new Date()
    now.setMinutes(Math.floor(now.getMinutes() / 30) * 30, 0, 0)
    now.setMinutes(now.getMinutes() - 30)
    return now
  }, [])

  const endTime = useMemo(() => {
    const end = new Date(startTime)
    end.setHours(end.getHours() + hours)
    return end
  }, [startTime, hours])

  const gridWidth = hours * HOUR_WIDTH

  // Keeps the scroll offset the sticky titles read in step with the grid
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    syncScrollX(event.currentTarget)
  }, [])

  // Generate time slots for header
  const timeSlots = useMemo(() => {
    const slots: Date[] = []
    const current = new Date(startTime)
    while (current < endTime) {
      slots.push(new Date(current))
      current.setMinutes(current.getMinutes() + 30)
    }
    return slots
  }, [startTime, endTime])

  // Auto-scroll to current time on load
  useEffect(() => {
    if (containerRef.current && !loading && Object.keys(programmesByChannel).length > 0) {
      const nowOffset = calculateTimeOffset(new Date(), startTime)
      containerRef.current.scrollLeft = Math.max(0, nowOffset - 100)
      // Its scroll event comes later; the sticky titles need the offset now
      syncScrollX(containerRef.current)
    }
  }, [loading, startTime, programmesByChannel])

  // Centre the watched row when it's off-screen: when the guide opens (this
  // mounts then, and again once the programmes have loaded) and when the
  // channel changes while it's open. A row already in view stays put.
  const selectedRowIndex = unifiedChannels.findIndex((c) => c.id === selectedChannel?.id)
  useEffect(() => {
    const container = containerRef.current
    if (!container || loading || selectedRowIndex < 0 || container.clientHeight === 0) return
    // Rows scroll under the sticky time header, so only the height below it shows them
    const visibleHeight = container.clientHeight - (headerRef.current?.offsetHeight ?? 0)
    const rowTop = selectedRowIndex * ROW_HEIGHT
    const inView = rowTop >= container.scrollTop && rowTop + ROW_HEIGHT <= container.scrollTop + visibleHeight
    if (inView) return
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
    container.scrollTop = Math.min(maxScrollTop, Math.max(0, rowTop + ROW_HEIGHT / 2 - visibleHeight / 2))
  }, [loading, selectedRowIndex])

  // Calculate now marker position
  const nowMarkerOffset = useMemo(() => {
    return calculateTimeOffset(new Date(now), startTime)
  }, [now, startTime])

  // Navigation functions
  const scrollByHours = useCallback((hoursToScroll: number) => {
    if (containerRef.current) {
      const pixelsToScroll = hoursToScroll * HOUR_WIDTH
      containerRef.current.scrollBy({ left: pixelsToScroll, behavior: scrollBehavior() })
    }
  }, [])

  const scrollToNow = useCallback(() => {
    if (containerRef.current) {
      const nowOffset = calculateTimeOffset(new Date(), startTime)
      containerRef.current.scrollTo({ left: Math.max(0, nowOffset - 100), behavior: scrollBehavior() })
    }
  }, [startTime])

  // Convert live EPG to programme format for display (current only, no next)
  const liveProgrammes = useMemo(() => {
    if (!liveEPG?.currentProgram) return []

    return [
      {
        id: 'live-current',
        channelId: LIVE_CHANNEL_ID,
        title: liveEPG.currentProgram.title,
        description: liveEPG.currentProgram.description,
        start: liveEPG.currentProgram.startTime,
        stop: liveEPG.currentProgram.endTime,
      },
    ]
  }, [liveEPG])

  // What's on now, for the channel labels' progress and time left. The
  // ErsatzTV index is cached per programmesByChannel and shared with the
  // sidebar; the live row gets its own from the live guide.
  const programmeIndex = buildProgrammeIndex(programmesByChannel)
  const liveProgrammeIndex = useMemo(
    () => buildProgrammeIndex({ [LIVE_CHANNEL_ID]: liveProgrammes }),
    [liveProgrammes]
  )

  if (loading) {
    return <EPGGridSkeleton />
  }

  return (
    <div
      ref={containerRef}
      // The only scroller in both directions, so the sticky time header and
      // its Now/2h buttons stay in view while scrolling channels, and the
      // horizontal scrollbar sits at the bottom of the visible guide
      className="epg-scroll relative h-full overflow-auto"
      data-testid="tv-epg-grid"
      onScroll={handleScroll}
    >
      {/* Time header - sticky top, scrolls horizontally with grid. It layers
          above the sticky channel labels (z-20), which scroll up under it */}
      <div
        ref={headerRef}
        className="sticky top-0 z-30 flex bg-card border-b"
        style={{ width: CHANNEL_LABEL_WIDTH + gridWidth }}
      >
        {/* Navigation controls */}
        <div
          className="sticky left-0 z-30 flex shrink-0 items-center justify-center gap-0.5 bg-card px-1"
          style={{ width: CHANNEL_LABEL_WIDTH }}
        >
          <button
            onClick={() => scrollByHours(-2)}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
            aria-label="Scroll back 2 hours"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={scrollToNow}
            className="px-1 text-xs font-medium hover:bg-accent rounded"
            aria-label="Scroll to now"
          >
            Now
          </button>
          <button
            onClick={() => scrollByHours(2)}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent"
            aria-label="Scroll forward 2 hours"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {/* Time slots */}
        <div className="flex">
          {timeSlots.map((slot, i) => (
            <div
              key={i}
              className="shrink-0 border-l px-2 py-2 text-sm text-muted-foreground"
              style={{ width: SLOT_WIDTH }}
            >
              {formatTime(slot)}
            </div>
          ))}
        </div>
      </div>

      {/* Grid container */}
      <div
        className="relative"
        style={{
          height: unifiedChannels.length * ROW_HEIGHT,
          width: CHANNEL_LABEL_WIDTH + gridWidth,
        }}
      >
        {/* Now marker */}
        {nowMarkerOffset > 0 && nowMarkerOffset < gridWidth && (
          <div
            className="absolute top-0 bottom-0 z-10 w-0.5 bg-destructive"
            style={{ left: CHANNEL_LABEL_WIDTH + nowMarkerOffset }}
          >
            <div className="absolute -top-1 -left-1.5 h-3 w-3 rounded-full bg-destructive" />
          </div>
        )}

        {/* Channel rows */}
        {unifiedChannels.map((channel, rowIndex) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            programmes={
              channel.type === 'live'
                ? liveProgrammes
                : programmesByChannel[channel.id] || []
            }
            startTime={startTime}
            now={now}
            gridWidth={gridWidth}
            rowIndex={rowIndex}
            programmeIndex={channel.type === 'live' ? liveProgrammeIndex : programmeIndex}
            isWatching={selectedChannel?.id === channel.id}
            hasLiveChannel={hasLiveChannel}
            liveGuideText={describeLiveGuide(liveEPGStatus)}
            onProgrammeClick={onProgrammeClick}
            onChannelClick={onChannelClick}
            onPickLive={onPickLive}
          />
        ))}
      </div>
    </div>
  )
}

interface ChannelRowProps {
  channel: UnifiedChannel
  programmes: ErsatzTVProgramme[]
  startTime: Date
  // The shared programme clock, epoch ms
  now: number
  gridWidth: number
  rowIndex: number
  programmeIndex: ProgrammeIndex
  // The channel playing in the player
  isWatching: boolean
  hasLiveChannel: boolean
  // Shown in the live row when there's no programme to draw
  liveGuideText: string
  onProgrammeClick?: (programme: ErsatzTVProgramme, channel: UnifiedChannel) => void
  onChannelClick?: (channel: UnifiedChannel) => void
  onPickLive?: () => void
}

function ChannelRow({
  channel,
  programmes,
  startTime,
  now,
  gridWidth,
  rowIndex,
  programmeIndex,
  isWatching,
  hasLiveChannel,
  liveGuideText,
  onProgrammeClick,
  onChannelClick,
  onPickLive,
}: ChannelRowProps) {
  const isLive = channel.type === 'live'

  // Only show red background when live channel has active broadcast
  const showLiveHighlight = isLive && hasLiveChannel

  return (
    <div
      className={`absolute left-0 flex ${showLiveHighlight ? 'bg-live/5' : ''}`}
      style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
      data-testid="channel-row"
    >
      <ChannelLabel
        channel={channel}
        programmeIndex={programmeIndex}
        isWatching={isWatching}
        showLiveHighlight={showLiveHighlight}
        onChannelClick={onChannelClick}
      />

      {/* Programme boxes */}
      <div className="relative" style={{ width: gridWidth }}>
        {isLive && !hasLiveChannel ? (
          onPickLive ? (
            <LiveRowSlot>
              <Button size="sm" onClick={onPickLive}>
                Pick a channel for everyone
              </Button>
            </LiveRowSlot>
          ) : (
            <LiveRowPlaceholder>Waiting for someone to put something on</LiveRowPlaceholder>
          )
        ) : isLive && programmes.length === 0 ? (
          <LiveRowPlaceholder>{liveGuideText}</LiveRowPlaceholder>
        ) : (
          programmes.map((programme) => {
            // Each block gets its state as primitives, so a clock tick
            // re-renders only the blocks whose state or progress changed
            const state = getProgrammeState(programme, now)
            const isNow = state === 'now'
            const startMs = new Date(programme.start).getTime()
            const stopMs = new Date(programme.stop).getTime()
            return (
              <ProgrammeBox
                key={programme.id}
                programme={programme}
                channel={channel}
                startTime={startTime}
                isLive={isLive}
                state={state}
                // Elapsed across the part of the block that's drawn, so the
                // line ends at the now marker even when the block starts
                // before the grid does
                progressPct={isNow ? calculateProgress(Math.max(startMs, startTime.getTime()), stopMs, now) : undefined}
                timeLeft={isNow ? formatRemaining(stopMs, now) : undefined}
                isWatching={isNow && isWatching}
                onClick={onProgrammeClick}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

interface ChannelLabelProps {
  channel: UnifiedChannel
  programmeIndex: ProgrammeIndex
  isWatching: boolean
  showLiveHighlight: boolean
  onChannelClick?: (channel: UnifiedChannel) => void
}

// The sticky channel column: number, logo, name, LIVE on an active live row,
// and the on-air programme's progress and time left, which the sidebar shows
// when the guide is closed. It reads the shared programme clock itself.
function ChannelLabel({ channel, programmeIndex, isWatching, showLiveHighlight, onChannelClick }: ChannelLabelProps) {
  const isLive = channel.type === 'live'
  const now = useProgrammeClock()
  const { current: onAir } = findCurrentAndNext(programmeIndex, channel.id, now)

  return (
    <button
      onClick={() => onChannelClick?.(channel)}
      className={cn(
        'sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r pl-3 pr-2 text-left text-sm transition-colors hover:bg-accent focus-visible:-outline-offset-2',
        showLiveHighlight ? 'bg-live-surface' : 'bg-card'
      )}
      style={{ width: CHANNEL_LABEL_WIDTH }}
      // The name is visible now, so no tooltip; the label keeps the action
      aria-label={`Switch to ${channel.number} ${channel.name}`}
      aria-current={isWatching ? 'true' : undefined}
    >
      {/* Watching marker */}
      {isWatching && (
        <span aria-hidden="true" data-testid="watching-bar" className="absolute inset-y-0 left-0 w-1 bg-primary" />
      )}
      <span
        className={cn(
          'w-5 shrink-0 text-right font-display text-lg font-extrabold leading-none tabular-nums',
          isWatching ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        {channel.number}
      </span>
      {isLive ? (
        <div className="h-8 w-8 flex-shrink-0 rounded bg-destructive/20 flex items-center justify-center">
          <Radio className="h-4 w-4 text-destructive" />
        </div>
      ) : channel.logoUrl ? (
        <img
          src={getErsatzTVLogoUrl(channel.id)}
          alt=""
          className="h-8 w-8 flex-shrink-0 rounded object-contain"
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
      ) : (
        <div className="h-8 w-8 flex-shrink-0 rounded bg-muted" />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{channel.name}</span>
          {showLiveHighlight && (
            <span className="shrink-0 rounded bg-live px-1 py-0.5 text-[11px] font-bold uppercase leading-none text-live-foreground">
              Live
            </span>
          )}
        </span>
        {onAir && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                data-testid="label-progress"
                className={cn('block h-full rounded-full', isLive ? 'bg-live' : 'bg-primary/60')}
                style={{ width: `${calculateProgress(onAir.startMs, onAir.stopMs, now)}%` }}
              />
            </span>
            <span className="shrink-0 text-xs leading-none tabular-nums text-muted-foreground">
              {formatRemaining(onAir.stopMs, now)}
            </span>
          </span>
        )}
      </span>
    </button>
  )
}

// Where the live row puts its message or action when there's no programme
// to draw - position at ~1 hour mark
function LiveRowSlot({ children }: { children: ReactNode }) {
  return (
    <div
      className="absolute top-1 bottom-1 flex items-center z-0"
      style={{ left: SLOT_WIDTH * 2 }}
    >
      {children}
    </div>
  )
}

function LiveRowPlaceholder({ children }: { children: ReactNode }) {
  return (
    <LiveRowSlot>
      <div className="rounded border border-dashed border-muted-foreground/30 bg-card px-4 py-2 text-sm text-muted-foreground whitespace-nowrap">
        {children}
      </div>
    </LiveRowSlot>
  )
}

interface ProgrammeBoxProps {
  programme: ErsatzTVProgramme
  channel: UnifiedChannel
  startTime: Date
  isLive: boolean
  state: ProgrammeState
  // Only for the block on now: elapsed share of the drawn block (0-100) and '32m left'
  progressPct?: number
  timeLeft?: string
  // On now on the channel being watched
  isWatching: boolean
  onClick?: (programme: ErsatzTVProgramme, channel: UnifiedChannel) => void
}

// Memoised on primitive state props, so a clock tick skips blocks that stay
// past or future
const ProgrammeBox = memo(function ProgrammeBox({
  programme,
  channel,
  startTime,
  isLive,
  state,
  progressPct,
  timeLeft,
  isWatching,
  onClick,
}: ProgrammeBoxProps) {
  const progStart = new Date(programme.start)
  const progEnd = new Date(programme.stop)

  const left = calculateTimeOffset(progStart, startTime)
  const width = calculateDurationWidth(progStart, progEnd)

  // Skip if programme ends before grid starts
  if (left + width < 0) return null

  // A programme that started before the grid is drawn from the grid's start
  const visualLeft = Math.max(0, left)
  // True to its duration: short fillers no longer grow over their neighbours
  const visualWidth = Math.max(0, width - (visualLeft - left) - PROGRAMME_GAP)
  const showsText = visualWidth >= PROGRAMME_TEXT_MIN_WIDTH
  const meta = state === 'now' ? timeLeft : `${formatTime(progStart)} - ${formatTime(progEnd)}`

  const block = (
    <button
      // overflow-clip, not overflow-hidden: hidden would make the block the
      // title's scroll container, and the title couldn't stick to the grid
      className={cn(
        'absolute top-1 bottom-1 z-0 overflow-clip rounded border text-left',
        'px-2 py-1 text-sm flex flex-col justify-center',
        'hover:opacity-80 focus-visible:-outline-offset-2',
        'transition-colors',
        // Past: recedes. Now: the one tinted block, with a bar at its start.
        // Future: quiet. The live row keeps its live tint while it's on.
        state === 'past' && 'bg-transparent border-border text-muted-foreground',
        state === 'now' && 'text-foreground',
        state === 'now' && (isLive
          ? 'bg-live/15 border-live/40 shadow-[inset_3px_0_0_var(--live)]'
          : 'bg-guide-now border-border shadow-[inset_3px_0_0_var(--primary)]'),
        state === 'future' && (isLive ? 'bg-live/15 border-live/40 text-foreground' : 'bg-guide-future border-border text-foreground'),
        isWatching && 'border-primary'
      )}
      style={{
        left: visualLeft,
        width: visualWidth,
      }}
      data-state={state}
      data-watching={isWatching || undefined}
      aria-label={showsText ? undefined : `${programme.title}, ${meta}`}
      onClick={() => onClick?.(programme, channel)}
    >
      {showsText && (
        // Sticks just right of the channel column, so the start of the title
        // stays readable while the block scrolls under it. It's only as wide
        // as its text, and no wider than the part of the block still in
        // view, so it has room to move and truncates at the column edge.
        <div
          data-testid="programme-text"
          className="sticky w-fit"
          style={{ left: PROGRAMME_TEXT_STICKY_LEFT, maxWidth: visiblePartWidth(visualLeft) }}
        >
          <p
            className={cn(
              'truncate',
              state === 'past' && 'font-normal',
              state === 'now' && 'font-semibold',
              state === 'future' && 'font-medium'
            )}
          >
            {programme.title}
          </p>
          <p
            className={cn(
              'truncate text-xs tabular-nums',
              // Muted text on guide-now is only 3.39-5.20:1, so the meta stays on the foreground
              state === 'now' ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {meta}
          </p>
        </div>
      )}
      {state === 'now' && progressPct !== undefined && (
        <span
          aria-hidden="true"
          data-testid="programme-elapsed"
          className={cn('absolute bottom-0 left-0 h-0.5', isLive ? 'bg-live' : 'bg-primary')}
          style={{ width: `${progressPct}%` }}
        />
      )}
    </button>
  )

  if (showsText) return block

  // Too narrow for its text: the tooltip shows it on hover and keyboard focus
  return (
    <Tooltip>
      <TooltipTrigger asChild>{block}</TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">{programme.title}</p>
        <p className="text-xs tabular-nums">{meta}</p>
      </TooltipContent>
    </Tooltip>
  )
})

// Helper functions
function calculateTimeOffset(time: Date, startTime: Date): number {
  const diffMinutes = (time.getTime() - startTime.getTime()) / (1000 * 60)
  return (diffMinutes / 30) * SLOT_WIDTH
}

function calculateDurationWidth(start: Date, end: Date): number {
  const diffMinutes = (end.getTime() - start.getTime()) / (1000 * 60)
  return (diffMinutes / 30) * SLOT_WIDTH
}

// Writes the grid's horizontal scroll to SCROLL_X_VAR. Skipped when it hasn't
// changed, as on a vertical scroll, since a change restyles every block.
function syncScrollX(scroller: HTMLElement) {
  const value = `${scroller.scrollLeft}px`
  if (scroller.style.getPropertyValue(SCROLL_X_VAR) !== value) {
    scroller.style.setProperty(SCROLL_X_VAR, value)
  }
}

// Max width for sticky text in a box that starts `left` px into the
// programmes: the box less the part scrolled under the channel column. A
// sticky element can't leave its box, so text wider than the part in view
// would stop short of the column edge and stay cut on the left.
function visiblePartWidth(left: number): string {
  return `calc(100% - max(0px, var(${SCROLL_X_VAR}, 0px) - ${left}px))`
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function EPGGridSkeleton() {
  return (
    <div className="animate-pulse rounded-t-lg overflow-hidden">
      <div className="h-12 bg-muted border-b" />
      <div className="space-y-1 p-2">
        {/* Live channel row skeleton */}
        <div className="h-16 rounded bg-destructive/10" />
        {/* Regular channel row skeletons */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded bg-muted" />
        ))}
      </div>
    </div>
  )
}
