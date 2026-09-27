import { useActiveUsers } from '@/hooks/useActiveUsers'
import { formatDuration } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

function formatLastUpdated(date: Date | null): string {
  if (!date) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.floor(seconds / 60)}m ago`
}

export function ActiveUsersTab() {
  const { data, loading, error, lastUpdated, isRefreshing, refetch } = useActiveUsers()

  if (loading) {
    return <ActiveUsersTabSkeleton />
  }

  if (error) {
    return (
      <div className="p-4 text-center text-destructive">
        Failed to load active users: {error}
      </div>
    )
  }

  if (!data) {
    return null
  }

  return (
    <div className="space-y-6 p-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Active Users</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {formatLastUpdated(lastUpdated)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={refetch}
            disabled={isRefreshing}
            aria-label="Refresh active users"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Live TV section */}
      <UserSection
        title="Live TV"
        users={data.liveUsers}
      />

      {/* ErsatzTV section */}
      <UserSection
        title="ErsatzTV"
        users={data.ersatztvUsers}
      />
    </div>
  )
}

interface Session {
  username: string
  channel: string | null
  programme: string | null
  connectedSince: string
}

interface Person {
  username: string
  sessions: Session[]
}

/** One entry per username (in first-seen order), holding each of their sessions */
function groupByPerson(sessions: Session[]): Person[] {
  const people = new Map<string, Person>()
  for (const session of sessions) {
    const person = people.get(session.username)
    if (person) {
      person.sessions.push(session)
    } else {
      people.set(session.username, { username: session.username, sessions: [session] })
    }
  }
  return [...people.values()]
}

interface UserSectionProps {
  title: string
  users: Session[]
}

function UserSection({ title, users }: UserSectionProps) {
  // The API lists one entry per connection; someone on a phone and a TV is one person
  const people = groupByPerson(users)
  const count = people.length

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-sm text-muted-foreground">
          {count} user{count !== 1 ? 's' : ''}
        </span>
      </div>

      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active users</p>
      ) : (
        <ul className="space-y-2">
          {people.map((person) => (
            <PersonRow key={person.username} person={person} />
          ))}
        </ul>
      )}
    </section>
  )
}

function describeSession(session: Session): string {
  // Build display string: "channel - programme - duration" or "No channel - duration"
  const displayParts = []
  if (session.channel) {
    displayParts.push(session.channel)
    if (session.programme) {
      displayParts.push(session.programme)
    }
  } else {
    displayParts.push('No channel')
  }
  displayParts.push(formatDuration(session.connectedSince))
  return displayParts.join(' • ')
}

function PersonRow({ person }: { person: Person }) {
  const sessionCount = person.sessions.length

  return (
    <li className="flex items-center justify-between rounded-md border p-3 min-h-[56px] gap-2">
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium truncate">{person.username}</span>
          {sessionCount > 1 && (
            <span className="text-xs text-muted-foreground shrink-0">
              {sessionCount} sessions
            </span>
          )}
        </div>
        <ul aria-label={`${person.username}'s sessions`}>
          {person.sessions.map((session, index) => (
            <li
              key={`${session.connectedSince}-${index}`}
              className="text-sm text-muted-foreground truncate"
            >
              {describeSession(session)}
            </li>
          ))}
        </ul>
      </div>
    </li>
  )
}

function ActiveUsersTabSkeleton() {
  return (
    <div className="space-y-6 p-4">
      <Skeleton className="h-20 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  )
}
