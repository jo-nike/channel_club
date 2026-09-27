import { memo, useEffect, useRef, useMemo, useCallback, useState, type ReactNode, type UIEvent } from 'react'
import { ChevronLeft, ChevronRight, Radio } from 'lucide-react'
import { useTVStore, LIVE_CHANNEL_ID, buildUnifiedChannels, describeLiveGuide, toLiveProgramme } from '@/stores/tvStore'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { getErsatzTVLogoUrl } from '@/services/ersatztvApi'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { useScrollViewport } from '@/hooks/useScrollViewport'
import {
  useGridNavigation,
  UNBOUNDED_TIME_WINDOW,
  type GridCell,
  type GridMoveAxis,
  type GridRow,
  type TimeWindow,
} from '@/hooks/useGridNavigation'
import { useUIStore } from '@/stores/uiStore'
import { scrollBehavior } from '@/lib/motion'
import {
  buildProgrammeIndex,
  findCurrentAndNext,
  findInRange,
  type IndexedProgramme,
  type ProgrammeIndex,
} from '@/lib/programmeIndex'
import { calculateProgress, formatRemaining, formatRemainingSpoken, type ProgrammeState } from '@/lib/programmes'
import { cn } from '@/lib/utils'
import type { UnifiedChannel, ErsatzTVProgramme, EPGResponse } from '@/types'

