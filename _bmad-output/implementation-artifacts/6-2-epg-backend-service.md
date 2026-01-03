# Story 6.2: EPG Backend Service

Status: review

## Story

As the system,
I want to fetch and cache EPG data from Dispatcharr,
so that current program information can be displayed to users.

## Acceptance Criteria

1. **GET `/api/epg/now-playing` endpoint**: Returns current program info for a channel
   - Query param: `channel_id` (required, UUID string)
   - Returns: `{channelId, currentProgram: {title, startTime, endTime, description?}, nextProgram?: {...}}`
2. **XMLTV fetching**: Fetch fresh data from Dispatcharr `/xmltv.php` when cache is stale
3. **24-hour cache**: Cache EPG data for 24 hours to minimize API calls
4. **Graceful fallback**: Return cached data if Dispatcharr is unreachable, or 503 if no cache
5. **No EPG handling**: Return `{channelId, currentProgram: null}` when no EPG data exists

## Tasks / Subtasks

- [x] Task 1: Create EPG Pydantic models (AC: #1)
  - [x] Create `backend/app/models/epg.py` with Program and EPGResponse models
- [x] Task 2: Create EPG service with XMLTV parsing (AC: #2, #3)
  - [x] Create `backend/app/services/epg_service.py`
  - [x] Implement XMLTV XML parsing using defusedxml
  - [x] Implement in-memory cache with 24h TTL
  - [x] Implement program lookup by channel and time
- [x] Task 3: Create EPG router (AC: #1, #4, #5)
  - [x] Create `backend/app/routers/epg.py`
  - [x] Implement GET `/api/epg/now-playing` endpoint
  - [x] Handle missing/null EPG scenarios
  - [x] Handle Dispatcharr unavailability
- [x] Task 4: Register router in main.py
  - [x] Import and include epg router
- [x] Task 5: Add dependency (AC: #2)
  - [x] Add `defusedxml` to pyproject.toml for safe XML parsing
- [x] Task 6: Write tests
  - [x] Create `backend/app/services/epg_service_test.py`
  - [x] Create `backend/app/routers/epg_test.py`

## Dev Notes

### Architecture Compliance

- **Backend file organization**: Follow existing pattern in `backend/app/`
- **Router pattern**: Match existing routers in `backend/app/routers/`
- **Service pattern**: Match existing services in `backend/app/services/`
- **Pydantic models**: Use camelCase aliases for JSON serialization

### Technical Implementation

**Models** (`backend/app/models/epg.py`):
```python
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class Program(BaseModel):
    title: str
    start_time: datetime = Field(alias="startTime")
    end_time: datetime = Field(alias="endTime")
    description: Optional[str] = None

    class Config:
        populate_by_name = True

class EPGResponse(BaseModel):
    channel_id: str = Field(alias="channelId")
    current_program: Optional[Program] = Field(alias="currentProgram")
    next_program: Optional[Program] = Field(alias="nextProgram", default=None)

    class Config:
        populate_by_name = True
```

**Service structure** (`backend/app/services/epg_service.py`):
```python
import httpx
from defusedxml import ElementTree
from datetime import datetime, timedelta
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class EPGService:
    def __init__(self, dispatcharr_url: str):
        self.dispatcharr_url = dispatcharr_url
        self._cache: dict = {}  # channel_id -> list of programs
        self._cache_expires: Optional[datetime] = None
        self._cache_ttl = timedelta(hours=24)

    async def refresh_cache(self) -> bool:
        """Fetch XMLTV from Dispatcharr and parse into cache"""
        # Implementation here

    async def get_now_playing(self, channel_id: str) -> EPGResponse:
        """Get current and next program for channel"""
        # Check cache freshness
        # Find current program by comparing now against start/end times
        # Find next program
        # Return EPGResponse
```

**XMLTV format** (from Dispatcharr `/xmltv.php`):
```xml
<tv>
  <channel id="uuid-here">
    <display-name>Channel Name</display-name>
  </channel>
  <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="uuid-here">
    <title>Program Title</title>
    <desc>Optional description</desc>
  </programme>
</tv>
```

**Router** (`backend/app/routers/epg.py`):
```python
from fastapi import APIRouter, Depends, Query, HTTPException
from app.services.epg_service import EPGService
from app.models.epg import EPGResponse
from app.routers.auth_deps import get_current_user

router = APIRouter(prefix="/api/epg", tags=["epg"])

@router.get("/now-playing", response_model=EPGResponse)
async def get_now_playing(
    channel_id: str = Query(..., alias="channel_id"),
    user = Depends(get_current_user)
) -> EPGResponse:
    # Implementation
```

### Dependencies

Add to `backend/pyproject.toml`:
```toml
dependencies = [
    # ... existing deps
    "defusedxml>=0.7.1",
]
```

Then run: `uv sync`

### Cache Strategy

- **In-memory dict**: Simple, sufficient for single-container deployment
- **TTL check**: Compare `datetime.now(timezone.utc)` against `_cache_expires`
- **Lazy refresh**: Only refresh when cache is stale AND request comes in
- **Fallback**: If refresh fails but cache exists, use stale cache and log warning

### Error Handling

- **Dispatcharr down + no cache**: Return 503 `{"detail": "EPG service unavailable"}`
- **Dispatcharr down + stale cache**: Return stale data (better than nothing)
- **No EPG for channel**: Return `{"channelId": "...", "currentProgram": null}`

### Project Structure Notes

New files:
- `backend/app/models/epg.py`
- `backend/app/services/epg_service.py`
- `backend/app/routers/epg.py`
- `backend/app/services/epg_service_test.py`
- `backend/app/routers/epg_test.py`

### Testing Requirements

- Mock XMLTV response for service tests
- Test cache expiration logic
- Test program time matching (now between start and end)
- Test no-EPG-data scenario
- Test Dispatcharr unavailability scenario

### References

- [Source: _bmad-output/architecture.md#Post-Implementation-Updates] - EPG endpoint specification
- [Source: backend/app/services/dispatcharr.py] - Existing Dispatcharr service pattern
- [Source: backend/app/routers/channels.py] - Existing router pattern
- [Source: backend/app/models/channel.py] - Existing model pattern

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- None - Implementation proceeded without issues

### Completion Notes List

- Created EPG Pydantic models (Program, EPGResponse) with camelCase JSON serialization
- Implemented EPGService with XMLTV parsing using defusedxml for safe XML handling
- Service uses in-memory cache with 24h TTL and lazy refresh strategy
- Graceful fallback: uses stale cache if refresh fails, returns 503 only if no cache exists
- Router handles authentication via get_current_user dependency
- Returns null currentProgram when no EPG data exists for channel
- All 33 new tests pass, 126 total tests pass with no regressions

### File List

- `backend/app/models/epg.py` (new)
- `backend/app/services/epg_service.py` (new)
- `backend/app/routers/epg.py` (new)
- `backend/app/services/epg_service_test.py` (new)
- `backend/app/routers/epg_test.py` (new)
- `backend/app/main.py` (modified - added epg router)
- `backend/pyproject.toml` (modified - added defusedxml dependency)

## Change Log

- 2026-01-03: Implemented EPG backend service with XMLTV parsing, 24h caching, and graceful error handling
