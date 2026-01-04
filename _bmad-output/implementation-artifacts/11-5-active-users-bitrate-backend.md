# Story 11.5: Active Users & Bitrate Backend

Status: review

## Story

As the system,
I want to track connected users, their activity, and stream bitrate usage,
So that admins can monitor who is watching and bandwidth consumption.

## Acceptance Criteria

1. **Given** a user connects via WebSocket, **when** they are authenticated, **then** their presence is tracked: userId, username, view (live/ersatztv), currentChannel, connectedSince, estimatedBitrate
2. **Given** an admin requests active users, **when** GET `/api/admin/active-users` is called, **then** return structured response with liveUsers, ersatztvUsers, and totals including bitrate
3. **Given** a user disconnects, **when** their WebSocket closes, **then** they are removed from the active users list
4. **Given** a user changes channels, **when** the channel updates, **then** their tracked currentChannel and estimatedBitrate update

## Tasks / Subtasks

- [x] Task 1: Create presence service module (AC: #1, #3)
  - [x] Create new file `backend/app/services/presence.py`
  - [x] Define `UserPresence` dataclass with required fields
  - [x] Implement in-memory presence store (dict keyed by connection ID)
  - [x] Implement `track_user()` function for new connections
  - [x] Implement `remove_user()` function for disconnections
  - [x] Add logging for presence changes

- [x] Task 2: Create Pydantic models for API response (AC: #2)
  - [x] Create `ActiveUser` model with camelCase aliases
  - [x] Create `ActiveUsersTotals` model
  - [x] Create `ActiveUsersResponse` model with liveUsers, ersatztvUsers, totals

- [x] Task 3: Implement channel update tracking (AC: #4)
  - [x] Add `update_user_channel()` function in presence service
  - [x] Update estimatedBitrate when channel changes
  - [x] Define bitrate constants (e.g., 8.5 Mbps for Live, 12.0 for ErsatzTV)

- [x] Task 4: Create admin router with active-users endpoint (AC: #2)
  - [x] Create new file `backend/app/routers/admin.py`
  - [x] Add `GET /api/admin/active-users` endpoint
  - [x] Use `require_admin` dependency for auth
  - [x] Return ActiveUsersResponse with computed totals

- [x] Task 5: Integrate presence tracking into WebSocket handler (AC: #1, #3)
  - [x] Modify `backend/app/routers/websocket.py`
  - [x] Call `presence.track_user()` after successful auth
  - [x] Call `presence.remove_user()` on disconnect
  - [x] Pass view type from query parameter (default: 'live')

- [x] Task 6: Register admin router in main.py (AC: #2)
  - [x] Import admin_router
  - [x] Add `app.include_router(admin_router, prefix="/api/admin")`

## Dev Notes

### Architecture Patterns

**Presence Service Design (`backend/app/services/presence.py`):**

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Literal
from fastapi import WebSocket
from loguru import logger

log = logger.bind(service="presence")

# Bitrate estimates (Mbps)
LIVE_BITRATE = 8.5
ERSATZTV_BITRATE = 12.0

@dataclass
class UserPresence:
    connection_id: str
    username: str
    view: Literal["live", "ersatztv"]
    current_channel: str | None = None
    connected_since: datetime = field(default_factory=datetime.utcnow)
    estimated_bitrate: float = 0.0
    websocket: WebSocket | None = None  # For potential future use

# In-memory store keyed by connection_id
_active_users: Dict[str, UserPresence] = {}

def track_user(
    connection_id: str,
    username: str,
    view: Literal["live", "ersatztv"],
    websocket: WebSocket | None = None
) -> UserPresence:
    """Track a new user connection."""
    bitrate = LIVE_BITRATE if view == "live" else ERSATZTV_BITRATE
    presence = UserPresence(
        connection_id=connection_id,
        username=username,
        view=view,
        estimated_bitrate=bitrate,
        websocket=websocket,
    )
    _active_users[connection_id] = presence
    log.info("User {} connected to {} view", username, view)
    return presence

def remove_user(connection_id: str) -> None:
    """Remove user from tracking on disconnect."""
    if connection_id in _active_users:
        user = _active_users.pop(connection_id)
        log.info("User {} disconnected from {} view", user.username, user.view)

def update_user_channel(connection_id: str, channel_name: str | None) -> None:
    """Update user's current channel."""
    if connection_id in _active_users:
        _active_users[connection_id].current_channel = channel_name
        log.debug("User {} now watching: {}", _active_users[connection_id].username, channel_name)

def get_active_users() -> Dict[str, UserPresence]:
    """Get all active users."""
    return _active_users.copy()

def get_users_by_view(view: Literal["live", "ersatztv"]) -> list[UserPresence]:
    """Get users filtered by view type."""
    return [u for u in _active_users.values() if u.view == view]
```

**API Response Models (`backend/app/models/admin.py`):**

```python
from pydantic import BaseModel, Field
from datetime import datetime

class ActiveUser(BaseModel):
    username: str
    channel: str | None = None
    connected_since: datetime = Field(alias="connectedSince")
    bitrate_mbps: float = Field(alias="bitrateMbps")

    model_config = {"populate_by_name": True}

class ActiveUsersTotals(BaseModel):
    live_count: int = Field(alias="liveCount")
    ersatztv_count: int = Field(alias="ersatztvCount")
    live_bitrate_mbps: float = Field(alias="liveBitrateMbps")
    ersatztv_bitrate_mbps: float = Field(alias="ersatztvBitrateMbps")
    total_bitrate_mbps: float = Field(alias="totalBitrateMbps")

    model_config = {"populate_by_name": True}

class ActiveUsersResponse(BaseModel):
    live_users: list[ActiveUser] = Field(alias="liveUsers")
    ersatztv_users: list[ActiveUser] = Field(alias="ersatztvUsers")
    totals: ActiveUsersTotals

    model_config = {"populate_by_name": True}
```

**Admin Router (`backend/app/routers/admin.py`):**

```python
from fastapi import APIRouter, Depends
from loguru import logger

from app.models.admin import ActiveUser, ActiveUsersResponse, ActiveUsersTotals
from app.routers.auth_deps import require_admin, TokenPayload
from app.services import presence

log = logger.bind(router="admin")
router = APIRouter(tags=["admin"])

@router.get("/active-users", response_model=ActiveUsersResponse)
async def get_active_users(
    current_user: TokenPayload = Depends(require_admin),
) -> ActiveUsersResponse:
    """Get all active users with bitrate information."""
    log.debug("Admin {} requesting active users", current_user.sub)

    live_users = presence.get_users_by_view("live")
    ersatztv_users = presence.get_users_by_view("ersatztv")

    live_bitrate = sum(u.estimated_bitrate for u in live_users)
    ersatztv_bitrate = sum(u.estimated_bitrate for u in ersatztv_users)

    return ActiveUsersResponse(
        live_users=[
            ActiveUser(
                username=u.username,
                channel=u.current_channel,
                connected_since=u.connected_since,
                bitrate_mbps=u.estimated_bitrate,
            )
            for u in live_users
        ],
        ersatztv_users=[
            ActiveUser(
                username=u.username,
                channel=u.current_channel,
                connected_since=u.connected_since,
                bitrate_mbps=u.estimated_bitrate,
            )
            for u in ersatztv_users
        ],
        totals=ActiveUsersTotals(
            live_count=len(live_users),
            ersatztv_count=len(ersatztv_users),
            live_bitrate_mbps=live_bitrate,
            ersatztv_bitrate_mbps=ersatztv_bitrate,
            total_bitrate_mbps=live_bitrate + ersatztv_bitrate,
        ),
    )
```

**WebSocket Integration (`backend/app/routers/websocket.py`):**

Modify the existing WebSocket handler to track presence:

```python
# Add to imports
from app.services import presence

# In websocket_endpoint function:
@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    client_id = str(uuid4())[:8]
    view = websocket.query_params.get("view", "live")  # NEW: get view type

    try:
        payload = await verify_websocket_token(token)
        if not payload:
            return

        log.info("WebSocket client {} connected as {}", client_id, payload.sub)

        # Track user presence - NEW
        presence.track_user(
            connection_id=client_id,
            username=payload.sub,
            view=view,
            websocket=websocket,
        )

        await channel_state.connect(websocket)
        # ... rest of handler

    except WebSocketDisconnect:
        log.info("WebSocket client {} disconnected", client_id)
    except Exception as e:
        log.error("WebSocket error for client {}: {}", client_id, e)
    finally:
        presence.remove_user(client_id)  # NEW: remove on disconnect
        channel_state.disconnect(websocket)
```

### API Response Format

```json
{
  "liveUsers": [
    {"username": "viewer1", "channel": "BBC One", "connectedSince": "2026-01-04T10:30:00Z", "bitrateMbps": 8.5}
  ],
  "ersatztvUsers": [
    {"username": "viewer2", "channel": "Action Movies", "connectedSince": "2026-01-04T11:00:00Z", "bitrateMbps": 12.0}
  ],
  "totals": {
    "liveCount": 1,
    "ersatztvCount": 1,
    "liveBitrateMbps": 8.5,
    "ersatztvBitrateMbps": 12.0,
    "totalBitrateMbps": 20.5
  }
}
```

### File Structure

```
backend/app/
├── services/
│   ├── presence.py (NEW)
│   └── channel_state.py (existing)
├── routers/
│   ├── admin.py (NEW)
│   └── websocket.py (modified)
├── models/
│   └── admin.py (NEW)
└── main.py (modified - add router)
```

### Project Structure Notes

- New presence service follows existing service patterns
- Admin router uses existing auth dependency pattern
- Pydantic models follow camelCase alias convention
- Logging uses existing loguru pattern with bound context

### References

- [Source: backend/app/routers/websocket.py:33-101] - WebSocket handler to modify
- [Source: backend/app/services/channel_state.py] - Existing state service pattern
- [Source: backend/app/routers/auth_deps.py:80-100] - require_admin dependency
- [Source: backend/app/models/auth.py] - Pydantic model patterns
- [Source: backend/app/main.py] - Router registration pattern
- [Source: _bmad-output/project-planning-artifacts/sprint-change-proposal-2026-01-04-admin-modal.md#4.6] - API response spec

### Frontend Integration

Frontend will need to pass `view` query parameter when connecting WebSocket:
- Live TV: `ws://host/api/ws?token=xxx&view=live`
- ErsatzTV: `ws://host/api/ws?token=xxx&view=ersatztv`

This is handled in Story 11.6 (frontend) or can be added to existing WebSocket hook.

### Testing Notes

- Test presence tracking on connect/disconnect
- Test view parameter parsing
- Test admin-only endpoint access
- Test totals calculations
- Verify camelCase in JSON response

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

N/A - No debug issues encountered

### Completion Notes List

- Implemented presence service (`backend/app/services/presence.py`) with UserPresence dataclass and tracking functions
- Created Pydantic models (`backend/app/models/admin.py`) with camelCase aliases for JSON serialization
- Implemented admin router (`backend/app/routers/admin.py`) with GET `/api/admin/active-users` endpoint requiring admin role
- Integrated presence tracking into WebSocket handler with `view` query parameter support (default: "live")
- Added comprehensive test coverage: 17 tests for presence service, 7 tests for admin models, 7 tests for admin router, 5 tests for presence tracking in WebSocket
- All 397 backend tests pass with no regressions

### File List

**New Files:**
- backend/app/services/presence.py
- backend/app/models/admin.py
- backend/app/routers/admin.py
- backend/tests/services/test_presence.py
- backend/tests/models/test_admin.py
- backend/tests/routers/test_admin.py

**Modified Files:**
- backend/app/main.py (added admin router import and registration)
- backend/app/routers/websocket.py (added presence import, view parameter, tracking calls)
- backend/tests/routers/test_websocket.py (added presence tracking tests)

## Change Log

- 2026-01-04: Implemented active users and bitrate backend tracking (Story 11.5)