// Grid constants
const SLOT_WIDTH = 150 // pixels per 30 minutes
const HOUR_WIDTH = SLOT_WIDTH * 2
const ROW_HEIGHT = 64 // pixels per channel row
// Wide enough for the channel name: with the guide open it's the only channel list
const CHANNEL_LABEL_WIDTH = 208
const PROGRAMME_GAP = 3 // pixels between programme boxes
// Where block titles and header time labels stick while they scroll under the channel column
const STICKY_TEXT_LEFT = CHANNEL_LABEL_WIDTH + 8
// Narrower blocks show no text; a tooltip and their accessible name carry it
const PROGRAMME_TEXT_MIN_WIDTH = 48
// The grid's horizontal scroll, kept as a CSS variable on the scroller so
// sticky text can fit the part of its box right of the channel column
// without a render per scroll
const SCROLL_X_VAR = '--guide-scroll-x'
// Windowing: only rows within this many of the viewport are rendered, and in
// them only programmes on air from an hour before the viewport's left edge
// to two hours after its right edge
const ROW_OVERSCAN = 4
const SLOT_MS = 30 * 60 * 1000
const OVERSCAN_BEFORE_MS = 60 * 60 * 1000
const OVERSCAN_AFTER_MS = 2 * 60 * 60 * 1000
// The grid cell id of the live row's "Pick a channel for everyone" action
const PICK_LIVE_CELL = 'pick-live'
// The live row's message or action sits this many half hours in (~1 hour mark)
const LIVE_ROW_SLOT_LEFT_SLOTS = 2

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
  // Field selectors: the grid re-renders for what it draws, not every tvStore update
  const selectedChannelId = useTVStore((s) => s.selectedChannel?.id)
  const liveEPGStatus = useTVStore((s) => s.liveEPGStatus)
  const liveSchedule = useTVStore((s) => s.liveProgrammes)
  const containerRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  // What's in view of the scroller, for rendering only the rows and
  // programmes near it
  const viewport = useScrollViewport(containerRef, !loading)
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
  const hasLiveChannel = liveChannel !== null

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

  // The day at the left edge of the programmes, for the header's day label.
  // Held as that day's midnight, so scrolling only re-renders across a day.
  const [leftEdgeDay, setLeftEdgeDay] = useState(() => startOfDay(startTime.getTime()))
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      syncScrollX(event.currentTarget)
      const leftEdgeMs = startTime.getTime() + (event.currentTarget.scrollLeft / SLOT_WIDTH) * 30 * 60 * 1000
      setLeftEdgeDay(startOfDay(leftEdgeMs))
    },
    [startTime]
  )

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
  const selectedRowIndex = unifiedChannels.findIndex((c) => c.id === selectedChannelId)
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

  // Row 0: the live channel's schedule. Until it loads, or when its lookup
  // fails, the now-playing answer's current and next programmes stand in.
  const liveProgrammes = useMemo(() => {
    if (liveSchedule.length > 0) return liveSchedule
    return [liveEPG?.currentProgram, liveEPG?.nextProgram]
      .filter((programme) => programme != null)
      .map(toLiveProgramme)
  }, [liveSchedule, liveEPG])

  // What's on now, for the channel labels' progress and time left. The
  // ErsatzTV index is cached per programmesByChannel and shared with the
  // sidebar; the live row gets its own from the live guide.
  const programmeIndex = buildProgrammeIndex(programmesByChannel)
  const liveProgrammeIndex = useMemo(
    () => buildProgrammeIndex({ [LIVE_CHANNEL_ID]: liveProgrammes }),
    [liveProgrammes]
  )

  const gridStartMs = startTime.getTime()
  const gridEndMs = endTime.getTime()

  // The keyboard grid: each row's label, then the blocks drawn in the grid,
  // in time order. The live row's only block, while nothing is on, is its
  // Pick a channel action, timed as the half hour where LiveRowSlot draws it.
  const canPickLive = onPickLive !== undefined
  const navRows = useMemo(
    (): GridRow[] =>
      unifiedChannels.map((channel) => {
        if (channel.type === 'live' && !hasLiveChannel) {
          const pickStartMs = gridStartMs + LIVE_ROW_SLOT_LEFT_SLOTS * SLOT_MS
          return {
            id: channel.id,
            blocks: canPickLive ? [{ id: PICK_LIVE_CELL, startMs: pickStartMs, stopMs: pickStartMs + SLOT_MS }] : [],
          }
        }
        const index = channel.type === 'live' ? liveProgrammeIndex : programmeIndex
        const blocks = (index.get(channel.id) ?? NO_ENTRIES)
          .filter((entry) => entry.stopMs > gridStartMs && entry.startMs < gridEndMs)
          .map((entry) => ({ id: entry.programme.id, startMs: entry.startMs, stopMs: entry.stopMs }))
        return { id: channel.id, blocks }
      }),
    [unifiedChannels, hasLiveChannel, canPickLive, liveProgrammeIndex, programmeIndex, gridStartMs, gridEndMs]
  )

  // Until a cell is focused, the tab stop is the watched row's programme on
  // now (or its label when nothing is), so Tab and a keyboard-opened guide
  // land on what's playing
  const initialRow = unifiedChannels[Math.max(0, selectedRowIndex)]
  const initialRowId = initialRow?.id
  const initialBlockId = initialRow
    ? (findCurrentAndNext(
        initialRow.type === 'live' ? liveProgrammeIndex : programmeIndex,
        initialRow.id,
        now
      ).current?.programme.id ?? null)
    : null
  const initialCell = useMemo(
    (): GridCell | null => (initialRowId === undefined ? null : { rowId: initialRowId, blockId: initialBlockId }),
    [initialRowId, initialBlockId]
  )

  // The time in view right of the channel column
  const getTimeWindow = useCallback((): TimeWindow => {
    const container = containerRef.current
    if (!container || container.clientWidth === 0) return UNBOUNDED_TIME_WINDOW
    const fromMs = gridStartMs + pixelsToMs(container.scrollLeft)
    return { fromMs, toMs: fromMs + pixelsToMs(Math.max(0, container.clientWidth - CHANNEL_LABEL_WIDTH)) }
  }, [gridStartMs])

  // After a key move: scroll the cell into view below the time header and,
  // for a block, right of the channel column, then focus it. Moves along a
  // row show the block's start; moves between rows scroll sideways only when
  // the block is out of view, so the time the arrows keep to stays put.
  const handleMove = useCallback(
    (cell: GridCell, axis: GridMoveAxis) => {
      const container = containerRef.current
      const element = container && findCellElement(container, cell)
      if (!container || !element) return
      if (container.clientHeight > 0) {
        const rowTop = unifiedChannels.findIndex((c) => c.id === cell.rowId) * ROW_HEIGHT
        const visibleHeight = container.clientHeight - (headerRef.current?.offsetHeight ?? 0)
        if (rowTop < container.scrollTop) container.scrollTop = rowTop
        else if (rowTop + ROW_HEIGHT > container.scrollTop + visibleHeight) {
          container.scrollTop = rowTop + ROW_HEIGHT - visibleHeight
        }
      }
      const block = navRows.find((row) => row.id === cell.rowId)?.blocks.find((b) => b.id === cell.blockId)
      if (block && container.clientWidth > 0) {
        const left = Math.max(0, msToPixels(block.startMs - gridStartMs))
        const right = msToPixels(block.stopMs - gridStartMs)
        const viewLeft = container.scrollLeft
        const viewRight = viewLeft + container.clientWidth - CHANNEL_LABEL_WIDTH
        const startHidden = left < viewLeft || left > viewRight - PROGRAMME_TEXT_MIN_WIDTH
        const outOfView = right <= viewLeft || left >= viewRight
        if (axis === 'column' ? startHidden : outOfView) {
          container.scrollLeft = left
          syncScrollX(container)
        }
      }
      // The scroll above already placed it; the browser's own would put it
      // under the sticky header or channel column
      element.focus({ preventScroll: true })
    },
    [unifiedChannels, navRows, gridStartMs]
  )

  // Enter and Space: the cell's own click
  const handleActivate = useCallback((cell: GridCell) => {
    const container = containerRef.current
    if (container) findCellElement(container, cell)?.click()
  }, [])

  const { tabStop, handleKeyDown, handleCellFocus } = useGridNavigation({
    rows: navRows,
    initialCell,
    now,
    getTimeWindow,
    onMove: handleMove,
    onActivate: handleActivate,
  })

  // Opened from the keyboard: focus goes to the watched row's programme on
  // now, so a remote's D-pad moves through the guide rather than changing
  // the volume
  const guideFocusRequested = useUIStore((s) => s.guideFocusRequested)
  const setGuideFocusRequested = useUIStore((s) => s.setGuideFocusRequested)
  useEffect(() => {
    const container = containerRef.current
    if (loading || !guideFocusRequested || !container || !tabStop) return
    setGuideFocusRequested(false)
    findCellElement(container, tabStop)?.focus({ preventScroll: true })
  }, [loading, guideFocusRequested, tabStop, setGuideFocusRequested])

  // Rows in the viewport plus overscan. A scroller with no height (not laid
  // out) renders every row.
  const rowsWindowed = viewport.height > 0
  const firstRow = Math.floor(viewport.scrollTop / ROW_HEIGHT) - ROW_OVERSCAN
  const lastRow = Math.floor((viewport.scrollTop + viewport.height) / ROW_HEIGHT) + ROW_OVERSCAN
  // The programmes' time range, from the viewport's edges widened to whole
  // half hours, so a row re-renders when the range crosses a slot rather
  // than on every scrolled pixel. No width (not laid out): every programme.
  const timeWindowed = viewport.width > 0
  const fromMs = timeWindowed
    ? gridStartMs + Math.floor(viewport.scrollLeft / SLOT_WIDTH) * SLOT_MS - OVERSCAN_BEFORE_MS
    : -Infinity
  const toMs = timeWindowed
    ? gridStartMs + Math.ceil((viewport.scrollLeft + viewport.width) / SLOT_WIDTH) * SLOT_MS + OVERSCAN_AFTER_MS
    : Infinity

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
          {/* Which day the programmes in view are on */}
          <span data-testid="guide-day" className="mr-auto pl-2 text-xs font-semibold text-foreground">
            {formatDay(leftEdgeDay, now)}
          </span>
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
        {/* Time slots. Each label sticks just right of the channel column
            while its slot scrolls under it, so the first one stays readable;
            overflow-clip rather than hidden keeps the slot from becoming the
            label's scroll container. Once the part of the slot in view is
            narrower than its label, the label hides rather than showing a
            fragment such as '0 PM'. */}
        <div className="relative flex">
          <TimeSlotLabels slots={timeSlots} />
          {/* Live time pill on the now marker */}
          {nowMarkerOffset > 0 && nowMarkerOffset < gridWidth && (
            <span
              data-testid="now-pill"
              className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded bg-destructive px-1.5 py-0.5 text-xs font-bold leading-none tabular-nums text-destructive-foreground"
              style={{ left: nowMarkerOffset }}
            >
              {formatTime(new Date(now))}
            </span>
          )}
        </div>
      </div>

      {/* Grid container: the keyboard grid. The rows alone, not the time
          header, whose buttons a grid can't hold. Rows off screen aren't
          rendered, so each row carries its index out of the total. */}
      <div
        role="grid"
        aria-label="Guide"
        aria-rowcount={unifiedChannels.length}
        className="relative"
        style={{
          height: unifiedChannels.length * ROW_HEIGHT,
          width: CHANNEL_LABEL_WIDTH + gridWidth,
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Now marker */}
        {nowMarkerOffset > 0 && nowMarkerOffset < gridWidth && (
          <div
            aria-hidden="true"
            className="absolute top-0 bottom-0 z-10 w-0.5 bg-destructive"
            style={{ left: CHANNEL_LABEL_WIDTH + nowMarkerOffset }}
          >
            <div className="absolute -top-1 -left-1.5 h-3 w-3 rounded-full bg-destructive" />
          </div>
        )}

        {/* Channel rows near the viewport, plus the watched row and the tab
            stop's (the focused cell's), which are always rendered */}
        {unifiedChannels.map((channel, rowIndex) => {
          const isTabStopRow = tabStop?.rowId === channel.id
          const inView = !rowsWindowed || (rowIndex >= firstRow && rowIndex <= lastRow)
          if (!inView && rowIndex !== selectedRowIndex && !isTabStopRow) return null
          return (
            <ChannelRow
              key={channel.id}
              channel={channel}
              gridStartMs={gridStartMs}
              now={now}
              gridWidth={gridWidth}
              rowIndex={rowIndex}
              programmeIndex={channel.type === 'live' ? liveProgrammeIndex : programmeIndex}
              fromMs={fromMs}
              toMs={toMs}
              tabStopBlockId={isTabStopRow ? tabStop.blockId : undefined}
              isWatching={selectedChannelId === channel.id}
              hasLiveChannel={hasLiveChannel}
              liveGuideText={describeLiveGuide(liveEPGStatus)}
              onProgrammeClick={onProgrammeClick}
              onChannelClick={onChannelClick}
              onPickLive={onPickLive}
              onCellFocus={handleCellFocus}
            />
          )
        })}
      </div>
    </div>
  )
}

