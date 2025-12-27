# Story 3.1: Channel State Management Backend

Status: review

## Story

As the system,
I want to track the currently selected channel,
So that all viewers can be synchronized.

## Acceptance Criteria

1. **Given** the backend is running
   **When** GET `/api/channels/current` is called with valid JWT
   **Then** return the current channel object or null if none selected

2. **Given** I am logged in as admin
   **When** I PUT `/api/channels/current` with a channel object
   **Then** the channel state updates in memory
   **And** response confirms the update with the channel object

3. **Given** I am logged in as viewer
   **When** I PUT `/api/channels/current`
   **Then** I receive 403 Forbidden

4. **Given** no channel has been selected
   **When** GET `/api/channels/current` is called
   **Then** return `{"currentChannel": null}`

5. **Given** a channel is already selected
   **When** admin selects a different channel
   **Then** the state updates to the new channel

## Tasks / Subtasks

- [x] Task 1: Create Channel State Service (AC: #1, #2, #4, #5)
  - [x] Create `backend/app/services/channel_state.py`
  - [x] Implement in-memory channel state using Python dict
  - [x] Add `get_current_channel()` function returning Channel or None
  - [x] Add `set_current_channel(channel: Channel)` function
  - [x] Add type hints using Pydantic models

- [x] Task 2: Create Channel Models (AC: #1, #2)
  - [x] Create/update `backend/app/models/channel.py`
  - [x] Define `Channel` Pydantic model with camelCase JSON aliases
  - [x] Define `SetChannelRequest` for PUT body validation
  - [x] Define `CurrentChannelResponse` for GET response

- [x] Task 3: Implement GET /api/channels/current (AC: #1, #4)
  - [x] Add endpoint to `backend/app/routers/channels.py`
  - [x] Require JWT authentication via `Depends(verify_token)`
  - [x] Return current channel from state service
  - [x] Return null if no channel selected

- [x] Task 4: Implement PUT /api/channels/current (AC: #2, #3, #5)
  - [x] Add endpoint to `backend/app/routers/channels.py`
  - [x] Require admin role via `Depends(require_admin)`
  - [x] Validate request body using `SetChannelRequest` model
  - [x] Update channel state via service
  - [x] Return updated channel in response

- [x] Task 5: Role-Based Access Control (AC: #3)
  - [x] Create `require_admin` dependency in auth module (already existed in auth_deps.py)
  - [x] Extract role from JWT payload
  - [x] Return 403 if role != "admin"

- [x] Task 6: Testing
  - [x] Test GET returns null when no channel set
  - [x] Test GET returns channel when set
  - [x] Test PUT updates channel (admin)
  - [x] Test PUT returns 403 for viewer role
  - [x] Test PUT validates request body

## Dev Notes

### Architecture Compliance

**Files to create:**
- `backend/app/services/channel_state.py` - In-memory channel state management
- `backend/app/models/channel.py` - Pydantic models (may already exist, extend if needed)

**Files to modify:**
- `backend/app/routers/channels.py` - Add current channel endpoints
- `backend/app/routers/auth.py` - Add `require_admin` dependency

### Channel State Service Pattern

```python
# backend/app/services/channel_state.py
from typing import Optional
from app.models.channel import Channel

# In-memory state - resets on restart (acceptable for MVP)
_current_channel: Optional[Channel] = None

def get_current_channel() -> Optional[Channel]:
    """Get the currently selected channel."""
    return _current_channel

def set_current_channel(channel: Channel) -> Channel:
    """Set the current channel. Returns the set channel."""
    global _current_channel
    _current_channel = channel
    return _current_channel

def clear_current_channel() -> None:
    """Clear the current channel selection."""
    global _current_channel
    _current_channel = None
```

### Pydantic Models with camelCase

```python
# backend/app/models/channel.py
from pydantic import BaseModel, Field
from typing import Optional

class Channel(BaseModel):
    """Channel model matching Dispatcharr lineup format."""
    channel_id: str = Field(..., alias="channelId")
    name: str
    stream_url: str = Field(..., alias="streamUrl")

    class Config:
        populate_by_name = True  # Allow both snake_case and camelCase

class SetChannelRequest(BaseModel):
    """Request body for PUT /api/channels/current."""
    channel_id: str = Field(..., alias="channelId")
    name: str
    stream_url: str = Field(..., alias="streamUrl")

class CurrentChannelResponse(BaseModel):
    """Response for GET /api/channels/current."""
    current_channel: Optional[Channel] = Field(None, alias="currentChannel")

    class Config:
        populate_by_name = True
```

### Router Endpoints

```python
# backend/app/routers/channels.py
from fastapi import APIRouter, Depends, HTTPException, status
from app.models.channel import Channel, SetChannelRequest, CurrentChannelResponse
from app.services import channel_state
from app.routers.auth import verify_token, require_admin

router = APIRouter(prefix="/api/channels", tags=["channels"])

@router.get("/current", response_model=CurrentChannelResponse)
async def get_current_channel(token_payload: dict = Depends(verify_token)):
    """Get the currently selected channel."""
    channel = channel_state.get_current_channel()
    return CurrentChannelResponse(current_channel=channel)

@router.put("/current", response_model=Channel)
async def set_current_channel(
    request: SetChannelRequest,
    token_payload: dict = Depends(require_admin)
):
    """Set the current channel (admin only)."""
    channel = Channel(
        channel_id=request.channel_id,
        name=request.name,
        stream_url=request.stream_url
    )
    return channel_state.set_current_channel(channel)
```

### Admin Role Dependency

```python
# Add to backend/app/routers/auth.py
from fastapi import HTTPException, status

async def require_admin(token_payload: dict = Depends(verify_token)) -> dict:
    """Dependency that requires admin role."""
    if token_payload.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return token_payload
```

### API Response Format

Per architecture document:
```json
// GET /api/channels/current (no channel)
{"currentChannel": null}

// GET /api/channels/current (channel selected)
{"currentChannel": {"channelId": "uuid", "name": "TSN", "streamUrl": "..."}}

// PUT /api/channels/current (request body)
{"channelId": "uuid", "name": "TSN", "streamUrl": "..."}

// PUT /api/channels/current (response)
{"channelId": "uuid", "name": "TSN", "streamUrl": "..."}

// PUT /api/channels/current (viewer attempt)
{"detail": "Admin access required"}
```

### Project Structure Notes

**Alignment with architecture:**
- Uses service layer pattern (channel_state.py in services/)
- Pydantic models with camelCase JSON aliases
- Dependency injection for auth
- In-memory state as specified (resets on restart)

### Dependencies from Previous Stories

- Story 1.2: JWT authentication (`verify_token` dependency)
- Story 2.1: Dispatcharr channel proxy (Channel model may need alignment)

### WebSocket Integration (Prepared for Story 3.2)

The `set_current_channel` function will be extended in Story 3.2 to:
1. Broadcast channel updates to all connected WebSocket clients
2. Store the connection set for broadcasting

For now, just implement the state management. WebSocket broadcasting comes in Story 3.2.

### Anti-Patterns to Avoid

- Do NOT use snake_case in JSON responses (use camelCase aliases)
- Do NOT put business logic in routers (use service layer)
- Do NOT hardcode values (use Pydantic models)
- Do NOT forget role validation (viewers must get 403)

### Testing Strategy

```python
# backend/app/routers/channels_test.py
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_get_current_channel_empty():
    """No channel selected returns null."""
    response = client.get("/api/channels/current", headers={"Authorization": "Bearer <valid_jwt>"})
    assert response.status_code == 200
    assert response.json() == {"currentChannel": None}

def test_set_current_channel_admin():
    """Admin can set channel."""
    channel_data = {"channelId": "uuid", "name": "TSN", "streamUrl": "..."}
    response = client.put("/api/channels/current", json=channel_data, headers={"Authorization": "Bearer <admin_jwt>"})
    assert response.status_code == 200
    assert response.json()["channelId"] == "uuid"

def test_set_current_channel_viewer_forbidden():
    """Viewer gets 403."""
    channel_data = {"channelId": "uuid", "name": "TSN", "streamUrl": "..."}
    response = client.put("/api/channels/current", json=channel_data, headers={"Authorization": "Bearer <viewer_jwt>"})
    assert response.status_code == 403
```

### References

- [Source: _bmad-output/architecture.md#API-Boundaries]
- [Source: _bmad-output/architecture.md#Data-Architecture]
- [Source: _bmad-output/architecture.md#Implementation-Patterns]
- [Source: _bmad-output/epics.md#Story-3.1]
- [Source: _bmad-output/project-context.md#Python/FastAPI-Rules]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation completed without issues.

### Completion Notes List

- Implemented in-memory channel state service with `get_current_channel()`, `set_current_channel()`, and `clear_current_channel()` functions
- Added `SetChannelRequest` and `CurrentChannelResponse` Pydantic models with camelCase JSON aliases
- Implemented GET `/api/channels/current` endpoint requiring JWT authentication
- Implemented PUT `/api/channels/current` endpoint requiring admin role
- Leveraged existing `require_admin` dependency from `auth_deps.py` (Task 5 was already implemented from Epic 1)
- All responses use camelCase JSON formatting per project standards
- Added comprehensive test coverage: 6 service tests, 7 model tests, 17 router tests
- All 78 backend tests pass with no regressions

### Change Log

- 2025-12-26: Implemented Story 3.1 - Channel State Management Backend

### File List

**New Files:**
- `backend/app/services/channel_state_test.py` - Unit tests for channel state service

**Modified Files:**
- `backend/app/services/channel_state.py` - Replaced placeholder with full implementation
- `backend/app/models/channel.py` - Added SetChannelRequest and CurrentChannelResponse models
- `backend/app/models/channel_test.py` - Added tests for new models
- `backend/app/routers/channels.py` - Added GET/PUT /api/channels/current endpoints
- `backend/app/routers/channels_test.py` - Added tests for current channel endpoints
