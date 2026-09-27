import { useEffect, useId, useMemo, useRef, type FocusEvent, type KeyboardEvent } from 'react'
import { findPresenceChannel, presenceRowId, useOthersHere, useSeesPresenceChannels } from '@/hooks/usePresenceByChannel'
import { useRovingTabIndex } from '@/hooks/useRovingTabIndex'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { buildUnifiedChannels, useTVStore } from '@/stores/tvStore'
import { getRemoteAction } from '@/lib/remoteKeys'
import { MemberAvatar } from '@/components/MemberAvatar'
import { LivePill } from '@/components/LivePill'
import { cn } from '@/lib/utils'
import type { PresenceEntry, UnifiedChannel } from '@/types'
import { KeyHint } from './CouchGuide'

interface RoomPanelProps {
  /**
   * Hides the panel: after joining someone, on Back or the green key, when
   * focus leaves it, or once nobody else is here
   */
  onClose: () => void
}

/** One person in the panel */
interface RoomRow {
  key: string
  person: PresenceEntry
  /** Whether their channel shows: this viewer sees channels, and they share theirs */
  showChannel: boolean
  /** The channel OK tunes to join them, or null: names only, not in this list, or already on it */
  joinChannel: UnifiedChannel | null
}

const getRowKey = (row: RoomRow) => row.key

/**
 * Who else is here, for the couch: each friend's name, large, and what
 * they're on while channels are shown (the admin's 'Show what everyone is
 * watching', and this viewer not hiding their own). Otherwise names only,
 * with nothing to join. It shows nothing, and closes, while nobody else is
 * here.
 *
 * A one-column list for the D-pad, like the guide: Up and Down move, OK on a
 * friend on another channel joins them and hides the panel, Back (or the
 * green key that opened it) hides it. It holds focus while it's open, puts
 * focus back on a row when the person focused leaves, and hides when focus
 * goes elsewhere, such as a Magic Remote click on the picture.
 */