interface ChannelRowProps {
  channel: UnifiedChannel
  // Where the programmes start, epoch ms
  gridStartMs: number
  // The shared programme clock, epoch ms
  now: number
  gridWidth: number
  rowIndex: number
  programmeIndex: ProgrammeIndex
  // Only programmes on air in [fromMs, toMs) are rendered, epoch ms
  fromMs: number
  toMs: number
  // The row's cell with the grid's one tab stop: null for the label, a block
  // id, or undefined when it's in another row. Its block is rendered wherever
  // it is, as it holds (or last held) focus.
  tabStopBlockId: string | null | undefined
  // The channel playing in the player
  isWatching: boolean
  hasLiveChannel: boolean
  // Shown in the live row when there's no programme to draw
  liveGuideText: string
  onProgrammeClick?: (programme: ErsatzTVProgramme, channel: UnifiedChannel) => void
  onChannelClick?: (channel: UnifiedChannel) => void
  onPickLive?: () => void
  onCellFocus?: (channelId: string, programmeId: string | null) => void
}

// Memoised: its props are primitives or objects that keep their identity
// between refreshes, so scrolling re-renders a row only when its time range
// moves by a slot, and a clock tick only the rows that are rendered
const ChannelRow = memo(function ChannelRow({
  channel,
  gridStartMs,
  now,
  gridWidth,
  rowIndex,
  programmeIndex,
  fromMs,
  toMs,
  tabStopBlockId,
  isWatching,
  hasLiveChannel,
  liveGuideText,
  onProgrammeClick,
  onChannelClick,
  onPickLive,
  onCellFocus,
}: ChannelRowProps) {
  const isLive = channel.type === 'live'
  // Sorted, with start and stop parsed once per programme refresh
  const entries = programmeIndex.get(channel.id) ?? NO_ENTRIES
  const drawn = programmesToDraw(programmeIndex, channel.id, fromMs, toMs, tabStopBlockId ?? null)

  // Only show red background when live channel has active broadcast
  const showLiveHighlight = isLive && hasLiveChannel

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 1}
      className={`absolute left-0 flex ${showLiveHighlight ? 'bg-live/5' : ''}`}
      style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
      data-testid="channel-row"
    >
      <ChannelLabel
        channel={channel}
        programmeIndex={programmeIndex}
        isWatching={isWatching}
        showLiveHighlight={showLiveHighlight}
        isTabStop={tabStopBlockId === null}
        onChannelClick={onChannelClick}
        onFocus={onCellFocus}
      />

      {/* Programme boxes */}
      <div role="presentation" className="relative" style={{ width: gridWidth }}>
        {isLive && !hasLiveChannel ? (
          onPickLive ? (
            <LiveRowSlot>
              <Button
                size="sm"
                onClick={onPickLive}
                tabIndex={tabStopBlockId === PICK_LIVE_CELL ? 0 : -1}
                data-grid-row={channel.id}
                data-grid-block={PICK_LIVE_CELL}
                onFocus={() => onCellFocus?.(channel.id, PICK_LIVE_CELL)}
              >
                Pick a channel for everyone
              </Button>
            </LiveRowSlot>
          ) : (
            <LiveRowPlaceholder>Waiting for someone to put something on</LiveRowPlaceholder>
          )
        ) : isLive && entries.length === 0 ? (
          <LiveRowPlaceholder>{liveGuideText}</LiveRowPlaceholder>
        ) : (
          drawn.map(({ programme, startMs, stopMs }) => {
            const left = msToPixels(startMs - gridStartMs)
            const width = msToPixels(stopMs - startMs)
            // Ends before the grid starts
            if (left + width < 0) return null
            // A programme that started before the grid is drawn from the grid's start
            const visualLeft = Math.max(0, left)
            // Each block gets its state and geometry as primitives, so a clock
            // tick re-renders only the blocks whose state or progress changed
            const state = stateAt(startMs, stopMs, now)
            const isNow = state === 'now'
            return (
              <ProgrammeBox
                key={programme.id}
                programme={programme}
                channel={channel}
                isLive={isLive}
                state={state}
                left={visualLeft}
                // True to its duration: short fillers no longer grow over their neighbours
                width={Math.max(0, width - (visualLeft - left) - PROGRAMME_GAP)}
                startMs={startMs}
                stopMs={stopMs}
                // Elapsed across the part of the block that's drawn, so the
                // line ends at the now marker even when the block starts
                // before the grid does
                progressPct={isNow ? calculateProgress(Math.max(startMs, gridStartMs), stopMs, now) : undefined}
                timeLeft={isNow ? formatRemaining(stopMs, now) : undefined}
                spokenTimeLeft={isNow ? formatRemainingSpoken(stopMs, now) : undefined}
                isWatching={isNow && isWatching}
                isTabStop={tabStopBlockId === programme.id}
                onClick={onProgrammeClick}
                onFocus={onCellFocus}
              />
            )
          })
        )}
      </div>
    </div>
  )
})

