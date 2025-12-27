# Story 3.2: WebSocket Server Infrastructure

Status: review

## Story

As the system,
I want to maintain WebSocket connections with all clients,
So that I can broadcast channel updates in real-time.

## Acceptance Criteria

1. **Given** a client connects to WS `/api/ws?token=<jwt>`
   **When** the connection is established
   **Then** the server validates the JWT
   **And** adds the connection to the active connections set
   **And** sends `{"type": "connection_ack", "currentChannel": <channel|null>}`

2. **Given** a client's JWT is invalid or expired
   **When** they attempt to connect
   **Then** the WebSocket connection is rejected with close code 4001

3. **Given** an admin changes the channel via PUT `/api/channels/current`
   **When** the state updates
   **Then** broadcast `{"type": "channel_update", "channel": {...}}` to all connected clients

4. **Given** a client disconnects
   **When** the connection closes
   **Then** remove the connection from the active connections set

5. **Given** a client sends `{"type": "ping"}`
   **When** the message is received
   **Then** respond with `{"type": "pong"}`

## Tasks / Subtasks

- [x] Task 1: Create WebSocket Router (AC: #1, #2, #4)
  - [x] Create `backend/app/routers/websocket.py`
  - [x] Implement WebSocket endpoint at `/api/ws`
  - [x] Extract JWT from query parameter `token`
  - [x] Validate JWT using existing `verify_token` logic
  - [x] Reject invalid tokens with close code 4001
  - [x] Add valid connections to connection manager

- [x] Task 2: Create Connection Manager (AC: #1, #3, #4)
  - [x] Create connection manager in `backend/app/services/channel_state.py`
  - [x] Maintain set of active WebSocket connections
  - [x] Implement `connect(websocket)` to add connection
  - [x] Implement `disconnect(websocket)` to remove connection
  - [x] Implement `broadcast(message)` to send to all clients

- [x] Task 3: Implement connection_ack Message (AC: #1)
  - [x] Send connection_ack on successful connection
  - [x] Include current channel (or null) in message
  - [x] Use camelCase for JSON keys

- [x] Task 4: Integrate Broadcast with Channel Update (AC: #3)
  - [x] Modify `set_current_channel` to trigger broadcast
  - [x] Create `channel_update` message format
  - [x] Broadcast to all connected clients asynchronously

- [x] Task 5: Handle Client Messages (AC: #5)
  - [x] Listen for incoming messages
  - [x] Parse JSON messages
  - [x] Handle `ping` type with `pong` response
  - [x] Log unknown message types

- [x] Task 6: Testing
  - [x] Test WebSocket connection with valid token
  - [x] Test WebSocket rejection with invalid token
  - [x] Test connection_ack message received
  - [x] Test broadcast when channel changes
  - [x] Test ping/pong functionality
  - [x] Test disconnection cleanup

## Dev Notes

### Architecture Compliance

**Files to create:**
- `backend/app/routers/websocket.py` - WebSocket endpoint

**Files to modify:**
- `backend/app/services/channel_state.py` - Add connection manager
- `backend/app/main.py` - Register WebSocket router

### Connection Manager Pattern

```python
# backend/app/services/channel_state.py
from typing import Optional, Set
from fastapi import WebSocket
import asyncio
import json
from app.models.channel import Channel

# In-memory state
_current_channel: Optional[Channel] = None
_active_connections: Set[WebSocket] = set()

def get_current_channel() -> Optional[Channel]:
    return _current_channel

async def set_current_channel(channel: Channel) -> Channel:
    """Set channel and broadcast to all clients."""
    global _current_channel
    _current_channel = channel

    # Broadcast to all connected clients
    await broadcast_channel_update(channel)

    return _current_channel

async def connect(websocket: WebSocket) -> None:
    """Accept and track a WebSocket connection."""
    await websocket.accept()
    _active_connections.add(websocket)

def disconnect(websocket: WebSocket) -> None:
    """Remove a WebSocket connection from tracking."""
    _active_connections.discard(websocket)

async def broadcast_channel_update(channel: Channel) -> None:
    """Broadcast channel update to all connected clients."""
    message = {
        "type": "channel_update",
        "channel": channel.model_dump(by_alias=True)
    }
    await broadcast(message)

async def broadcast(message: dict) -> None:
    """Send message to all connected clients."""
    if not _active_connections:
        return

    message_text = json.dumps(message)

    # Send to all clients concurrently, handling disconnections
    disconnected = set()
    for connection in _active_connections:
        try:
            await connection.send_text(message_text)
        except Exception:
            disconnected.add(connection)

    # Clean up disconnected clients
    for conn in disconnected:
        _active_connections.discard(conn)

def get_connection_count() -> int:
    """Get count of active connections (for monitoring)."""
    return len(_active_connections)
```

### WebSocket Router

```python
# backend/app/routers/websocket.py
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from jose import jwt, JWTError
import json
from app.config import settings
from app.services import channel_state

router = APIRouter()

async def verify_websocket_token(token: str) -> dict:
    """Verify JWT token for WebSocket connection."""
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"]
        )
        return payload
    except JWTError:
        return None

@router.websocket("/api/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...)
):
    """WebSocket endpoint for real-time channel updates."""

    # Validate token before accepting connection
    payload = await verify_websocket_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid token")
        return

    # Accept connection and track it
    await channel_state.connect(websocket)

    try:
        # Send connection acknowledgment with current channel
        current = channel_state.get_current_channel()
        ack_message = {
            "type": "connection_ack",
            "currentChannel": current.model_dump(by_alias=True) if current else None
        }
        await websocket.send_json(ack_message)

        # Listen for client messages
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                await handle_client_message(websocket, message)
            except json.JSONDecodeError:
                pass  # Ignore malformed messages

    except WebSocketDisconnect:
        channel_state.disconnect(websocket)
    except Exception:
        channel_state.disconnect(websocket)

async def handle_client_message(websocket: WebSocket, message: dict) -> None:
    """Handle incoming client messages."""
    msg_type = message.get("type")

    if msg_type == "ping":
        await websocket.send_json({"type": "pong"})
    else:
        # Log unknown message types for debugging
        print(f"Unknown WebSocket message type: {msg_type}")
```

### Register Router in main.py

```python
# backend/app/main.py
from app.routers import auth, channels, websocket

app = FastAPI()

# ... existing setup ...

# Register routers
app.include_router(auth.router)
app.include_router(channels.router)
app.include_router(websocket.router)  # Add this line
```

### Update Channel Router for Broadcast

The PUT endpoint needs to be async now to support broadcasting:

```python
# backend/app/routers/channels.py
@router.put("/current", response_model=Channel)
async def set_current_channel(
    request: SetChannelRequest,
    token_payload: dict = Depends(require_admin)
):
    """Set the current channel (admin only). Broadcasts to all WebSocket clients."""
    channel = Channel(
        channel_id=request.channel_id,
        name=request.name,
        stream_url=request.stream_url
    )
    # This now broadcasts to all connected clients
    return await channel_state.set_current_channel(channel)
```

### WebSocket Message Types

Per architecture document:

| Direction | Type | Payload |
|-----------|------|---------|
| Server → Client | `connection_ack` | `{"type": "connection_ack", "currentChannel": {...} \| null}` |
| Server → Client | `channel_update` | `{"type": "channel_update", "channel": {...}}` |
| Client → Server | `ping` | `{"type": "ping"}` |
| Server → Client | `pong` | `{"type": "pong"}` |

### Project Structure Notes

**Alignment with architecture:**
- WebSocket at `/api/ws` with JWT query param
- JSON message format with camelCase
- In-memory connection tracking
- Broadcast on channel change

### Error Handling

**Connection Errors:**
- Invalid token: Close with code 4001
- Connection lost: Clean up from set
- Send errors: Remove from set, don't crash others

**WebSocket Close Codes:**
- 4001: Authentication failed
- 4000: General client error
- 1000: Normal closure

### Async Considerations

```python
# The broadcast function must handle concurrent sends safely
# Use asyncio.gather for parallel sends:

async def broadcast(message: dict) -> None:
    if not _active_connections:
        return

    message_text = json.dumps(message)

    async def send_safe(ws: WebSocket):
        try:
            await ws.send_text(message_text)
            return ws, True
        except Exception:
            return ws, False

    results = await asyncio.gather(
        *[send_safe(ws) for ws in _active_connections],
        return_exceptions=True
    )

    # Remove failed connections
    for result in results:
        if isinstance(result, tuple) and not result[1]:
            _active_connections.discard(result[0])
```

### Security Considerations

- JWT validated before connection accepted
- Token passed via query param (WebSocket limitation)
- No sensitive data in broadcast messages
- Connection cleanup on disconnect

### Performance Considerations

- Use set for O(1) connection lookup
- Parallel broadcast with asyncio.gather
- Don't block on failed sends
- Clean up stale connections proactively

### Testing Strategy

```python
# backend/app/routers/websocket_test.py
import pytest
from fastapi.testclient import TestClient
from app.main import app

def test_websocket_valid_token():
    """Valid token accepts connection and sends ack."""
    client = TestClient(app)
    with client.websocket_connect("/api/ws?token=valid_jwt") as ws:
        data = ws.receive_json()
        assert data["type"] == "connection_ack"
        assert "currentChannel" in data

def test_websocket_invalid_token():
    """Invalid token rejects connection."""
    client = TestClient(app)
    with pytest.raises(Exception):  # WebSocketDisconnect
        with client.websocket_connect("/api/ws?token=invalid"):
            pass

def test_websocket_ping_pong():
    """Ping receives pong response."""
    client = TestClient(app)
    with client.websocket_connect("/api/ws?token=valid_jwt") as ws:
        ws.receive_json()  # Consume ack
        ws.send_json({"type": "ping"})
        data = ws.receive_json()
        assert data["type"] == "pong"
```

### Anti-Patterns to Avoid

- Do NOT accept connection before validating token
- Do NOT block other connections on send failure
- Do NOT use sync functions in async context
- Do NOT forget to clean up disconnected clients
- Do NOT crash the server on client errors

### References

- [Source: _bmad-output/architecture.md#WebSocket-Message-Types]
- [Source: _bmad-output/architecture.md#API-Boundaries]
- [Source: _bmad-output/architecture.md#Real-time-Sync]
- [Source: _bmad-output/epics.md#Story-3.2]
- [Source: _bmad-output/project-context.md#Python/FastAPI-Rules]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None

### Completion Notes List

- Implemented WebSocket router at `/api/ws` with JWT authentication via query parameter
- Created connection manager in `channel_state.py` with `connect()`, `disconnect()`, `broadcast()` functions
- Added `connection_ack` message sent on connection with current channel state
- Modified `set_current_channel` to be async and broadcast updates to all connected clients
- Implemented ping/pong heartbeat handling for client messages
- Used `asyncio.gather` for parallel broadcast with safe error handling
- All tests passing (93 total), including 12 new WebSocket-specific tests

### File List

- `backend/app/routers/websocket.py` (created) - WebSocket endpoint with JWT validation
- `backend/app/routers/websocket_test.py` (created) - Comprehensive WebSocket tests
- `backend/app/services/channel_state.py` (modified) - Added connection manager and async broadcast
- `backend/app/services/channel_state_test.py` (modified) - Added async tests and connection management tests
- `backend/app/routers/channels.py` (modified) - Updated to use async `set_current_channel`
- `backend/app/routers/channels_test.py` (modified) - Updated for async compatibility
- `backend/app/main.py` (modified) - Registered WebSocket router

## Change Log

- 2025-12-26: Implemented WebSocket server infrastructure (Story 3.2)
