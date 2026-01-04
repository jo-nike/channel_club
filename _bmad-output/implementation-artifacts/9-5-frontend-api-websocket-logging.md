# Story 9.5: Frontend API & WebSocket Logging

Status: review

## Story

As a developer,
I want API calls and WebSocket events logged,
So that I can trace communication issues.

## Acceptance Criteria

1. **Given** any API call via `fetchWithAuth` **When** the call is made **Then** log endpoint at DEBUG level **And** log errors at ERROR level with response details

2. **Given** WebSocket connection **When** connection state changes **Then** log connecting/connected/reconnecting/disconnected at INFO level

3. **Given** WebSocket messages **When** channel_update is received **Then** log channel change at DEBUG level

4. **Given** any unhandled error **When** error is caught **Then** log with full error object at ERROR level

## Tasks / Subtasks

- [x] Task 1: Add logging to api.ts service (AC: #1, #4)
  - [x] Import logger from `@/lib/logger`
  - [x] Log DEBUG: Before each API call with endpoint
  - [x] Log ERROR: Failed requests with status and error detail
  - [x] Log DEBUG: Successful responses (optionally with data size)
  - [x] Add logging to:
    - `login()` - DEBUG: attempt, INFO: success, ERROR: failure
    - `fetchWithAuth()` - DEBUG: request, ERROR: failure
    - `fetchChannels()` - DEBUG: request, ERROR: failure
    - `setCurrentChannel()` - DEBUG: request, INFO: success, ERROR: failure
    - `fetchCurrentChannel()` - DEBUG: request
    - `fetchNowPlaying()` - DEBUG: request
    - `loginWithPlex()` - DEBUG: attempt, INFO: success, ERROR: failure

- [x] Task 2: Add logging to ersatztvApi.ts service (AC: #1)
  - [x] Import logger from `@/lib/logger`
  - [x] Log DEBUG: ErsatzTV API calls
  - [x] Log ERROR: Failed requests
  - [x] Add logging to all API methods

- [x] Task 3: Add logging to useWebSocket.ts hook (AC: #2, #3, #4)
  - [x] Import logger from `@/lib/logger`
  - [x] Log INFO: Connection state changes (connecting, connected, reconnecting, disconnected)
  - [x] Log DEBUG: Received messages (channel_update, connection_ack, pong)
  - [x] Log ERROR: WebSocket errors
  - [x] Log DEBUG: Reconnection attempts with retry count
  - [x] Log WARNING: Max reconnection attempts reached
  - [x] Replace existing `console.log` and `console.error` calls with logger

- [x] Task 4: Add logging to plexAuth.ts service (AC: #1, #4)
  - [x] Import logger from `@/lib/logger`
  - [x] Log DEBUG: OAuth flow steps
  - [x] Log INFO: Successful token acquisition
  - [x] Log ERROR: OAuth failures
  - [x] Log DEBUG: Pin polling status

- [x] Task 5: Add logging to auth-related stores (AC: #4)
  - [x] Add logging to authStore.ts:
    - INFO: Login/logout events
    - DEBUG: Token storage operations
  - [x] Add logging to channelStore.ts:
    - DEBUG: Channel state updates
  - [x] Add logging to ersatztvStore.ts:
    - DEBUG: State updates

- [x] Task 6: Replace remaining console.log calls across codebase
  - [x] Search for console.log, console.error, console.warn in frontend
  - [x] Replace with appropriate logger calls
  - [x] Ensure consistent context naming

## Dev Notes

### Architecture Compliance

- All API services are in `frontend/src/services/`
- Hooks are in `frontend/src/hooks/`
- Stores are in `frontend/src/stores/`
- Use named imports: `import { logger } from '@/lib/logger'`
- Use consistent context names for filtering

### File Structure Requirements

```
frontend/src/
├── lib/
│   └── logger.ts          # Created in Story 9.4
├── services/
│   ├── api.ts             # MODIFY
│   ├── ersatztvApi.ts     # MODIFY
│   └── plexAuth.ts        # MODIFY
├── hooks/
│   └── useWebSocket.ts    # MODIFY
└── stores/
    ├── authStore.ts       # MODIFY
    ├── channelStore.ts    # MODIFY
    └── ersatztvStore.ts   # MODIFY
```

### Implementation Patterns

**API Service Logging Pattern:**
```typescript
import { logger } from '@/lib/logger'

export async function fetchChannels(): Promise<Channel[]> {
  logger.debug('API', 'Fetching channels')

  const response = await fetchWithAuth('/channels')

  if (!response.ok) {
    const errorDetail = await response.text().catch(() => 'Unknown error')
    logger.error('API', `Failed to fetch channels: ${response.status}`, {
      status: response.status,
      detail: errorDetail
    })
    if (response.status === 503) {
      throw new Error('Channel service unavailable')
    }
    throw new Error('Failed to fetch channels')
  }

  const data = await response.json()
  logger.debug('API', `Fetched ${data.length} channels`)
  return data
}
```

**WebSocket Logging Pattern:**
```typescript
import { logger } from '@/lib/logger'

// In connect function
logger.info('WebSocket', isReconnect ? 'Reconnecting...' : 'Connecting...')

ws.onopen = () => {
  logger.info('WebSocket', 'Connected successfully')
  // ...
}

ws.onmessage = (event) => {
  try {
    const message = JSON.parse(event.data)
    logger.debug('WebSocket', `Received message: ${message.type}`, message)
    handleMessage(message)
  } catch (e) {
    logger.error('WebSocket', 'Failed to parse message', {
      data: event.data,
      error: e
    })
  }
}

ws.onerror = (error) => {
  logger.error('WebSocket', 'Connection error', error)
}

ws.onclose = (event) => {
  logger.info('WebSocket', `Disconnected (code: ${event.code})`)
  // ...
  if (retryCountRef.current < MAX_RETRIES) {
    logger.debug('WebSocket', `Scheduling reconnect in ${delay}ms (attempt ${retryCountRef.current + 1}/${MAX_RETRIES})`)
  } else {
    logger.warn('WebSocket', 'Max reconnection attempts reached')
  }
}
```

**Store Logging Pattern:**
```typescript
import { logger } from '@/lib/logger'

export const useAuthStore = create<AuthState>((set) => ({
  // ...
  login: (token, role) => {
    logger.info('Auth', `User logged in with role: ${role}`)
    localStorage.setItem('token', token)
    set({ token, role, isAuthenticated: true })
  },
  logout: () => {
    logger.info('Auth', 'User logged out')
    localStorage.removeItem('token')
    set({ token: null, role: null, isAuthenticated: false })
  },
}))
```

### Context Naming Convention

Use consistent context names for easy filtering:
- `API` - REST API calls (api.ts, ersatztvApi.ts)
- `WebSocket` - WebSocket connection and messages
- `Auth` - Authentication operations
- `Plex` - Plex OAuth specific operations
- `Store` - Zustand store operations
- `Player` - Video player events (if logging added later)
- `EPG` - EPG-related frontend operations

### Dependencies

- **Depends on:** Story 9.4 (Frontend Logger Utility) - must be completed first
- Logger must be available at `@/lib/logger`

### Replacing console.log Calls

Current console usage to replace:
- `frontend/src/hooks/useWebSocket.ts`:
  - Line ~71: `console.log('Unknown message type:', message.type)`
  - Line ~115: `console.error('Failed to parse WebSocket message:', event.data)`
  - Line ~120: `console.error('WebSocket error:', error)`
  - Line ~143: `console.log('Reconnecting in ${delay}ms...')`
  - Line ~152: `console.log('Max reconnection attempts reached')`

### Testing Strategy

- Mock logger.debug, logger.info, logger.error, logger.warn
- Verify correct log calls are made for each scenario
- Test error logging includes appropriate context
- Test WebSocket state transitions produce correct logs

### Security Considerations

- Never log full JWT tokens (log first 8 chars max if needed)
- Never log passwords
- Be careful with Plex auth tokens in logs
- Log usernames but not sensitive user data

### References

- [Source: frontend/src/services/api.ts - current API service]
- [Source: frontend/src/hooks/useWebSocket.ts - current WebSocket hook]
- [Source: frontend/src/services/plexAuth.ts - Plex OAuth service]
- [Source: epics.md#Epic 9 - Story 9.5]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation proceeded without issues

### Completion Notes List

- Added structured logging to all frontend API services (api.ts, ersatztvApi.ts) with consistent context naming (API)
- Added comprehensive WebSocket logging with INFO level for connection state changes and DEBUG for messages
- Added Plex OAuth flow logging with step-by-step DEBUG logs and INFO for successful authentication
- Added Zustand store logging with INFO for auth events and DEBUG for state changes
- Replaced all console.log/error/warn calls in useWebSocket.ts, useOrientationFullscreen.ts, LoginForm.tsx, and main.tsx
- Used consistent context naming: API, WebSocket, Auth, Plex, Store, Player, PWA
- All 630 frontend tests pass
- All linting checks pass

### Change Log

- 2026-01-04: Implemented frontend API and WebSocket logging (Story 9.5)

### File List

**Modified:**
- frontend/src/services/api.ts - Added logger import and logging to all API functions
- frontend/src/services/ersatztvApi.ts - Added logger import and logging to ErsatzTV API functions
- frontend/src/services/plexAuth.ts - Added logger import and logging to Plex OAuth flow
- frontend/src/hooks/useWebSocket.ts - Added logger import and replaced all console calls with structured logging
- frontend/src/hooks/useOrientationFullscreen.ts - Added logger import and replaced all console calls
- frontend/src/stores/authStore.ts - Added logger import and logging for auth events
- frontend/src/stores/channelStore.ts - Added logger import and logging for channel state updates
- frontend/src/stores/ersatztvStore.ts - Added logger import and logging for store operations
- frontend/src/components/LoginForm.tsx - Added logger import and replaced console.error
- frontend/src/main.tsx - Added logger import and replaced PWA registration console calls
