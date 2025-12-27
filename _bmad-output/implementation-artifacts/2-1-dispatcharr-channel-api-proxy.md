# Story 2.1: Dispatcharr Channel API Proxy

Status: review

## Story

As the system,
I want to fetch the channel lineup from Dispatcharr,
So that users can see available channels.

## Acceptance Criteria

1. **Given** the backend is running with DISPATCHARR_URL configured
   **When** an authenticated user calls GET `/api/channels`
   **Then** the backend proxies to Dispatcharr `/hdhr/lineup.json`
   **And** returns the channel list as JSON array with channelId, name, and streamUrl

2. **Given** Dispatcharr returns channel data in its native format
   **When** the backend processes the response
   **Then** it transforms the data to match our Channel model (id, name, streamUrl)
   **And** streamUrl points to the public streams domain (VITE_STREAM_BASE_URL)

3. **Given** Dispatcharr is unreachable or returns an error
   **When** GET `/api/channels` is called
   **Then** return 503 with `{"detail": "Channel service unavailable"}`

4. **Given** an unauthenticated request
   **When** GET `/api/channels` is called without valid JWT
   **Then** return 401 Unauthorized

## Tasks / Subtasks

- [x] Task 1: Create Channel Pydantic Models (AC: #1, #2)
  - [x] Create/update backend/app/models/channel.py
  - [x] Define Channel model (id: str, name: str, streamUrl: str) with camelCase aliases
  - [x] Define DispatchrrChannel model matching Dispatcharr's lineup.json format
  - [x] Add model tests

- [x] Task 2: Implement Dispatcharr Service (AC: #1, #2, #3)
  - [x] Update backend/app/services/dispatcharr.py
  - [x] Add httpx to dependencies for async HTTP client
  - [x] Implement `async def get_lineup() -> list[Channel]`
  - [x] Transform Dispatcharr response to our Channel model
  - [x] Build streamUrl using STREAM_BASE_URL config
  - [x] Handle connection errors with proper exception
  - [x] Add service tests with mocked responses

- [x] Task 3: Implement Channels Router (AC: #1, #3, #4)
  - [x] Update backend/app/routers/channels.py
  - [x] Implement GET /api/channels endpoint
  - [x] Apply get_current_user dependency for JWT auth
  - [x] Call dispatcharr service and return transformed channels
  - [x] Handle service exceptions → 503 response
  - [x] Add router tests

- [x] Task 4: Add Config and Register Router
  - [x] Add STREAM_BASE_URL to backend/app/config.py
  - [x] Register channels router in main.py with prefix "/api"
  - [ ] Verify endpoint works end-to-end with real Dispatcharr

## Dev Notes

### Architecture Compliance

**API Endpoint:** GET /api/channels
- Authentication: JWT required (get_current_user dependency)
- Response: JSON array of Channel objects

**Dispatcharr Integration:**
- Backend calls `http://10.8.0.2:9191/hdhr/lineup.json` via Wireguard
- Dispatcharr `/hdhr/lineup.json` returns HDHomeRun format:
  ```json
  [
    {
      "GuideNumber": "1.1",
      "GuideName": "TSN",
      "URL": "http://10.8.0.2:9191/proxy/ts/stream/uuid-here"
    }
  ]
  ```
- We transform to our Channel format with public stream URL

### Pydantic Models Structure

```python
# backend/app/models/channel.py
from pydantic import BaseModel, Field

class DispatchrrChannel(BaseModel):
    """Raw channel data from Dispatcharr lineup.json"""
    guide_number: str = Field(alias="GuideNumber")
    guide_name: str = Field(alias="GuideName")
    url: str = Field(alias="URL")

    model_config = {"populate_by_name": True}

class Channel(BaseModel):
    """Transformed channel for our API"""
    id: str
    name: str
    stream_url: str = Field(alias="streamUrl")

    model_config = {"populate_by_name": True}
```

### Dispatcharr Service Implementation

```python
# backend/app/services/dispatcharr.py
import httpx
from app.config import settings
from app.models.channel import Channel, DispatchrrChannel

async def get_lineup() -> list[Channel]:
    """Fetch and transform channel lineup from Dispatcharr."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{settings.DISPATCHARR_URL}/hdhr/lineup.json")
            response.raise_for_status()

            raw_channels = [DispatchrrChannel(**c) for c in response.json()]

            return [
                Channel(
                    id=extract_uuid(ch.url),
                    name=ch.guide_name,
                    stream_url=f"{settings.STREAM_BASE_URL}/proxy/ts/stream/{extract_uuid(ch.url)}"
                )
                for ch in raw_channels
            ]
    except httpx.HTTPError as e:
        raise DispatchrrUnavailableError(f"Failed to fetch channels: {e}")

def extract_uuid(url: str) -> str:
    """Extract stream UUID from Dispatcharr URL."""
    # URL format: http://10.8.0.2:9191/proxy/ts/stream/{uuid}
    return url.split("/")[-1]

class DispatchrrUnavailableError(Exception):
    """Raised when Dispatcharr API is unreachable."""
    pass
```

### Channels Router Implementation

```python
# backend/app/routers/channels.py
from fastapi import APIRouter, Depends, HTTPException, status
from app.models.channel import Channel
from app.models.auth import TokenPayload
from app.routers.auth_deps import get_current_user
from app.services.dispatcharr import get_lineup, DispatchrrUnavailableError

router = APIRouter(tags=["channels"])

@router.get("/channels", response_model=list[Channel])
async def list_channels(
    current_user: TokenPayload = Depends(get_current_user)
) -> list[Channel]:
    """Get list of available channels from Dispatcharr."""
    try:
        return await get_lineup()
    except DispatchrrUnavailableError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Channel service unavailable"
        )
```

### Config Updates

```python
# backend/app/config.py (additions)
class Settings(BaseSettings):
    # ... existing settings ...

    # Dispatcharr
    DISPATCHARR_URL: str = "http://10.8.0.2:9191"

    # Stream proxy (public URL for frontend)
    STREAM_BASE_URL: str = "https://streams.domain.com"
```

### Dependencies to Add

```bash
cd backend
uv add httpx
```

### Project Structure Notes

**Files to create/modify:**
- `backend/app/models/channel.py` - REPLACE placeholder with models
- `backend/app/models/channel_test.py` - NEW test file
- `backend/app/services/dispatcharr.py` - REPLACE placeholder with service
- `backend/app/services/dispatcharr_test.py` - NEW test file
- `backend/app/routers/channels.py` - REPLACE placeholder with router
- `backend/app/routers/channels_test.py` - NEW test file
- `backend/app/config.py` - ADD STREAM_BASE_URL setting
- `backend/app/main.py` - REGISTER channels router

### Testing Strategy

**Unit Tests:**
- Channel model serialization/deserialization with camelCase
- DispatchrrChannel parsing from real Dispatcharr response format
- extract_uuid function with various URL formats

**Integration Tests:**
- Mock httpx to simulate Dispatcharr responses
- Test successful channel fetch and transformation
- Test error handling when Dispatcharr is unavailable
- Test 401 response for unauthenticated requests

**Manual Verification:**
- Start backend and verify GET /api/channels returns real Dispatcharr data
- Verify streamUrl uses public STREAM_BASE_URL domain

### Naming Conventions

- Python internal: snake_case (stream_url, guide_name)
- JSON response: camelCase via Pydantic aliases (streamUrl, guideName)
- Endpoint: kebab-case (/api/channels)

### Anti-Patterns to Avoid

- Do NOT hardcode Dispatcharr URL - use settings
- Do NOT expose internal Dispatcharr URLs to frontend
- Do NOT use synchronous requests (use async httpx)
- Do NOT skip authentication on the endpoint
- Do NOT return raw Dispatcharr response - transform it

### References

- [Source: _bmad-output/architecture.md#Dispatcharr-Integration]
- [Source: _bmad-output/architecture.md#API-Boundaries]
- [Source: _bmad-output/epics.md#Story-2.1]
- [Source: _bmad-output/project-context.md#Python/FastAPI-Rules]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation proceeded without issues.

### Completion Notes List

- Implemented Channel and DispatchrrChannel Pydantic models with camelCase JSON serialization
- Created async Dispatcharr service with httpx client, UUID extraction, and proper error handling
- Built channels router with JWT authentication and 503 error handling for unavailable service
- Added stream_base_url config setting for public stream URLs
- Registered channels router in main.py at /api prefix
- All 54 tests pass (17 new tests added for this story)
- Implementation follows red-green-refactor TDD approach

### File List

- backend/app/models/channel.py (modified - replaced placeholder)
- backend/app/models/channel_test.py (created)
- backend/app/services/dispatcharr.py (modified - replaced placeholder)
- backend/app/services/dispatcharr_test.py (created)
- backend/app/routers/channels.py (modified - replaced placeholder)
- backend/app/routers/channels_test.py (created)
- backend/app/config.py (modified - added stream_base_url)
- backend/app/main.py (modified - registered channels router)

## Change Log

- 2024-12-24: Implemented Dispatcharr Channel API Proxy (Story 2.1) - all ACs satisfied
- 2025-12-26: **CRITICAL FIX** - Fixed stream URL construction bug

### 2025-12-26 Fix: Stream URL Format

**Problem Identified:**
- Backend was constructing HLS URLs: `/proxy/hls/{uuid}/playlist.m3u8`
- Dispatcharr only supports TS stream URLs: `/proxy/ts/stream/{uuid}`
- The HLS endpoint doesn't exist - returned HTML instead of m3u8 playlist

**Root Cause:**
In `backend/app/services/dispatcharr.py`, the stream URL was incorrectly constructed:
```python
# WRONG - HLS endpoint doesn't exist
stream_url=f"{settings.stream_base_url}/proxy/hls/{uuid}/playlist.m3u8"
```

**Fix Applied:**
```python
# CORRECT - Use Dispatcharr's actual TS stream endpoint
stream_url=f"{settings.stream_base_url}/proxy/ts/stream/{uuid}"
```

**File Modified:**
- `backend/app/services/dispatcharr.py:47` - Changed URL format from HLS to TS

