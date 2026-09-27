import { useEffect, useId, useMemo, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { AudioLines, Radio } from 'lucide-react'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useChannelStore } from '@/stores/channelStore'
import { buildUnifiedChannels, describeLiveGuide, useTVStore, type LiveEPGStatus } from '@/stores/tvStore'
import { useProgrammeClock } from '@/hooks/useProgrammeClock'
import { useRovingTabIndex } from '@/hooks/useRovingTabIndex'
import { buildProgrammeIndex, findCurrentAndNext, type ProgrammeIndex } from '@/lib/programmeIndex'
import { calculateProgress } from '@/lib/programmes'
import { getRemoteAction } from '@/lib/remoteKeys'
import { ChannelLogo } from '@/components/ChannelLogo'
import { LivePill } from '@/components/LivePill'
import { cn } from '@/lib/utils'
import type { EPGResponse, UnifiedChannel } from '@/types'

interface CouchGuideProps {
  /** Hides the guide: after a channel is picked, on Back or Guide, or when focus leaves it */
  onClose: () => void
  /** Whether this viewer may put something on live TV (changes the empty slot's copy) */
  canPickLive: boolean
}

const getChannelId = (channel: UnifiedChannel) => channel.id

// Created once: every row formats its Next time on every clock tick
const nextTimeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** What a row shows under its name */
interface RowGuide {
  now: string
  /** How far into the programme on now, 0-100, or null with nothing timed on */
  progress: number | null
  next: string | null
}

function formatNext(startMs: number, title: string) {
  return `${nextTimeFormat.format(startMs)} ${title}`
}

function liveRowGuide(
  hasLiveChannel: boolean,
  canPickLive: boolean,
  liveEPG: EPGResponse | null,
  liveEPGStatus: LiveEPGStatus,
  nowMs: number
): RowGuide {
  // The same copy as the empty live row in the channel list
  if (!hasLiveChannel) {
    return { now: canPickLive ? 'Nothing on yet' : 'Waiting for someone to put something on', progress: null, next: null }
  }
  const current = liveEPG?.currentProgram ?? null
  const next = liveEPG?.nextProgram ?? null
  const startMs = current ? new Date(current.startTime).getTime() : NaN
  const stopMs = current ? new Date(current.endTime).getTime() : NaN
  const nextStartMs = next ? new Date(next.startTime).getTime() : NaN
  return {
    now: current?.title ?? describeLiveGuide(liveEPGStatus),
    progress: Number.isFinite(startMs) && Number.isFinite(stopMs) ? calculateProgress(startMs, stopMs, nowMs) : null,
    next: next && Number.isFinite(nextStartMs) ? formatNext(nextStartMs, next.title) : null,
  }
}

function channelRowGuide(index: ProgrammeIndex, channelId: string, nowMs: number): RowGuide {
  const { current, next } = findCurrentAndNext(index, channelId, nowMs)
  return {
    now: current?.programme.title ?? '',
    progress: current ? calculateProgress(current.startMs, current.stopMs, nowMs) : null,
    next: next ? formatNext(next.startMs, next.programme.title) : null,
  }
}

/**
 * The couch's guide: every channel with what's on now and next, over the
 * bottom of the picture, which keeps playing. A one-column list for the
 * D-pad: Up and Down move, OK watches the channel and hides the guide, Back
 * (or Guide) hides it. It opens on the channel playing.
 *
 * Deliberately not the 48-hour guide grid: over a thousand buttons are too
 * heavy for a TV's chip and awkward with a D-pad. If a grid comes back here,
 * adopt @noriginmedia/norigin-spatial-navigation rather than growing
 * useRovingTabIndex into two dimensions.
 *
 * It holds focus while it's open (CouchView leaves keys inside a listbox to
 * it), and hides when focus leaves it, such as a Magic Remote click on the
 * picture, so an open guide always has the remote's keys.
 */
