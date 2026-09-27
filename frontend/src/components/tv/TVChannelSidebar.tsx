import { useEffect, useMemo, useRef, type Ref } from 'react'
import { AudioLines, ChevronLeft, ChevronRight, Radio, Star } from 'lucide-react'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, buildUnifiedChannels, describeLiveGuide } from '@/stores/tvStore'
import { useChannelStore } from '@/stores/channelStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { useRovingTabIndex } from '@/hooks/useRovingTabIndex'
import { useFilteredChannels } from '@/hooks/useFilteredChannels'
import { useChannelPrefsStore } from '@/stores/channelPrefsStore'
import { ChannelFilterBar, NoChannelsMatch } from '@/components/tv/ChannelFilterBar'
import { LivePill } from '@/components/LivePill'
import { ChannelLogo } from '@/components/ChannelLogo'
import { ChannelPresenceSpace, ChannelPresenceStack } from '@/components/tv/ChannelPresenceStack'
import { usePresenceByChannel } from '@/hooks/usePresenceByChannel'
import { calculateProgress, findOnAir, formatRemaining, getProgrammeState } from '@/lib/programmes'
import { buildProgrammeIndex, findCurrentAndNext, type IndexedProgramme } from '@/lib/programmeIndex'
import { favouritesFirst } from '@/lib/channelSearch'
import { cn } from '@/lib/utils'
import type { PresenceEntry, UnifiedChannel } from '@/types'

const getChannelId = (channel: UnifiedChannel) => channel.id

// What a screen reader hears for a row or rail tile. The live slot names what
// is on it, since its visible number and icon say nothing on their own.
function channelLabel(channel: UnifiedChannel, hasLiveChannel: boolean, liveProgramme: string) {
  if (channel.type !== 'live') return `${channel.number} ${channel.name}`
  if (!hasLiveChannel) return 'Live slot, nothing on'
  return `${channel.number} Live: ${channel.name}, ${liveProgramme}`
}

interface TVChannelSidebarProps {
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  // False where the layout holds the list at its rail (a tablet held
  // sideways): the rail then has no expand button
  canExpand?: boolean
  liveEPGTitle?: string | null
  // Opens the Live TV switcher; only for people allowed to change live TV
  onPickLive?: () => void
}

