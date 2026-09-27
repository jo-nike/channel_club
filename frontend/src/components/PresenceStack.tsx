import { MemberAvatar } from '@/components/MemberAvatar'
import { cn } from '@/lib/utils'
import type { PresenceEntry } from '@/types'

interface PresenceStackProps {
  people: PresenceEntry[]
  // Avatars drawn before the rest become '+n'
  max?: number
  className?: string
}

/**
 * Overlapping 20px avatars for the first few people, then '+n' for the
 * rest. Decorative: whatever holds it names the people (a 'N here' button).
 */
export function PresenceStack({ people, max = 4, className }: PresenceStackProps) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  return (
    <span aria-hidden="true" data-slot="presence-stack" className={cn('flex items-center', className)}>
      {shown.map((person, index) => (
        <MemberAvatar
          key={person.userId ?? `${index}:${person.displayName}`}
          username={person.displayName}
          userId={person.userId ?? undefined}
          size="sm"
          decorative
          // A ring in the surface colour parts each disc from the one under it
          className={cn('ring-2 ring-background', index > 0 && '-ml-1.5')}
        />
      ))}
      {rest > 0 && (
        <span
          data-slot="presence-more"
          className="-ml-1.5 inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 bg-muted text-[11px] font-bold leading-none text-muted-foreground ring-2 ring-background"
        >
          +{rest}
        </span>
      )}
    </span>
  )
}