export function CouchGuide({ onClose, canPickLive }: CouchGuideProps) {
  const ersatzTVChannels = useErsatztvStore((s) => s.channels)
  const programmesByChannel = useErsatztvStore((s) => s.programmesByChannel)
  const liveChannel = useChannelStore((s) => s.currentChannel)
  const selectedChannel = useTVStore((s) => s.selectedChannel)
  const selectChannel = useTVStore((s) => s.selectChannel)
  const liveEPG = useTVStore((s) => s.liveEPG)
  const liveEPGStatus = useTVStore((s) => s.liveEPGStatus)
  const now = useProgrammeClock()
  const programmeIndex = buildProgrammeIndex(programmesByChannel)

  const channels = useMemo(
    () => buildUnifiedChannels(liveChannel, ersatzTVChannels),
    [liveChannel, ersatzTVChannels]
  )

  // Opens on the channel playing (read once: the list keeps the tab stop on
  // the same channel as it updates)
  const [initialIndex] = useState(() =>
    Math.max(0, channels.findIndex((channel) => channel.id === selectedChannel?.id))
  )

  const watch = (channel: UnifiedChannel) => {
    // Picking the channel playing only hides the guide
    if (channel.id !== selectedChannel?.id) selectChannel(channel)
    onClose()
  }

  const { focusedIndex, getTabIndex, handleKeyDown, setFocusedIndex, itemRefs } = useRovingTabIndex({
    items: channels,
    getItemId: getChannelId,
    onSelect: watch,
    initialIndex,
  })

  // Focus moves into the guide as it opens, so the remote's keys reach it
  useEffect(() => {
    itemRefs.current[initialIndex]?.focus()
  }, [initialIndex, itemRefs])

  const handleListKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // A remote's Back arrives as keyCode 461 or 10009 with no key name, which
    // only getRemoteAction reads
    const action = getRemoteAction(e.nativeEvent)
    if (action === 'back' || action === 'guide') {
      // Stops webOS Back and Backspace from also navigating history
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    handleKeyDown(e)
  }

  const handleListBlur = (e: FocusEvent<HTMLElement>) => {
    const to = e.relatedTarget
    if (!(to instanceof Node && e.currentTarget.contains(to))) onClose()
  }

  const hasLiveChannel = liveChannel !== null
  const titleId = useId()

  return (
    // Over the bottom of the picture, fading into it; inside the TV's
    // title-safe area (index.css .couch tokens)
    <div className="absolute inset-x-0 bottom-0 z-30 flex h-[56%] flex-col bg-linear-to-t from-background from-60% via-background/80 to-transparent px-(--couch-safe-x) pt-16 pb-(--couch-safe-y) text-foreground">
      <div className="mb-3 flex items-baseline justify-between px-14">
        <h2 id={titleId} className="font-display text-3xl font-extrabold uppercase tracking-[0.14em] text-foreground/80">
          Channels
        </h2>
        <span className="text-2xl font-semibold text-muted-foreground">Now · Next</span>
      </div>
      {/* Padding leaves room for the focused row's outline and scale: a
          scrolling list clips both ways, and at 1920px wide the scale adds
          about 13px a side and the outline 7px more. No scrollbar, since a
          remote scrolls it by moving focus */}
      <ul
        role="listbox"
        aria-labelledby={titleId}
        onKeyDown={handleListKeyDown}
        onBlur={handleListBlur}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-8 py-3 [scrollbar-width:none] motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden"
      >
        {channels.map((channel, index) => {
          const isLive = channel.type === 'live'
          const isFocused = index === focusedIndex
          const isPlaying = channel.id === selectedChannel?.id
          const guide = isLive
            ? liveRowGuide(hasLiveChannel, canPickLive, liveEPG, liveEPGStatus, now)
            : channelRowGuide(programmeIndex, channel.id, now)
          return (
            <li
              key={channel.id}
              ref={(element) => {
                itemRefs.current[index] = element
              }}
              role="option"
              aria-selected={isFocused}
              aria-current={isPlaying ? 'true' : undefined}
              tabIndex={getTabIndex(index)}
              onFocus={() => setFocusedIndex(index)}
              onClick={() => watch(channel)}
              className={cn(
                'grid h-24 scroll-my-3 grid-cols-[4.5rem_4.75rem_minmax(0,18rem)_minmax(0,1fr)_minmax(0,28rem)] items-center gap-6 rounded-2xl px-6',
                'transition-transform duration-150 motion-reduce:transition-none',
                // Focus shows by more than colour: the row lifts and scales
                // (the couch's outline marks it too)
                isFocused && 'scale-[1.015] bg-foreground/12 shadow-2xl'
              )}
            >
              <span
                className={cn(
                  'text-right font-display text-5xl font-black leading-none tabular-nums',
                  isFocused ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                {channel.number}
              </span>
              <ChannelLogo
                channel={channel}
                className={cn('size-19 rounded-xl', isLive && 'bg-live/20')}
                fallback={isLive ? <Radio className="size-9 text-live" /> : undefined}
              />
              <span className="flex min-w-0 items-center gap-3 text-3xl font-bold">
                <span className="truncate">{isLive && !hasLiveChannel ? 'Live' : channel.name}</span>
                {isLive && hasLiveChannel && <LivePill />}
                {isPlaying && (
                  <AudioLines
                    aria-hidden="true"
                    data-testid="now-playing-indicator"
                    className={cn('size-7 shrink-0', isLive ? 'text-live' : 'text-primary')}
                  />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-3xl font-semibold">{guide.now}</p>
                {guide.progress !== null && (
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-foreground/15">
                    <div
                      data-testid="programme-progress"
                      className={cn('h-full rounded-full', isLive ? 'bg-live' : 'bg-primary')}
                      style={{ width: `${guide.progress}%` }}
                    />
                  </div>
                )}
              </div>
              <p className="truncate text-2xl text-muted-foreground">{guide.next}</p>
            </li>
          )
        })}
      </ul>
      {/* The remote's keys for the guide, as the channel banner shows its own */}
      <p className="mt-4 flex gap-11 px-14 text-2xl font-semibold text-foreground/80">
        <KeyHint keys={['▲', '▼']}>Choose</KeyHint>
        <KeyHint keys={['OK']}>Watch</KeyHint>
        <KeyHint keys={['Back']}>Hide guide</KeyHint>
      </p>
    </div>
  )
}

/** A remote key hint: the keys as key caps, then what they do */
function KeyHint({ keys, children }: { keys: string[]; children: ReactNode }) {
  return (
    <span className="flex items-center gap-3">
      {keys.map((key) => (
        <kbd
          key={key}
          className="grid h-11 min-w-11 place-items-center rounded-lg border-2 border-foreground/35 px-2.5 font-sans text-xl font-extrabold"
        >
          {key}
        </kbd>
      ))}
      {children}
    </span>
  )
}
