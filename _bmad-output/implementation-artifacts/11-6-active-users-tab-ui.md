# Story 11.6: Active Users Tab UI

Status: ready-for-dev

## Story

As an admin,
I want to see who is currently watching and their bandwidth usage,
So that I can monitor usage and resource consumption.

## Acceptance Criteria

1. **Given** I open the "Active Users" tab, **when** the tab renders, **then** I see two sections: "Live TV" and "ErsatzTV" **and** I see total bandwidth summary at the top
2. **Given** users are connected to Live TV, **when** viewing the Live TV section, **then** I see each user with: username, current channel, duration, bitrate (e.g., "8.5 Mbps") **and** I see section subtotal: "2 users • 17.0 Mbps"
3. **Given** users are connected to ErsatzTV, **when** viewing the ErsatzTV section, **then** I see each user with: username, current channel, duration, bitrate **and** I see section subtotal
4. **Given** no users are connected to a view, **when** viewing that section, **then** I see "No active users" message

## Tasks / Subtasks

- [ ] Task 1: Create useActiveUsers hook (AC: #1, #2, #3, #4)
  - [ ] Create new file `frontend/src/hooks/useActiveUsers.ts`
  - [ ] Implement polling fetch to `/api/admin/active-users`
  - [ ] Add loading and error states
  - [ ] Implement refresh interval (5 seconds)
  - [ ] Use auth token for authenticated request

- [ ] Task 2: Create formatDuration utility (AC: #2, #3)
  - [ ] Add function to `frontend/src/lib/utils.ts` or create separate utils file
  - [ ] Convert connectedSince timestamp to duration string
  - [ ] Format: "2h 15m", "45m", "5m" etc.

- [ ] Task 3: Create ActiveUsersTab component (AC: #1, #2, #3, #4)
  - [ ] Create new file `frontend/src/components/admin/ActiveUsersTab.tsx`
  - [ ] Display total bandwidth summary at top
  - [ ] Create Live TV section with user list
  - [ ] Create ErsatzTV section with user list
  - [ ] Display per-section subtotals
  - [ ] Handle empty states for each section
  - [ ] Handle loading and error states

- [ ] Task 4: Create UserRow subcomponent (AC: #2, #3)
  - [ ] Display username
  - [ ] Display current channel (or "No channel")
  - [ ] Display formatted duration
  - [ ] Display bitrate with "Mbps" suffix

- [ ] Task 5: Integrate into AdminModal (AC: #1)
  - [ ] Import ActiveUsersTab into AdminModal
  - [ ] Render when "active-users" tab is active
  - [ ] Ensure proper scrolling for long user lists

- [ ] Task 6: Update WebSocket hook to pass view parameter (AC: Backend integration)
  - [ ] Modify useWebSocket hook to accept view parameter
  - [ ] MainView: pass view="live"
  - [ ] ErsatzTVView: pass view="ersatztv"

## Dev Notes

### Architecture Patterns

**useActiveUsers Hook (`frontend/src/hooks/useActiveUsers.ts`):**

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'

interface ActiveUser {
  username: string
  channel: string | null
  connectedSince: string
  bitrateMbps: number
}

interface ActiveUsersTotals {
  liveCount: number
  ersatztvCount: number
  liveBitrateMbps: number
  ersatztvBitrateMbps: number
  totalBitrateMbps: number
}

interface ActiveUsersData {
  liveUsers: ActiveUser[]
  ersatztvUsers: ActiveUser[]
  totals: ActiveUsersTotals
}

const POLL_INTERVAL = 5000 // 5 seconds

export function useActiveUsers() {
  const [data, setData] = useState<ActiveUsersData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { token } = useAuth()

  const fetchUsers = useCallback(async () => {
    if (!token) return

    try {
      const response = await fetch('/api/admin/active-users', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`)
      }

      const data = await response.json()
      setData(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchUsers()
    const interval = setInterval(fetchUsers, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchUsers])

  return { data, loading, error, refetch: fetchUsers }
}
```

**formatDuration Utility:**

```tsx
// Add to frontend/src/lib/utils.ts

export function formatDuration(isoDate: string): string {
  const start = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - start.getTime()

  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`
  }
  return `${minutes}m`
}
```

**ActiveUsersTab Component (`frontend/src/components/admin/ActiveUsersTab.tsx`):**

```tsx
import { useActiveUsers } from '@/hooks/useActiveUsers'
import { formatDuration } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

export function ActiveUsersTab() {
  const { data, loading, error } = useActiveUsers()

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
      {/* Total bandwidth summary */}
      <div className="rounded-lg bg-muted p-4">
        <div className="text-lg font-semibold">
          Total Bandwidth: {data.totals.totalBitrateMbps.toFixed(1)} Mbps
        </div>
        <div className="text-sm text-muted-foreground">
          {data.totals.liveCount + data.totals.ersatztvCount} active users
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
    connectedSince: string
    bitrateMbps: number
  }
}

function UserRow({ user }: UserRowProps) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="flex flex-col">
        <span className="font-medium">{user.username}</span>
        <span className="text-sm text-muted-foreground">
          {user.channel || 'No channel'} • {formatDuration(user.connectedSince)}
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
```

### WebSocket View Parameter

Modify existing WebSocket hooks to pass view type:

**MainView.tsx:**
```tsx
const { status, reconnect } = useWebSocket({ view: 'live' })
```

**ErsatzTVView.tsx:**
```tsx
// Note: ErsatzTV may not use WebSocket currently
// If it does, add: const { status } = useWebSocket({ view: 'ersatztv' })
```

**useWebSocket.ts modification:**
```tsx
interface UseWebSocketOptions {
  view?: 'live' | 'ersatztv'
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { view = 'live' } = options
  // ...
  const wsUrl = `${WS_BASE_URL}/api/ws?token=${token}&view=${view}`
  // ...
}
```

### File Structure

```
frontend/src/
├── hooks/
│   ├── useActiveUsers.ts (NEW)
│   └── useWebSocket.ts (modified)
├── components/
│   ├── admin/
│   │   └── ActiveUsersTab.tsx (NEW)
│   └── AdminModal.tsx (modified)
└── lib/
    └── utils.ts (modified - add formatDuration)
```

### Project Structure Notes

- New components in `admin/` subdirectory for organization
- Hook follows existing hook patterns
- Uses existing Skeleton component for loading states
- formatDuration added to existing utils file

### References

- [Source: frontend/src/hooks/useAuth.ts] - Auth hook pattern
- [Source: frontend/src/components/ui/skeleton.tsx] - Skeleton component
- [Source: frontend/src/lib/utils.ts] - Utility functions location
- [Source: frontend/src/hooks/useWebSocket.ts] - WebSocket hook to modify
- [Source: _bmad-output/project-planning-artifacts/sprint-change-proposal-2026-01-04-admin-modal.md] - API response format

### Previous Story Dependencies

- **Story 11.1** - AdminModal must exist to integrate tab
- **Story 11.5** - Backend endpoint must exist for data fetching

### Testing Notes

- Verify polling works correctly (5 second interval)
- Verify auth token is passed
- Verify empty state displays correctly
- Verify duration formatting works
- Test with multiple users in each section
- Verify totals calculation matches backend

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