export function TVChannelSidebar({
  isCollapsed = false,
  onToggleCollapse,
  canExpand = true,
  liveEPGTitle,
  onPickLive,
}: TVChannelSidebarProps) {
  // Field selectors: the sidebar re-renders for what it shows, not on every
  // update to the stores it reads
  const ersatzTVChannels = useErsatztvStore((s) => s.channels)
  const channelsLoading = useErsatztvStore((s) => s.channelsLoading)
  const error = useErsatztvStore((s) => s.error)
  const loadChannels = useErsatztvStore((s) => s.loadChannels)
  const selectedChannel = useTVStore((s) => s.selectedChannel)
  const selectChannel = useTVStore((s) => s.selectChannel)
  const liveEPGStatus = useTVStore((s) => s.liveEPGStatus)
  const liveChannel = useChannelStore((s) => s.currentChannel)
  // Now/next come from the guide's programmes, which TVView refreshes every
  // 2h, so a schedule edit in ErsatzTV shows here on that refresh
  const programmesByChannel = useErsatztvStore((s) => s.programmesByChannel)
  const now = useProgrammeClock()
  const programmeIndex = buildProgrammeIndex(programmesByChannel)

  // The unified list, built from the two stores it comes from, so the live
  // slot follows live TV and the search keeps its memo between renders
  const unifiedChannels = useMemo(
    () => buildUnifiedChannels(liveChannel, ersatzTVChannels),
    [liveChannel, ersatzTVChannels]
  )
  const hasLiveChannel = liveChannel !== null
  const liveProgramme = liveEPGTitle || describeLiveGuide(liveEPGStatus)

  // The expanded list goes through the search and chips; the rail, which
  // has no search box, lists every channel with the favourites first
  const { channels: filteredChannels, isFiltering } = useFilteredChannels(unifiedChannels, programmesByChannel)
  const favouriteChannelIds = useChannelPrefsStore((s) => s.favouriteChannelIds)
  const toggleFavourite = useChannelPrefsStore((s) => s.toggleFavourite)
  // Who else is on each row; empty unless this viewer sees channels
  const presenceByChannel = usePresenceByChannel()
  const listedChannels = isCollapsed ? favouritesFirst(unifiedChannels, favouriteChannelIds) : filteredChannels

  // '/' on the rail: expand it, and the search box in the list takes focus
  // once it's there
  const searchFocusRequested = useChannelPrefsStore((s) => s.searchFocusRequested)
  useEffect(() => {
    if (isCollapsed && canExpand && searchFocusRequested) onToggleCollapse?.()
  }, [isCollapsed, canExpand, searchFocusRequested, onToggleCollapse])

  // One tab stop for the channels: arrow keys, Home and End move between
  // them. The list and the rail share it (only one is mounted), and the tab
  // stop follows whichever channel was last focused.
  const listRef = useRef<HTMLElement | null>(null)
  const setListRef = (element: HTMLElement | null) => {
    listRef.current = element
  }
  const { getTabIndex, handleKeyDown, setFocusedIndex, itemRefs } = useRovingTabIndex({
    items: listedChannels,
    getItemId: getChannelId,
    containerRef: listRef,
  })

  // Keep the selected channel in view: when the list mounts (a restored
  // channel may be far down), when the rail collapses or expands, and when
  // the selection changes. Only one of the rail or the list is mounted, so
  // they share the map.
  const channelRefs = useRef(new Map<string, HTMLButtonElement>())
  const setChannelRef = (channelId: string, index: number) => (element: HTMLButtonElement | null) => {
    if (element) channelRefs.current.set(channelId, element)
    else channelRefs.current.delete(channelId)
    itemRefs.current[index] = element
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
        {canExpand && (
          <button
            onClick={onToggleCollapse}
            className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent"
            aria-label="Expand channel sidebar"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
        {/* No scrollbar: a classic 15px one would widen the list past the 64px rail
            and push the tiles off-centre. Wheel, touch and keyboard focus still scroll it. */}
        <div
          ref={setListRef}
          onKeyDown={handleKeyDown}
          className="mt-2 flex w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-3 pt-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {listedChannels.map((channel, index) => (
            <CollapsedChannelButton
              key={channel.id}
              ref={setChannelRef(channel.id, index)}
              channel={channel}
              label={channelLabel(channel, hasLiveChannel, liveProgramme)}
              isSelected={selectedChannel?.id === channel.id}
              isFavourite={channel.type !== 'live' && favouriteChannelIds.includes(channel.id)}
              hasLiveChannel={hasLiveChannel}
              canPickLive={!!onPickLive}
              onSelect={handleChannelClick}
              tabIndex={getTabIndex(index)}
              onFocus={() => setFocusedIndex(index)}
            />
          ))}
        </div>
      </aside>
    )
  }

  // Expanded state
  return (
    <aside className="epg-scroll h-full w-72 overflow-y-auto border-r bg-card rounded-r-lg">
      {/* The header and the filter stick together, so the search stays in
          reach however far the list is scrolled */}
      <div className="sticky top-0 z-10 bg-card/95 backdrop-blur">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">Channels</h2>
          <button
            onClick={onToggleCollapse}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
            aria-label="Collapse channel sidebar"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
        <ChannelFilterBar className="border-b p-3" />
      </div>

      <ul ref={setListRef} onKeyDown={handleKeyDown} className="divide-y" role="list">
        {listedChannels.map((channel, index) => {
          const { current: onAir, next } =
            channel.type === 'live'
              ? { current: null, next: null }
              : findCurrentAndNext(programmeIndex, channel.id, now)
          return (
            <ChannelItem
              key={channel.id}
              ref={setChannelRef(channel.id, index)}
              channel={channel}
              label={channelLabel(channel, hasLiveChannel, liveProgramme)}
              isSelected={selectedChannel?.id === channel.id}
              onSelect={handleChannelClick}
              isFavourite={favouriteChannelIds.includes(channel.id)}
              onToggleFavourite={toggleFavourite}
              tabIndex={getTabIndex(index)}
              onFocus={() => setFocusedIndex(index)}
              currentProgramme={channel.type === 'live' ? liveProgramme : onAir?.programme.title}
              onAir={onAir}
              next={next}
              currentTime={now}
              hasLiveChannel={hasLiveChannel}
              onPickLive={onPickLive}
              people={presenceByChannel.get(channel.id)}
            />
          )
        })}
      </ul>
      {/* Row 0 always stays, so nothing matching means nothing after it */}
      {isFiltering && listedChannels.length <= 1 && ersatzTVChannels.length > 0 && <NoChannelsMatch />}
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
  label: string
  isSelected: boolean
  isFavourite: boolean
  hasLiveChannel: boolean
  // Whether this viewer may put something on live TV (changes the empty-slot copy)
  canPickLive: boolean
  onSelect: (channel: UnifiedChannel) => void
  // Roving focus: 0 on the one tab stop, -1 on the rest
  tabIndex: 0 | -1
  onFocus: () => void
}

