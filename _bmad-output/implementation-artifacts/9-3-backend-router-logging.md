# Story 9.3: Backend Router Logging

Status: complete

## Story

As an operator,
I want all API endpoints to log requests,
So that I can monitor traffic and errors.

## Acceptance Criteria

1. **Given** any authenticated endpoint **When** request is processed **Then** log request method and path at DEBUG level **And** log user identity for admin operations at DEBUG level

2. **Given** authentication endpoints **When** login is attempted **Then** log username (not password) at DEBUG level **And** log success with role at INFO level **And** log failure at WARNING level

3. **Given** WebSocket connections **When** client connects or disconnects **Then** log connection state at INFO level **And** log authentication failures at WARNING level

## Tasks / Subtasks

- [x] Task 1: Add logging to auth router (AC: #2)
  - [x] Import loguru logger at module level
  - [x] Log DEBUG: Login attempt with username (never password)
  - [x] Log INFO: Successful login with username and role
  - [x] Log WARNING: Failed login attempts with username
  - [x] Log DEBUG: Auth config requests
  - [x] Log INFO: Plex auth success with username
  - [x] Log WARNING: Plex auth failures
  - [x] Use `logger.bind(router="auth")` for context

- [x] Task 2: Add logging to channels router (AC: #1)
  - [x] Log DEBUG: GET /channels request
  - [x] Log DEBUG: GET /channels/current request
  - [x] Log INFO: PUT /channels/current with channel name and admin user
  - [x] Log WARNING: Unauthorized channel change attempts (in auth_deps.py)
  - [x] Use `logger.bind(router="channels")` for context

- [x] Task 3: Add logging to epg router (AC: #1)
  - [x] Log DEBUG: EPG now-playing requests with channel_id
  - [x] Log DEBUG: EPG response data returned
  - [x] Use `logger.bind(router="epg")` for context

- [x] Task 4: Add logging to ersatztv router (AC: #1)
  - [x] Log DEBUG: All ErsatzTV endpoint requests
  - [x] Log DEBUG: Channel listing requests
  - [x] Log DEBUG: Programme requests with channel_id
  - [x] Log DEBUG: Stream proxy requests
  - [x] Log DEBUG: Segment proxy requests
  - [x] Log ERROR: Stream/segment fetch failures
  - [x] Use `logger.bind(router="ersatztv")` for context

- [x] Task 5: Add logging to websocket router (AC: #3)
  - [x] Log INFO: Client connection with client ID
  - [x] Log INFO: Client disconnection with reason
  - [x] Log WARNING: JWT validation failures
  - [x] Log DEBUG: Ping/pong messages
  - [x] Log ERROR: WebSocket errors
  - [x] Use `logger.bind(router="websocket")` for context

- [~] Task 6: Add request logging middleware (optional enhancement) - SKIPPED
  - [ ] Create middleware to log all requests at DEBUG level
  - [ ] Include request method, path, and response status
  - [ ] Include request duration for performance monitoring
  - [ ] Exclude health check endpoint to reduce noise

## Dev Notes

### Architecture Compliance

- All router files are in `backend/app/routers/`
- Follow existing pattern with `router = APIRouter()`
- Keep logging concise - don't over-log
- Use route-specific context binding

### Library/Framework Requirements

- Use loguru's `logger` directly (import from loguru)
- Use `logger.bind()` for router-specific context
- For WebSocket, log connection lifecycle events
- Reference: Stories 9.1 and 9.2 must be completed first

### File Structure Requirements

```
backend/app/routers/
├── auth.py           # MODIFY
├── channels.py       # MODIFY
├── epg.py            # MODIFY
├── ersatztv.py       # MODIFY
├── websocket.py      # MODIFY
└── auth_deps.py      # MODIFY (if logging in dependency)
```

### Implementation Patterns

**Router Logging Pattern:**
```python
from loguru import logger

log = logger.bind(router="auth")

@router.post("/token")
async def login(form_data: LoginRequest):
    log.debug("Login attempt for user: {}", form_data.username)
    try:
        user = authenticate_user(form_data.username, form_data.password)
        log.info("User {} logged in successfully with role {}", user.username, user.role)
        return create_token(user)
    except InvalidCredentialsError:
        log.warning("Failed login attempt for user: {}", form_data.username)
        raise HTTPException(status_code=401, detail="Invalid credentials")
```

**WebSocket Logging Pattern:**
```python
log = logger.bind(router="websocket")

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    client_id = id(websocket)  # Unique identifier for this connection
    log.info("WebSocket connection attempt from client {}", client_id)

    try:
        user = validate_token(token)
        log.info("Client {} authenticated as user {}", client_id, user.username)
        await websocket.accept()

        # ... handle messages ...

    except InvalidTokenError:
        log.warning("Client {} failed authentication", client_id)
        await websocket.close(code=4001)
    finally:
        log.info("Client {} disconnected", client_id)
```

**Admin Operation Logging:**
```python
@router.put("/current")
async def set_current_channel(
    channel: Channel,
    current_user: User = Depends(require_admin)
):
    log.info(
        "Admin {} changed channel to '{}'",
        current_user.username,
        channel.name
    )
    # ... set channel logic ...
```

### Security Considerations

- **NEVER** log passwords or full tokens
- Log usernames for audit trail
- Log failed attempts for security monitoring
- Use WARNING level for auth failures (aids intrusion detection)

### Request Middleware Pattern (Optional)

```python
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
import time

class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip health checks
        if request.url.path == "/api/health":
            return await call_next(request)

        start = time.perf_counter()
        response = await call_next(request)
        duration = (time.perf_counter() - start) * 1000

        logger.debug(
            "{} {} -> {} ({:.2f}ms)",
            request.method,
            request.url.path,
            response.status_code,
            duration
        )
        return response
```

### Dependencies

- **Depends on:** Story 9.1 (Backend Logging Infrastructure)
- **Depends on:** Story 9.2 (Backend Service Logging) - recommended but not required

### Testing Strategy

- Use pytest fixtures to capture log output
- Test auth failure logging produces WARNING level
- Test admin operations log user identity
- Test WebSocket connection lifecycle logging
- Ensure no sensitive data in logs

### References

- [Source: backend/app/routers/auth.py - current auth router pattern]
- [Source: backend/app/routers/websocket.py - current WebSocket pattern]
- [Source: epics.md#Epic 9 - Story 9.3]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - all tests passed on first run after implementation

### Completion Notes List

- Implemented logging for all 5 routers using loguru with router-specific context binding
- Added 25 new logging tests across all router test files
- All 356 backend tests pass
- Converted ersatztv and websocket routers from standard logging to loguru
- Added auth_deps.py logging for unauthorized access attempts (shared across routers)
- Task 6 (request logging middleware) skipped as it's marked optional

### File List

Modified:
- backend/app/routers/auth.py - Added loguru logging
- backend/app/routers/channels.py - Added loguru logging
- backend/app/routers/epg.py - Added loguru logging
- backend/app/routers/ersatztv.py - Converted from standard logging to loguru
- backend/app/routers/websocket.py - Converted from standard logging to loguru
- backend/app/routers/auth_deps.py - Added loguru logging for require_admin
- backend/tests/routers/test_auth.py - Added TestAuthLogging class
- backend/tests/routers/test_channels.py - Added TestChannelsLogging class
- backend/tests/routers/test_epg.py - Added TestEPGLogging class
- backend/tests/routers/test_ersatztv.py - Added TestErsatzTVLogging class
- backend/tests/routers/test_websocket.py - Added TestWebSocketLogging class
