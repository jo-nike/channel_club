# Story 9.2: Backend Service Logging

Status: review

## Story

As an operator,
I want all backend services to log their operations,
So that I can trace requests and diagnose issues.

## Acceptance Criteria

1. **Given** any external API call (Dispatcharr, Plex, ErsatzTV) **When** the call is made **Then** log the target URL at DEBUG level **And** log success with result count at INFO level **And** log failures with error details at ERROR level

2. **Given** any cache operation (EPG, M3U, XMLTV) **When** cache is accessed **Then** log cache hits/misses at DEBUG level **And** log cache refreshes at INFO level

3. **Given** channel state changes **When** admin sets a new channel **Then** log the change with channel name and user at INFO level

## Tasks / Subtasks

- [x] Task 1: Add logging to dispatcharr.py service (AC: #1)
  - [x] Import loguru logger at module level
  - [x] Log DEBUG: API request URL before fetch
  - [x] Log INFO: Success with channel count
  - [x] Log ERROR: Failure with exception details
  - [x] Use `logger.bind(service="dispatcharr")` for context

- [x] Task 2: Add logging to epg_service.py (AC: #1, #2)
  - [x] Import loguru logger at module level
  - [x] Log DEBUG: EPG fetch URL
  - [x] Log DEBUG: Cache hit/miss status
  - [x] Log INFO: Cache refresh with data age
  - [x] Log ERROR: Parse errors with context
  - [x] Use `logger.bind(service="epg")` for context

- [x] Task 3: Add logging to ersatztv services (AC: #1, #2)
  - [x] Add logging to `m3u_parser.py`:
    - DEBUG: M3U fetch URL
    - DEBUG: Cache hit/miss
    - INFO: Channels parsed count on refresh
    - ERROR: Parse failures
  - [x] Add logging to `xmltv_parser.py`:
    - DEBUG: XMLTV fetch URL
    - DEBUG: Cache hit/miss
    - INFO: Programmes parsed count on refresh
    - ERROR: Parse failures
  - [x] Add logging to `epg_service.py` (ersatztv):
    - DEBUG: Channel/programme lookups
    - INFO: Data refresh events
  - [x] Add logging to `hls_rewriter.py`:
    - DEBUG: Manifest rewrite operations
    - ERROR: Invalid URL decode failures
  - [x] Use `logger.bind(service="ersatztv")` for context

- [x] Task 4: Add logging to plex.py service (AC: #1)
  - [x] Log DEBUG: Plex API request URLs (mask tokens in logs!)
  - [x] Log INFO: Successful user validation with username
  - [x] Log WARNING: Server access denied
  - [x] Log ERROR: API failures with status codes
  - [x] Use `logger.bind(service="plex")` for context

- [x] Task 5: Add logging to channel_state.py (AC: #3)
  - [x] Log INFO: Channel change with channel name
  - [x] Log DEBUG: Channel state queries
  - [x] Include user context when available (bind as extra field)
  - [x] Use `logger.bind(service="channel")` for context

- [x] Task 6: Add logging to auth.py service (AC: #1)
  - [x] Log DEBUG: Token creation (never log credentials!)
  - [x] Log INFO: Successful authentication with role
  - [x] Log WARNING: Failed authentication attempts (include username only)
  - [x] Use `logger.bind(service="auth")` for context

## Dev Notes

### Architecture Compliance

- All service files are in `backend/app/services/`
- Follow existing async patterns with `async def`
- Use dependency injection patterns where applicable
- Never log sensitive data (passwords, full tokens, secrets)

### Library/Framework Requirements

- Use loguru's `logger` directly (no standard library logging)
- Use `logger.bind()` for adding context fields
- Use `logger.opt(exception=True)` for exception logging
- Reference: Story 9.1 must be completed first for logging infrastructure

### File Structure Requirements

```
backend/app/services/
├── dispatcharr.py       # MODIFY
├── epg_service.py       # MODIFY
├── auth.py              # MODIFY
├── channel_state.py     # MODIFY
├── plex.py              # MODIFY
└── ersatztv/
    ├── m3u_parser.py    # MODIFY
    ├── xmltv_parser.py  # MODIFY
    ├── epg_service.py   # MODIFY
    └── hls_rewriter.py  # MODIFY
```

### Implementation Patterns

**Service Logging Pattern:**
```python
from loguru import logger

# At module level
log = logger.bind(service="dispatcharr")

async def get_lineup() -> list[Channel]:
    log.debug("Fetching channel lineup from {}", settings.dispatcharr_url)
    try:
        # ... fetch logic ...
        log.info("Fetched {} channels successfully", len(channels))
        return channels
    except httpx.HTTPError as e:
        log.error("Failed to fetch channels: {}", str(e))
        raise DispatchrrUnavailableError(f"Failed to fetch channels: {e}")
```

**Cache Logging Pattern:**
```python
def get_cached_data():
    if cache.is_valid():
        log.debug("Cache hit for EPG data (age: {}s)", cache.age)
        return cache.data
    log.debug("Cache miss for EPG data, fetching fresh")
    data = fetch_fresh_data()
    log.info("Refreshed EPG cache with {} programmes", len(data))
    return data
```

**Sensitive Data Handling:**
```python
# NEVER log full tokens or passwords
log.debug("Validating Plex token: {}...", token[:8])  # First 8 chars only
log.info("User {} authenticated successfully", username)
# NEVER: log.info("Password: {}", password)  # NO!
```

### Security Considerations

- **NEVER** log passwords, full JWT tokens, or API secrets
- For tokens, log only first 8 characters for debugging
- For Plex server tokens, mask completely in logs
- Log usernames but never email addresses in production

### Dependencies

- **Depends on:** Story 9.1 (Backend Logging Infrastructure)
- Loguru must be configured before services can use logger

### Testing Strategy

- Use pytest fixtures to capture log output
- Verify correct log levels for different scenarios
- Ensure no sensitive data appears in logs
- Test error logging includes appropriate context

### References

- [Source: backend/app/services/dispatcharr.py - current service pattern]
- [Source: backend/app/services/ersatztv/ - ErsatzTV service modules]
- [Source: epics.md#Epic 9 - Story 9.2]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

### Completion Notes List

- Converted all 9 service files from standard library logging to loguru
- Added service-specific context binding using `logger.bind(service="name")` pattern
- Implemented DEBUG logging for API requests, cache hits/misses, and lookups
- Implemented INFO logging for successful operations with counts (channels, programmes)
- Implemented ERROR logging for failures with appropriate context
- Implemented WARNING logging for access denials and fallback scenarios
- Added user context to channel state changes (AC #3)
- Ensured sensitive data is never logged (tokens truncated to 8 chars, no passwords)
- Updated channels router to pass user context to set_current_channel
- All 333 existing tests pass
- Linting passes with no issues

### File List

- backend/app/services/dispatcharr.py (MODIFIED)
- backend/app/services/epg_service.py (MODIFIED)
- backend/app/services/auth.py (MODIFIED)
- backend/app/services/channel_state.py (MODIFIED)
- backend/app/services/plex.py (MODIFIED)
- backend/app/services/ersatztv/m3u_parser.py (MODIFIED)
- backend/app/services/ersatztv/xmltv_parser.py (MODIFIED)
- backend/app/services/ersatztv/epg_service.py (MODIFIED)
- backend/app/services/ersatztv/hls_rewriter.py (MODIFIED)
- backend/app/routers/channels.py (MODIFIED - added user context)