export function RoomPanel({ onClose }: RoomPanelProps) {
  const people = useOthersHere()
  const seesChannels = useSeesPresenceChannels()
  const liveChannel = useChannelStore((s) => s.currentChannel)
  const ersatzTVChannels = useErsatztvStore((s) => s.channels)
  const selectedChannelId = useTVStore((s) => s.selectedChannel?.id)
  const selectChannel = useTVStore((s) => s.selectChannel)
  const channels = useMemo(() => buildUnifiedChannels(liveChannel, ersatzTVChannels), [liveChannel, ersatzTVChannels])

  const rows = useMemo(
    () =>
      people.map((person, index): RoomRow => {
        const showChannel = seesChannels && presenceRowId(person) !== null
        const channel = showChannel ? findPresenceChannel(person, channels) : null
        return {
          key: person.userId ?? `${index}:${person.displayName}`,
          person,
          showChannel,
          joinChannel: channel !== null && channel.id !== selectedChannelId ? channel : null,
        }
      }),
    [people, seesChannels, channels, selectedChannelId]
  )

  const join = (row: RoomRow) => {
    // Names only, or already watching together: OK does nothing
    if (!row.joinChannel) return
    selectChannel(row.joinChannel)
    onClose()
  }

  const { focusedIndex, getTabIndex, handleKeyDown, setFocusedIndex, itemRefs } = useRovingTabIndex({
    items: rows,
    getItemId: getRowKey,
    onSelect: join,
  })

  const listRef = useRef<HTMLUListElement>(null)

  // Focus moves into the panel as it opens, so the remote's keys reach it,
  // and back onto a row when the person focused leaves (their row takes
  // focus with it)
  useEffect(() => {
    if (!listRef.current?.contains(document.activeElement)) itemRefs.current[focusedIndex]?.focus()
  }, [rows, focusedIndex, itemRefs])

  // Nobody else here, or the last one left: nothing to show
  const isEmpty = rows.length === 0
  useEffect(() => {
    if (isEmpty) onClose()
  }, [isEmpty, onClose])

  const handleListKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // A remote's Back and green key arrive as key codes with no key name,
    // which only getRemoteAction reads
    const action = getRemoteAction(e.nativeEvent)
    if (action === 'back' || action === 'room') {
      // Stops webOS Back and Backspace from also navigating history
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    handleKeyDown(e)
  }

  const handleListBlur = (e: FocusEvent<HTMLElement>) => {
    const list = e.currentTarget
    const to = e.relatedTarget
    if (to instanceof Node && list.contains(to)) return
    if (to !== null) {
      onClose()
      return
    }
    // Focus fell to nothing: a click on the picture, or the focused person
    // leaving, whose row the effect above replaces. Decided once it has run.
    setTimeout(() => {
      if (!list.contains(document.activeElement)) onClose()
    })
  }

  const titleId = useId()

  if (isEmpty) return null

  const canJoinSomeone = rows.some((row) => row.joinChannel !== null)

  return (
    // At the side of the picture, which keeps playing; inside the TV's
    // title-safe area (index.css .couch tokens)
    <div className="absolute top-(--couch-safe-y) right-(--couch-safe-x) z-30 flex max-h-[90vh] w-[44rem] max-w-[45vw] flex-col rounded-3xl bg-background/90 py-8 text-foreground shadow-2xl">
      <div className="mb-3 flex items-baseline justify-between px-12">
        <h2 id={titleId} className="font-display text-3xl font-extrabold uppercase tracking-[0.14em] text-foreground/80">
          Here now
        </h2>
        <span aria-hidden="true" className="font-display text-4xl font-black tabular-nums text-muted-foreground">
          {rows.length}
        </span>
      </div>
      {/* Padding leaves room for the focused row's outline and scale, as in
          the guide. No scrollbar, since a remote scrolls it by moving focus */}
      <ul
        ref={listRef}
        role="listbox"
        aria-labelledby={titleId}
        onKeyDown={handleListKeyDown}
        onBlur={handleListBlur}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-3 [scrollbar-width:none] motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden"
      >
        {rows.map((row, index) => {
          const { person, showChannel, joinChannel } = row
          const isFocused = index === focusedIndex
          return (
            <li
              key={row.key}
              ref={(element) => {
                itemRefs.current[index] = element
              }}
              role="option"
              aria-selected={isFocused}
              tabIndex={getTabIndex(index)}
              onFocus={() => setFocusedIndex(index)}
              onClick={() => join(row)}
              className={cn(
                'grid min-h-24 scroll-my-3 grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-5 rounded-2xl px-6 py-3',
                'transition-transform duration-150 motion-reduce:transition-none',
                // Focus shows by more than colour: the row lifts and scales
                // (the couch's outline marks it too)
                isFocused && 'scale-[1.015] bg-foreground/12 shadow-2xl'
              )}
            >
              <MemberAvatar
                username={person.displayName}
                userId={person.userId ?? undefined}
                decorative
                className="size-16 text-2xl"
              />
              <div className="min-w-0">
                <p className="truncate text-3xl font-bold">{person.displayName}</p>
                {showChannel && (
                  <p className="mt-1 flex min-w-0 items-center gap-3 text-2xl text-muted-foreground">
                    {person.view === 'live' && <LivePill />}
                    <span className="truncate">
                      {person.channelName}
                      {person.programme && ` · ${person.programme}`}
                    </span>
                  </p>
                )}
              </div>
              {joinChannel && (
                <span className={cn('text-2xl font-bold', isFocused ? 'text-primary' : 'text-muted-foreground')}>
                  Join
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {/* The remote's keys for the panel, as the guide shows its own */}
      <p className="mt-4 flex flex-wrap gap-x-9 gap-y-3 px-12 text-2xl font-semibold text-foreground/80">
        {rows.length > 1 && <KeyHint keys={['▲', '▼']}>Choose</KeyHint>}
        {canJoinSomeone && <KeyHint keys={['OK']}>Join</KeyHint>}
        <KeyHint keys={['Back']}>Hide</KeyHint>
      </p>
    </div>
  )
}
