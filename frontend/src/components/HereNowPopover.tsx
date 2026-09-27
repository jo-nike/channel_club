import { useId, useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { MemberAvatar } from '@/components/MemberAvatar'
import { LivePill } from '@/components/LivePill'
import { PresenceStack } from '@/components/PresenceStack'
import { findPresenceChannel, presenceRowId, useOthersHere, useSeesPresenceChannels } from '@/hooks/usePresenceByChannel'
import { useChannelStore } from '@/stores/channelStore'
import { useErsatztvStore } from '@/stores/ersatztvStore'
import { useTVStore, buildUnifiedChannels } from '@/stores/tvStore'
import { cn } from '@/lib/utils'
import type { PresenceEntry } from '@/types'

/**
 * Where the trigger sits:
 * - chat: the chat panel's header, a quiet 'N here' beside the title
 * - header: the page header beside Chat, a pill with the stack and 'N here'
 * - phone: the phone header, avatars only in a 44px target (the count is
 *   still its name)
 */
export type HereNowVariant = 'chat' | 'header' | 'phone'

const TRIGGER_CLASSES: Record<HereNowVariant, string> = {
  chat: 'h-8 gap-1.5 rounded-full px-2 text-xs font-semibold text-muted-foreground hover:text-foreground',
  header: 'h-11 gap-2 rounded-full border border-border bg-card pr-3 pl-1.5 text-sm font-semibold md:h-9',
  phone: 'h-11 rounded-full px-1.5',
}

// Avatars before '+n' in each place
const STACK_MAX: Record<HereNowVariant, number> = { chat: 3, header: 4, phone: 2 }

interface HereNowListProps {
  people: PresenceEntry[]
  onJoined: () => void
}

/**
 * The open list: each person, and with channels shown, what they're on and
 * a Join for anyone on another channel. Mounted only while open, so the
 * channel list is only built then.
 */
function HereNowList({ people, onJoined }: HereNowListProps) {
  const headingId = useId()
  const seesChannels = useSeesPresenceChannels()
  const liveChannel = useChannelStore((s) => s.currentChannel)
  const ersatzTVChannels = useErsatztvStore((s) => s.channels)
  const selectedChannelId = useTVStore((s) => s.selectedChannel?.id)
  const selectChannel = useTVStore((s) => s.selectChannel)
  const channels = useMemo(() => buildUnifiedChannels(liveChannel, ersatzTVChannels), [liveChannel, ersatzTVChannels])

  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="flex justify-between px-1 pb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
      >
        Here now <span aria-hidden="true">{people.length}</span>
      </h3>
      <ul className="grid gap-1">
        {people.map((person, index) => {
          // Names only unless this viewer sees channels and the person shares theirs
          const showChannel = seesChannels && presenceRowId(person) !== null
          const channel = showChannel ? findPresenceChannel(person, channels) : null
          const canJoin = channel !== null && channel.id !== selectedChannelId
          return (
            <li
              key={person.userId ?? `${index}:${person.displayName}`}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-md px-1 py-1"
            >
              <MemberAvatar username={person.displayName} userId={person.userId ?? undefined} decorative />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{person.displayName}</p>
                {showChannel && (
                  <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {person.view === 'live' && <LivePill />}
                    <span className="truncate">
                      {person.channelName}
                      {person.programme && ` · ${person.programme}`}
                    </span>
                  </p>
                )}
              </div>
              {canJoin ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  aria-label={`Join ${person.displayName}`}
                  onClick={() => {
                    selectChannel(channel)
                    onJoined()
                  }}
                >
                  Join
                </Button>
              ) : (
                <span />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

interface HereNowPopoverProps {
  variant?: HereNowVariant
  className?: string
}

/**
 * Who else is here: a stack of their avatars with 'N here' that opens the
 * Here-now list. Nothing renders while nobody else is here.
 */
export function HereNowPopover({ variant = 'chat', className }: HereNowPopoverProps) {
  const people = useOthersHere()
  const [open, setOpen] = useState(false)
  // The last other person left while it was open: closed, so it doesn't
  // spring open when someone next arrives. (Adjusted while rendering.)
  if (people.length === 0 && open) setOpen(false)
  if (people.length === 0) return null

  const count = `${people.length} here`
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className={cn(TRIGGER_CLASSES[variant], className)}>
          <PresenceStack people={people} max={STACK_MAX[variant]} />
          <span className={cn(variant === 'phone' && 'sr-only')}>{count}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <HereNowList people={people} onJoined={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
