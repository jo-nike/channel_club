import { PresenceStack } from '@/components/PresenceStack'
import { cn } from '@/lib/utils'
import type { PresenceEntry } from '@/types'

// Avatars on a channel before the rest become '+n'
const STACK_MAX = 3

// The box the stack sits in: 24px tall, a target big enough to click
const STACK_BOX = 'inline-flex shrink-0 items-center rounded-full p-0.5'

/** 'maya', 'maya and dev', or 'maya and 2 others'. */
function presenceNames(people: readonly PresenceEntry[]): string {
  const [first, second] = people
  if (people.length === 1) return first.displayName
  if (people.length === 2) return `${first.displayName} and ${second.displayName}`
  return `${first.displayName} and ${people.length - 1} others`
}

interface ChannelPresenceStackProps {
  // Who else is on the channel (usePresenceByChannel), at least one
  people: PresenceEntry[]
  channelName: string
  // This viewer is on the channel already: the stack only says who's with them
  isWatching: boolean
  onJoin: () => void
  // The row's roving tab stop, where the list has one
  tabIndex?: number
  className?: string
}

/**
 * The avatars of the people on a channel row. Clicking them tunes to the
 * channel ('Join maya and 2 others on Cartoons'). On the channel being
 * watched there's nothing to join, so it only names them ('Watching with
 * maya and 2 others') and does nothing.
 *
 * A sibling of the row's button, since buttons can't nest. Rows that lay it
 * over themselves hold its room with ChannelPresenceSpace.
 */
export function ChannelPresenceStack({
  people,
  channelName,
  isWatching,
  onJoin,
  tabIndex,
  className,
}: ChannelPresenceStackProps) {
  const names = presenceNames(people)
  // One button in both states: the channel becomes the one being watched
  // when Join is pressed, and swapping the focused button for another element
  // would drop keyboard and screen-reader focus to the page. Watching, it's
  // aria-disabled, so it stays focusable and only names them.
  return (
    <button
      type="button"
      onClick={isWatching ? undefined : onJoin}
      tabIndex={tabIndex}
      aria-label={isWatching ? `Watching with ${names}` : `Join ${names} on ${channelName}`}
      aria-disabled={isWatching || undefined}
      data-slot="channel-presence"
      className={cn(STACK_BOX, !isWatching && 'transition-colors hover:bg-accent', className)}
    >
      <PresenceStack people={people} max={STACK_MAX} />
    </button>
  )
}

/**
 * An invisible copy of the stack, the same size, that holds its room inside
 * the row's button while the real one is laid over it.
 */
export function ChannelPresenceSpace({ people, className }: { people: PresenceEntry[]; className?: string }) {
  return (
    <span aria-hidden="true" className={cn(STACK_BOX, 'invisible', className)}>
      <PresenceStack people={people} max={STACK_MAX} />
    </span>
  )
}