function CollapsedChannelButton({
  ref,
  channel,
  label,
  isSelected,
  isFavourite,
  hasLiveChannel,
  canPickLive,
  onSelect,
  tabIndex,
  onFocus,
}: CollapsedChannelButtonProps) {
  const isLive = channel.type === 'live'
  const isLiveOn = isLive && hasLiveChannel

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          onClick={() => onSelect(channel)}
          onFocus={onFocus}
          tabIndex={tabIndex}
          className={cn(
            'relative flex h-10 shrink-0 scroll-my-1 items-center justify-center rounded-lg font-display text-sm font-extrabold tabular-nums overflow-hidden',
            'hover:bg-foreground/10 focus-visible:-outline-offset-2',
            isLive ? 'w-auto min-w-10 px-1' : 'w-10',
            isSelected && 'ring-2 ring-primary',
            // One background: the live tint wins (the ring marks selection), then selection, then muted
            isLiveOn ? 'bg-live/20 text-live' : isSelected ? 'bg-primary/10' : 'bg-muted'
          )}
          // The favourites lead the rail; the label says why this one is up there
          aria-label={isFavourite ? `${label}, favourite` : label}
          aria-current={isSelected ? 'true' : undefined}
        >
          {isFavourite && (
            <Star
              aria-hidden="true"
              data-testid="favourite-mark"
              className="absolute top-0.5 left-0.5 z-10 h-2.5 w-2.5 fill-current text-primary"
            />
          )}
          {isLive ? (
            hasLiveChannel ? (
              // The live channel's logo on the tile's live tint, or the icon
              <ChannelLogo
                channel={channel}
                className="size-8 bg-transparent"
                fallback={<Radio className="h-4 w-4 text-live" />}
              />
            ) : (
              '0'
            )
          ) : channel.logoUrl ? (
            <>
              <ChannelLogo channel={channel} className="size-full rounded-none bg-transparent" />
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
  label: string
  isSelected: boolean
  onSelect: (channel: UnifiedChannel) => void
  isFavourite: boolean
  onToggleFavourite: (channelId: string) => void
  // Roving focus: 0 on the one tab stop, -1 on the rest
  tabIndex: 0 | -1
  onFocus: () => void
  currentProgramme?: string | null
  // The ErsatzTV programme on air, with its parsed times
  onAir: IndexedProgramme | null
  // The ErsatzTV programme after it (or after the gap)
  next: IndexedProgramme | null
  currentTime: number
  hasLiveChannel: boolean
  onPickLive?: () => void
  // Who else is on the channel (usePresenceByChannel)
  people?: PresenceEntry[]
}

function ChannelItem({
  ref,
  channel,
  label,
  isSelected,
  onSelect,
  isFavourite,
  onToggleFavourite,
  tabIndex,
  onFocus,
  currentProgramme,
  onAir,
  next,
  currentTime,
  hasLiveChannel,
  onPickLive,
  people,
}: ChannelItemProps) {
  const isLive = channel.type === 'live'
  const progress = onAir ? calculateProgress(onAir.startMs, onAir.stopMs, currentTime) : 0
  const timeRemaining = onAir ? formatRemaining(onAir.stopMs, currentTime) : null
  // The empty live slot offers the picker next to the row (a sibling, since
  // buttons can't nest)
  const showPickLive = isLive && !hasLiveChannel && !!onPickLive
  // Every channel but the live slot, which is always the first row anyway,
  // can be starred. The star is the row's sibling, since buttons can't nest.
  const showStar = !isLive
  // The people on the channel, but never on the empty live slot
  const presence = people && people.length > 0 && (!isLive || hasLiveChannel) ? people : null

  return (
    // One background per row: the live row's tint is on the item, so it runs
    // under the picker too; the selection tint is on the button
    <li
      className={cn(
        isLive && 'bg-live/5',
        showPickLive ? 'flex items-center pr-3' : (showStar || presence) && 'relative'
      )}
    >
      {/* scroll-mt clears the sticky Channels header and filter when the row is scrolled into view */}
      <button
        ref={ref}
        onClick={() => onSelect(channel)}
        onFocus={onFocus}
        tabIndex={tabIndex}
        className={cn(
          'flex scroll-mt-41 items-center gap-3 p-3 text-left transition-colors',
          'hover:bg-accent focus-visible:-outline-offset-2',
          showPickLive ? 'min-w-0 flex-1' : 'w-full',
          showStar && 'pr-12',
          // The live row's tint (on the item) wins; the border marks selection
          isSelected && 'border-l-4 border-primary',
          isSelected && !isLive && 'bg-primary/10'
        )}
        aria-current={isSelected ? 'true' : undefined}
        aria-label={label}
      >
        {/* Channel logo, or the live slot's icon while it has none */}
        <ChannelLogo
          channel={channel}
          className={cn('size-12 rounded', isLive && 'bg-live/20')}
          fallback={isLive ? <Radio className="h-6 w-6 text-live" /> : undefined}
        />

        {/* Channel info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-lg font-extrabold leading-none tabular-nums text-muted-foreground">
              {channel.number}
            </span>
            <span className="truncate font-medium">
              {isLive ? (hasLiveChannel ? channel.name : 'Live') : channel.name}
            </span>
            {isLive && hasLiveChannel && <LivePill />}
          </div>
          {/* Beside Pick a channel the idle copy wraps rather than cutting to 'Nothing …' */}
          <p className={cn('text-sm text-muted-foreground', showPickLive ? 'line-clamp-2' : 'truncate')}>
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
        {/* Room for the people on the channel, laid over it below */}
        {presence && <ChannelPresenceSpace people={presence} />}
      </button>
      {presence && (
        // Over its room: centred like it, at the button's right padding. It
        // shares the row's tab stop, like the star.
        <ChannelPresenceStack
          people={presence}
          channelName={channel.name}
          isWatching={isSelected}
          onJoin={() => onSelect(channel)}
          tabIndex={tabIndex}
          className={cn('absolute top-1/2 -translate-y-1/2', showStar ? 'right-12' : 'right-3')}
        />
      )}
      {showPickLive && (
        <Button size="sm" onClick={onPickLive}>
          Pick a channel
        </Button>
      )}
      {showStar && (
        // The row's tab stop covers its star too, so Tab goes from a row to
        // its star and the list stays one stop long
        <button
          type="button"
          onClick={() => onToggleFavourite(channel.id)}
          tabIndex={tabIndex}
          aria-pressed={isFavourite}
          aria-label={`Favourite ${channel.name}`}
          className={cn(
            'absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md hover:bg-accent focus-visible:-outline-offset-2',
            isFavourite ? 'text-primary' : 'text-muted-foreground/60 hover:text-foreground'
          )}
        >
          <Star aria-hidden="true" className={cn('h-4 w-4', isFavourite && 'fill-current')} />
        </button>
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