// A row's programmes in [fromMs, toMs), in time order, plus the pinned one
// wherever it is
function programmesToDraw(
  index: ProgrammeIndex,
  channelId: string,
  fromMs: number,
  toMs: number,
  pinnedProgrammeId: string | null
): readonly IndexedProgramme[] {
  const inRange = findInRange(index, channelId, fromMs, toMs)
  if (pinnedProgrammeId === null || inRange.some((entry) => entry.programme.id === pinnedProgrammeId)) return inRange
  const pinned = index.get(channelId)?.find((entry) => entry.programme.id === pinnedProgrammeId)
  if (!pinned) return inRange
  return [...inRange, pinned].sort((a, b) => a.startMs - b.startMs)
}

interface ChannelLabelProps {
  channel: UnifiedChannel
  programmeIndex: ProgrammeIndex
  isWatching: boolean
  showLiveHighlight: boolean
  // Holds the grid's one tab stop
  isTabStop: boolean
  onChannelClick?: (channel: UnifiedChannel) => void
  onFocus?: (channelId: string, programmeId: null) => void
}

// The sticky channel column: number, logo, name, LIVE on an active live row,
// and the on-air programme's progress and time left, which the sidebar shows
// when the guide is closed. It reads the shared programme clock itself.
function ChannelLabel({
  channel,
  programmeIndex,
  isWatching,
  showLiveHighlight,
  isTabStop,
  onChannelClick,
  onFocus,
}: ChannelLabelProps) {
  const isLive = channel.type === 'live'
  const now = useProgrammeClock()
  const { current: onAir } = findCurrentAndNext(programmeIndex, channel.id, now)

  return (
    // The row header sticks, holding the button: a button given the
    // rowheader role would stop being a button
    <div role="rowheader" className="sticky left-0 z-20 flex shrink-0">
      <button
        onClick={() => onChannelClick?.(channel)}
        onFocus={() => onFocus?.(channel.id, null)}
        tabIndex={isTabStop ? 0 : -1}
        data-grid-row={channel.id}
        className={cn(
          'relative flex shrink-0 items-center gap-2 border-r pl-3 pr-2 text-left text-sm transition-colors hover:bg-accent focus-visible:-outline-offset-2',
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
    </div>
  )
}

// Where the live row puts its message or action when there's no programme
// to draw - position at ~1 hour mark
function LiveRowSlot({ children }: { children: ReactNode }) {
  return (
    <div
      role="gridcell"
      className="absolute top-1 bottom-1 flex items-center z-0"
      style={{ left: SLOT_WIDTH * LIVE_ROW_SLOT_LEFT_SLOTS }}
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
  isLive: boolean
  state: ProgrammeState
  // Drawn position and width in the programmes area, px
  left: number
  width: number
  // The programme's times, epoch ms
  startMs: number
  stopMs: number
  // Only for the block on now: elapsed share of the drawn block (0-100),
  // '32m left', and '32 minutes left' for its accessible name
  progressPct?: number
  timeLeft?: string
  spokenTimeLeft?: string
  // On now on the channel being watched
  isWatching: boolean
  // Holds the grid's one tab stop
  isTabStop: boolean
  onClick?: (programme: ErsatzTVProgramme, channel: UnifiedChannel) => void
  onFocus?: (channelId: string, programmeId: string) => void
}

// Memoised on primitive state and geometry props (the programme and channel
// objects keep their identity between refreshes), so a clock tick skips
// blocks that stay past or future, and their times aren't re-formatted
const ProgrammeBox = memo(function ProgrammeBox({
  programme,
  channel,
  isLive,
  state,
  left,
  width,
  startMs,
  stopMs,
  progressPct,
  timeLeft,
  spokenTimeLeft,
  isWatching,
  isTabStop,
  onClick,
  onFocus,
}: ProgrammeBoxProps) {
  const showsText = width >= PROGRAMME_TEXT_MIN_WIDTH
  const startText = state === 'now' ? '' : formatTime(startMs)
  const stopText = state === 'now' ? '' : formatTime(stopMs)
  const meta = state === 'now' ? timeLeft : `${startText} - ${stopText}`
  // Read out of the grid, a block needs its channel, and when it's on in words
  const when =
    state === 'now' ? `on now, ${spokenTimeLeft}` : state === 'future' ? `starts ${startText}` : `ended ${stopText}`
  const name = `${programme.title}, ${channel.number} ${channel.name}, ${when}`

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
      style={{ left, width }}
      data-state={state}
      data-watching={isWatching || undefined}
      data-grid-row={channel.id}
      data-grid-block={programme.id}
      tabIndex={isTabStop ? 0 : -1}
      aria-label={name}
      onClick={() => onClick?.(programme, channel)}
      onFocus={() => onFocus?.(channel.id, programme.id)}
    >
      {showsText && (
        // Sticks just right of the channel column, so the start of the title
        // stays readable while the block scrolls under it. It's only as wide
        // as its text, and no wider than the part of the block still in
        // view, so it has room to move and truncates at the column edge.
        <div
          data-testid="programme-text"
          className="sticky w-fit"
          style={{ left: STICKY_TEXT_LEFT, maxWidth: visiblePartWidth(left) }}
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

  // The cell holds the button (a button given the gridcell role would stop
  // being a button). It's left unpositioned, so the block still places
  // itself in the row.
  if (showsText) return <div role="gridcell">{block}</div>

  // Too narrow for its text: the tooltip shows it on hover and keyboard focus
  return (
    <div role="gridcell">
      <Tooltip>
        <TooltipTrigger asChild>{block}</TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">{programme.title}</p>
          <p className="text-xs tabular-nums">{meta}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
})

// Helper functions
function calculateTimeOffset(time: Date, startTime: Date): number {
  const diffMinutes = (time.getTime() - startTime.getTime()) / (1000 * 60)
  return (diffMinutes / 30) * SLOT_WIDTH
}

function msToPixels(ms: number): number {
  return (ms / (30 * 60 * 1000)) * SLOT_WIDTH
}

function pixelsToMs(px: number): number {
  return (px / SLOT_WIDTH) * SLOT_MS
}

// The rendered element of a grid cell: its label, block or live action
function findCellElement(container: HTMLElement, cell: GridCell): HTMLElement | null {
  for (const element of container.querySelectorAll<HTMLElement>('[data-grid-row]')) {
    if (element.dataset.gridRow === cell.rowId && (element.dataset.gridBlock ?? null) === cell.blockId) return element
  }
  return null
}

// Where a programme sits relative to now: start is inclusive, stop is exclusive
function stateAt(startMs: number, stopMs: number, nowMs: number): ProgrammeState {
  if (nowMs < startMs) return 'future'
  if (nowMs < stopMs) return 'now'
  return 'past'
}

const NO_ENTRIES: readonly IndexedProgramme[] = []

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

// Built once: creating a formatter per call is slow across ~1,400 blocks
const timeFormat = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' })
const dayFormat = new Intl.DateTimeFormat([], { weekday: 'short', day: 'numeric' })

function formatTime(date: Date | number): string {
  return timeFormat.format(date)
}

// Local midnight of the day ms falls on
function startOfDay(ms: number): number {
  const day = new Date(ms)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

// 'Today', 'Tomorrow', or 'Mon 28' for the day starting at dayStartMs
function formatDay(dayStartMs: number, nowMs: number): string {
  const today = startOfDay(nowMs)
  if (dayStartMs === today) return 'Today'
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (dayStartMs === tomorrow.getTime()) return 'Tomorrow'
  return dayFormat.format(dayStartMs)
}

interface TimeSlotLabelsProps {
  slots: Date[]
}

// The header's half-hour labels. Memoised on the slot list, which only
// changes with the grid's range, so clock ticks don't re-format them.
const TimeSlotLabels = memo(function TimeSlotLabels({ slots }: TimeSlotLabelsProps) {
  return slots.map((slot, i) => {
    const isMidnight = slot.getHours() === 0 && slot.getMinutes() === 0
    return (
      <div
        key={i}
        className={cn(
          'shrink-0 overflow-clip border-l px-2 py-2 text-sm text-muted-foreground',
          isMidnight && 'border-l-foreground/40'
        )}
        style={{ width: SLOT_WIDTH }}
      >
        <span
          className="sticky block h-[1lh] w-fit overflow-clip"
          style={{ left: STICKY_TEXT_LEFT, maxWidth: visiblePartWidth(i * SLOT_WIDTH) }}
        >
          {/* A label too wide for that width wraps after the
              zero-width space onto a second line, which the one-line
              height clips */}
          {'\u200B'}
          <span className="inline-block whitespace-nowrap tabular-nums">
            {isMidnight && (
              <span data-testid="day-marker" className="mr-1.5 font-semibold text-foreground">
                {dayFormat.format(slot)}
              </span>
            )}
            {formatTime(slot)}
          </span>
        </span>
      </div>
    )
  })
})

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
