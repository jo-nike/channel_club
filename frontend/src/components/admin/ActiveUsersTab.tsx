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
      {/* Total bandwidth summary with refresh */}
      <div className="rounded-lg bg-muted p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">
              Total Bandwidth: {data.totals.totalBitrateMbps.toFixed(1)} Mbps
            </div>
            <div className="text-sm text-muted-foreground">
              {data.totals.liveCount + data.totals.ersatztvCount} active users
            </div>
          </div>
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
      </div>

      {/* Live TV section */}
      <UserSection
        title="Live TV"
        users={data.liveUsers}
        count={data.totals.liveCount}
        bitrate={data.totals.liveBitrateMbps}
      />

      {/* ErsatzTV section */}
      <UserSection
        title="ErsatzTV"
        users={data.ersatztvUsers}
        count={data.totals.ersatztvCount}
        bitrate={data.totals.ersatztvBitrateMbps}
      />
    </div>
  )
}

interface UserSectionProps {
  title: string
  users: Array<{
    username: string
    channel: string | null
    programme: string | null
    connectedSince: string
    bitrateMbps: number
  }>
  count: number
  bitrate: number
}

function UserSection({ title, users, count, bitrate }: UserSectionProps) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-sm text-muted-foreground">
          {count} user{count !== 1 ? 's' : ''} • {bitrate.toFixed(1)} Mbps
        </span>
      </div>

      {users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active users</p>
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <UserRow key={`${user.username}-${user.connectedSince}`} user={user} />
          ))}
        </div>
      )}
    </section>
  )
}

interface UserRowProps {
  user: {
    username: string
    channel: string | null
    programme: string | null
    connectedSince: string
    bitrateMbps: number
  }
}

function UserRow({ user }: UserRowProps) {
  // Build display string: "channel - programme - duration" or "No channel - duration"
  const displayParts = []
  if (user.channel) {
    displayParts.push(user.channel)
    if (user.programme) {
      displayParts.push(user.programme)
    }
  } else {
    displayParts.push('No channel')
  }
  displayParts.push(formatDuration(user.connectedSince))

  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="flex flex-col">
        <span className="font-medium">{user.username}</span>
        <span className="text-sm text-muted-foreground">
          {displayParts.join(' - ')}
        </span>
      </div>
      <span className="text-sm font-medium">
        {user.bitrateMbps.toFixed(1)} Mbps
      </span>
    </div>
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
