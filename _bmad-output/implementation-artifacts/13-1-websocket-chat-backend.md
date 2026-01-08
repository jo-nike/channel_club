# Story 13.1: WebSocket Chat Backend

Status: ready-for-dev

## Story

As the system,
I want to handle chat messages via WebSocket,
so that users can communicate in real-time while watching.

## Acceptance Criteria

1. **Given** `CHAT_ENABLED=true` in environment
   **When** a user connects via WebSocket
   **Then** they can send and receive chat messages

2. **Given** `CHAT_ENABLED=false` or not set
   **When** a user connects via WebSocket
   **Then** chat functionality is disabled (no chat messages processed)

3. **Given** a user sends a chat message
   **When** the message is received by the server
   **Then** it is broadcast to all connected users
   **And** the message includes: username, content, timestamp, messageId

4. **Given** a user connects to WebSocket
   **When** connection is established
   **Then** they receive the last 50 chat messages (chat history)

5. **Given** a chat message is received
   **When** it is processed
   **Then** basic sanitization is applied (strip HTML, limit length to 500 chars)

## Tasks / Subtasks

- [ ] Task 1: Add CHAT_ENABLED environment variable (AC: #1, #2)
  - [ ] Add `CHAT_ENABLED` to `backend/app/config.py` with default `false`
  - [ ] Add to `.env.example` files (root, backend)
  - [ ] Document in architecture.md under environment variables

- [ ] Task 2: Create chat service with circular buffer (AC: #3, #4)
  - [ ] Create `backend/app/services/chat.py`
  - [ ] Implement `ChatMessage` dataclass with: messageId, username, content, timestamp
  - [ ] Implement circular buffer (100 messages max in-memory)
  - [ ] Implement `add_message(username, content) -> ChatMessage`
  - [ ] Implement `get_history(limit=50) -> list[ChatMessage]`
  - [ ] Add proper type annotations per project standards

- [ ] Task 3: Implement message sanitization (AC: #5)
  - [ ] Strip HTML tags from content using `html.escape()` or regex
  - [ ] Limit message length to 500 characters
  - [ ] Reject empty messages after sanitization
  - [ ] Log sanitization at DEBUG level

- [ ] Task 4: Extend WebSocket handler for chat (AC: #1, #2, #3)
  - [ ] In `backend/app/routers/websocket.py`, add chat message handler
  - [ ] Handle `{"type": "chat_message", "content": "..."}` messages
  - [ ] Only process if `settings.chat_enabled` is `True`
  - [ ] Broadcast to all via `channel_state.broadcast()`
  - [ ] Return early with no action if chat disabled

- [ ] Task 5: Send chat history on connect (AC: #4)
  - [ ] After `connection_ack`, send `{"type": "chat_history", "messages": [...]}`
  - [ ] Only if `settings.chat_enabled` is `True`
  - [ ] Limit to last 50 messages

- [ ] Task 6: Add tests (AC: #1-5)
  - [ ] Test chat message broadcast when enabled
  - [ ] Test chat disabled ignores messages
  - [ ] Test message sanitization (HTML, length)
  - [ ] Test chat history on connect
  - [ ] Test circular buffer behavior

## Dev Notes

### WebSocket Message Types (New)

```python
# Client -> Server
{"type": "chat_message", "content": "Hello everyone!"}

# Server -> Client (individual message)
{
    "type": "chat_message",
    "messageId": "uuid-string",
    "username": "Jon",
    "content": "Hello everyone!",
    "timestamp": "2026-01-07T15:30:00Z"
}

# Server -> Client (history on connect)
{
    "type": "chat_history",
    "messages": [
        {"messageId": "...", "username": "...", "content": "...", "timestamp": "..."},
        ...
    ]
}
```

### Chat Service Pattern

Follow existing service patterns from `presence.py` and `channel_state.py`:

```python
# backend/app/services/chat.py
from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import uuid4

@dataclass
class ChatMessage:
    message_id: str
    username: str
    content: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict:
        return {
            "messageId": self.message_id,
            "username": self.username,
            "content": self.content,
            "timestamp": self.timestamp.isoformat(),
        }

# Circular buffer - max 100 messages
_chat_history: deque[ChatMessage] = deque(maxlen=100)
```

### Environment Variable

Add to `backend/app/config.py`:

```python
chat_enabled: bool = Field(default=False, description="Enable chat feature")
```

### Integration with Existing WebSocket

The current `websocket.py` already handles:
- Token authentication via `verify_websocket_token()`
- Client message routing via `handle_client_message()`
- Broadcast via `channel_state.broadcast()`

Add new message type handler:

```python
elif msg_type == "chat_message":
    if not settings.chat_enabled:
        log.debug("Chat message ignored - chat disabled")
        return
    content = message.get("content", "")
    # Sanitize and broadcast
```

### Sanitization Rules

1. Strip HTML using `html.escape()` (simpler than regex, handles edge cases)
2. Trim whitespace
3. Limit to 500 characters (truncate, don't reject)
4. Reject if empty after sanitization

### Project Structure Notes

- File location: `backend/app/services/chat.py`
- Test location: `backend/tests/services/test_chat.py`
- Config update: `backend/app/config.py`
- Router update: `backend/app/routers/websocket.py`

### References

- [Source: _bmad-output/architecture.md#WebSocket Message Types]
- [Source: _bmad-output/architecture.md#2026-01-07: Epic 12 Extensions & Epic 13]
- [Source: backend/app/services/presence.py] - Pattern for in-memory service
- [Source: backend/app/services/channel_state.py] - Broadcast pattern
- [Source: backend/app/routers/websocket.py] - Message handling pattern

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
