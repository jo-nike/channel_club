import { Crown } from 'lucide-react'
import { MemberAvatar } from '@/components/MemberAvatar'
import type { PlexMember } from '@/types/setup'
import { Chip } from './Chip'

interface PeopleAdminListProps {
  members: readonly PlexMember[]
  /** The Plex ids ticked as admins */
  adminIds: readonly string[]
  onChange: (adminIds: string[]) => void
  /** The id of the text that names the list */
  labelledBy: string
  /** The Plex id of the admin at the screen, marked You */
  selfId?: string | null
}

/**
 * A Plex server's members with an Admin tick for each. The owner is always an
 * admin, so has no tick. Ticks keep ids that aren't listed (someone who left
 * the server) as they were.
 */
export function PeopleAdminList({ members, adminIds, onChange, labelledBy, selfId }: PeopleAdminListProps) {
  const toggle = (plexId: string, admin: boolean) =>
    onChange(admin ? [...adminIds.filter((id) => id !== plexId), plexId] : adminIds.filter((id) => id !== plexId))

  return (
    <ul aria-labelledby={labelledBy} className="m-0 flex list-none flex-col overflow-hidden rounded-xl border bg-card p-0">
      {members.map((member) => {
        const facts = [member.plexId === selfId && 'You', member.owner && 'server owner', member.managed && 'managed user']
          .filter((fact): fact is string => Boolean(fact))
          .join(' · ')
        return (
          <li key={member.plexId} className="flex min-h-14 items-center gap-3 border-t px-3.5 py-2.5 first:border-t-0">
            <MemberAvatar username={member.username} userId={member.plexId} decorative className="size-8 text-[13px]" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate font-semibold">{member.username}</p>
              {facts && <p className="text-[13px] text-muted-foreground">{facts.charAt(0).toUpperCase() + facts.slice(1)}</p>}
            </div>
            {member.owner ? (
              <Chip tone="primary">
                <Crown aria-hidden="true" />
                Always admin
              </Chip>
            ) : (
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 px-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={adminIds.includes(member.plexId)}
                  onChange={(event) => toggle(member.plexId, event.target.checked)}
                  className="m-0 size-[18px] accent-primary"
                />
                Admin{' '}<span className="sr-only">for {member.username}</span>
              </label>
            )}
          </li>
        )
      })}
    </ul>
  )
}
