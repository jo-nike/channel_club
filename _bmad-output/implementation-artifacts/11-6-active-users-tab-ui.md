# Story 11.6: Active Users Tab UI (UPDATED)

Status: review

## Story

As an admin,
I want to see who is currently watching,
So that I can monitor active usage.

## Acceptance Criteria

1. **Given** I open the "Active Users" tab, **when** the tab renders, **then** I see two sections: "Live TV" and "ErsatzTV"
2. **Given** users are connected to Live TV, **when** viewing the Live TV section, **then** I see each user with: username, current channel, duration **and** I see section count: "2 users"
3. **Given** users are connected to ErsatzTV, **when** viewing the ErsatzTV section, **then** I see each user with: username, current channel, duration **and** I see section count
4. **Given** no users are connected to a view, **when** viewing that section, **then** I see "No active users" message

## Tasks / Subtasks

- [x] Task 1: Update useActiveUsers hook to remove bitrate handling (AC: #1, #2, #3, #4)
  - [x] Modify `frontend/src/hooks/useActiveUsers.ts`
  - [x] Remove `bitrateMbps` from `ActiveUser` interface
  - [x] Remove `liveBitrateMbps`, `ersatztvBitrateMbps`, `totalBitrateMbps` from `ActiveUsersTotals` interface
  - [x] Update type to match new backend response

- [x] Task 2: Update ActiveUsersTab component to remove bitrate display (AC: #1, #2, #3)
  - [x] Modify `frontend/src/components/admin/ActiveUsersTab.tsx`
  - [x] Remove total bandwidth summary at top
  - [x] Remove bitrate from section subtotals (show only user count)
  - [x] Remove bitrate from user rows

- [x] Task 3: Update UserRow subcomponent to remove bitrate display (AC: #2, #3)
  - [x] Remove bitrate display from user row
  - [x] Display only: username, current channel, duration

- [x] Task 4: Update backend models to remove bitrate fields (AC: Backend alignment)
  - [x] Modify `backend/app/models/admin.py`
  - [x] Remove `bitrate_mbps` from `ActiveUser` model
  - [x] Remove `live_bitrate_mbps`, `ersatztv_bitrate_mbps`, `total_bitrate_mbps` from `ActiveUsersTotals` model

- [x] Task 5: Update backend admin router response (AC: #2)
  - [x] Modify `backend/app/routers/admin.py`
  - [x] Remove bitrate calculations from get_active_users endpoint
  - [x] Update response to match new simplified format

- [x] Task 6: Update presence service to remove bitrate tracking (AC: Backend cleanup)
  - [x] Modify `backend/app/services/presence.py`
  - [x] Remove `estimated_bitrate` from `UserPresence` dataclass
  - [x] Remove `LIVE_BITRATE` and `ERSATZTV_BITRATE` constants
  - [x] Remove bitrate assignment in `track_user()`

- [x] Task 7: Update tests to reflect bitrate removal (AC: All)
  - [x] Update `frontend/src/hooks/useActiveUsers.test.ts`
  - [x] Update `frontend/src/components/admin/ActiveUsersTab.test.tsx`
  - [x] Update `backend/tests/models/test_admin.py`
  - [x] Update `backend/tests/routers/test_admin.py`
  - [x] Update `backend/tests/services/test_presence.py`

## Dev Notes

### Change Rationale

User requested removal of all bandwidth/bitrate information from Active Users tab as documented in `sprint-change-proposal-2026-01-07.md`. This simplifies the interface while maintaining core functionality of showing who is watching.

### Architecture Patterns

**Updated ActiveUser Interface (Frontend):**

```tsx
interface ActiveUser {
  username: string
  channel: string | null
  connectedSince: string
  // REMOVED: bitrateMbps: number
}
```

**Updated ActiveUsersTotals Interface (Frontend):**

```tsx
interface ActiveUsersTotals {
  liveCount: number
  ersatztvCount: number
  // REMOVED: liveBitrateMbps: number
  // REMOVED: ersatztvBitrateMbps: number
  // REMOVED: totalBitrateMbps: number
}
```

**Updated ActiveUsersData Interface (Frontend):**

```tsx
interface ActiveUsersData {
  liveUsers: ActiveUser[]
  ersatztvUsers: ActiveUser[]
  totals: ActiveUsersTotals
}
```

**Updated UserSection Component:**

```tsx
function UserSection({ title, users, count }: UserSectionProps) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-sm text-muted-foreground">
          {count} user{count !== 1 ? 's' : ''}
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
```

**Updated UserRow Component:**

```tsx
function UserRow({ user }: UserRowProps) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="flex flex-col">
        <span className="font-medium">{user.username}</span>
        <span className="text-sm text-muted-foreground">
          {user.channel || 'No channel'} • {formatDuration(user.connectedSince)}
        </span>
      </div>
      {/* REMOVED: bitrate display */}
    </div>
  )
}
```

**Updated ActiveUsersTab (No Total Summary):**

```tsx
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
      {/* REMOVED: Total bandwidth summary */}

      {/* Live TV section */}
      <UserSection
        title="Live TV"
        users={data.liveUsers}
        count={data.totals.liveCount}
      />

      {/* ErsatzTV section */}
      <UserSection
        title="ErsatzTV"
        users={data.ersatztvUsers}
        count={data.totals.ersatztvCount}
      />
    </div>
  )
}
```

### Backend Model Updates

**Updated ActiveUser Model (`backend/app/models/admin.py`):**

```python
from pydantic import BaseModel, Field
from datetime import datetime

class ActiveUser(BaseModel):
    username: str
    channel: str | None = None
    connected_since: datetime = Field(alias="connectedSince")
    # REMOVED: bitrate_mbps: float = Field(alias="bitrateMbps")

    model_config = {"populate_by_name": True}
```

**Updated ActiveUsersTotals Model:**

```python
class ActiveUsersTotals(BaseModel):
    live_count: int = Field(alias="liveCount")
    ersatztv_count: int = Field(alias="ersatztvCount")
    # REMOVED: live_bitrate_mbps: float = Field(alias="liveBitrateMbps")
    # REMOVED: ersatztv_bitrate_mbps: float = Field(alias="ersatztvBitrateMbps")
    # REMOVED: total_bitrate_mbps: float = Field(alias="totalBitrateMbps")

    model_config = {"populate_by_name": True}
```

**Updated Presence Service (`backend/app/services/presence.py`):**

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Literal
from fastapi import WebSocket
from loguru import logger

log = logger.bind(service="presence")

# REMOVED: LIVE_BITRATE = 8.5
# REMOVED: ERSATZTV_BITRATE = 12.0

@dataclass
class UserPresence:
    connection_id: str
    username: str
    view: Literal["live", "ersatztv"]
    current_channel: str | None = None
    connected_since: datetime = field(default_factory=datetime.utcnow)
    # REMOVED: estimated_bitrate: float = 0.0
    websocket: WebSocket | None = None
```

**Updated Admin Router (`backend/app/routers/admin.py`):**

```python
@router.get("/active-users", response_model=ActiveUsersResponse)
async def get_active_users(
    current_user: TokenPayload = Depends(require_admin),
) -> ActiveUsersResponse:
    """Get all active users."""
    log.debug("Admin {} requesting active users", current_user.sub)

    live_users = presence.get_users_by_view("live")
    ersatztv_users = presence.get_users_by_view("ersatztv")

    # REMOVED: bitrate calculations

    return ActiveUsersResponse(
        live_users=[
            ActiveUser(
                username=u.username,
                channel=u.current_channel,
                connected_since=u.connected_since,
                # REMOVED: bitrate_mbps=u.estimated_bitrate,
            )
            for u in live_users
        ],
        ersatztv_users=[
            ActiveUser(
                username=u.username,
                channel=u.current_channel,
                connected_since=u.connected_since,
                # REMOVED: bitrate_mbps=u.estimated_bitrate,
            )
            for u in ersatztv_users
        ],
        totals=ActiveUsersTotals(
            live_count=len(live_users),
            ersatztv_count=len(ersatztv_users),
            # REMOVED: live_bitrate_mbps=live_bitrate,
            # REMOVED: ersatztv_bitrate_mbps=ersatztv_bitrate,
            # REMOVED: total_bitrate_mbps=live_bitrate + ersatztv_bitrate,
        ),
    )
```

### Updated API Response Format

```json
{
  "liveUsers": [
    {"username": "viewer1", "channel": "BBC One", "connectedSince": "2026-01-04T10:30:00Z"}
  ],
  "ersatztvUsers": [
    {"username": "viewer2", "channel": "Action Movies", "connectedSince": "2026-01-04T11:00:00Z"}
  ],
  "totals": {
    "liveCount": 1,
    "ersatztvCount": 1
  }
}
```

### File Structure (Modified Files Only)

```
frontend/src/
├── hooks/
│   ├── useActiveUsers.ts (MODIFIED - remove bitrate types)
│   └── useActiveUsers.test.ts (MODIFIED - update tests)
├── components/
│   ├── admin/
│   │   ├── ActiveUsersTab.tsx (MODIFIED - remove bitrate display)
│   │   └── ActiveUsersTab.test.tsx (MODIFIED - update tests)
│   └── AdminModal.tsx (no changes needed)
└── lib/
    └── utils.ts (no changes needed - formatDuration stays)

backend/
├── app/
│   ├── models/
│   │   └── admin.py (MODIFIED - remove bitrate fields)
│   ├── routers/
│   │   └── admin.py (MODIFIED - remove bitrate calculations)
│   └── services/
│       └── presence.py (MODIFIED - remove bitrate tracking)
└── tests/
    ├── models/
    │   └── test_admin.py (MODIFIED - update tests)
    ├── routers/
    │   └── test_admin.py (MODIFIED - update tests)
    └── services/
        └── test_presence.py (MODIFIED - update tests)
```

### Project Structure Notes

- This is a modification story updating existing code to remove bandwidth/bitrate functionality
- No new files are being created
- The `formatDuration` utility in `utils.ts` remains unchanged
- The WebSocket hook view parameter added in original 11.6 remains unchanged

### References

- [Source: _bmad-output/project-planning-artifacts/sprint-change-proposal-2026-01-07.md#4.1] - Change rationale
- [Source: _bmad-output/architecture.md#2026-01-07] - Updated API response format
- [Source: frontend/src/hooks/useActiveUsers.ts] - Hook to modify
- [Source: frontend/src/components/admin/ActiveUsersTab.tsx] - Component to modify
- [Source: backend/app/models/admin.py] - Model to modify
- [Source: backend/app/routers/admin.py] - Router to modify
- [Source: backend/app/services/presence.py] - Service to modify

### Previous Story Dependencies

- **Story 11.1** - AdminModal must exist
- **Story 11.5** - Backend presence tracking (being modified)

### Testing Notes

- Verify polling works correctly (5 second interval)
- Verify auth token is passed
- Verify empty state displays correctly
- Verify duration formatting works
- Test with multiple users in each section
- Verify NO bitrate/bandwidth info is displayed anywhere
- Verify totals only show user counts

### Git Analysis

Recent commits show highlight feature work and admin panel fixes. This story aligns with the polish and bug fix theme of Epic 12 extensions.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A

### Completion Notes List

- Removed all bitrate/bandwidth tracking from frontend and backend
- Updated `ActiveUser` and `ActiveUsersTotals` interfaces to remove bitrate fields
- Simplified `ActiveUsersTab` UI to show only user counts (no bandwidth summary)
- Updated `UserRow` to display: username, channel, programme, duration (no bitrate)
- Removed `LIVE_BITRATE` and `ERSATZTV_BITRATE` constants from presence service
- Removed `estimated_bitrate` field from `UserPresence` dataclass
- All 704 frontend tests pass
- All 438 backend tests pass

### File List

**Frontend (Modified):**
- frontend/src/hooks/useActiveUsers.ts
- frontend/src/hooks/useActiveUsers.test.ts
- frontend/src/components/admin/ActiveUsersTab.tsx
- frontend/src/components/admin/ActiveUsersTab.test.tsx
- frontend/src/components/AdminModal.test.tsx

**Backend (Modified):**
- backend/app/models/admin.py
- backend/app/routers/admin.py
- backend/app/services/presence.py
- backend/tests/models/test_admin.py
- backend/tests/routers/test_admin.py
- backend/tests/routers/test_websocket.py
- backend/tests/services/test_presence.py

## Change Log

- 2026-01-07: Removed all bandwidth/bitrate display from Active Users tab per sprint-change-proposal-2026-01-07.md

