# Story 7.6: ErsatzTV API Endpoints

Status: ready-for-dev

## Story

As a frontend developer,
I want REST API endpoints for ErsatzTV data,
so that the React app can fetch channels and programmes.

## Acceptance Criteria

1. **GET /api/ersatztv/channels**: Returns list of all ErsatzTV channels (authenticated)
2. **GET /api/ersatztv/programmes/{channel_id}?hours=6**: Returns programmes for channel within time window (authenticated)
3. **GET /api/ersatztv/current/{channel_id}**: Returns current and next programme for channel (authenticated)
4. **GET /api/ersatztv/stream/{channel_id}**: Returns proxied HLS manifest with rewritten URLs (authenticated)
5. **GET /api/ersatztv/segments/{encoded_url}**: Fetches segment from ErsatzTV and streams to client
6. **GET /api/ersatztv/logos/{channel_id}**: Fetches channel logo from ErsatzTV and returns it

## Tasks / Subtasks

- [ ] Task 1: Create ErsatzTV router (AC: #1, #2, #3)
  - [ ] Create `backend/app/routers/ersatztv.py`
  - [ ] Implement GET `/api/ersatztv/channels` endpoint
  - [ ] Implement GET `/api/ersatztv/programmes/{channel_id}` endpoint with `hours` query param
  - [ ] Implement GET `/api/ersatztv/current/{channel_id}` endpoint
- [ ] Task 2: Implement streaming endpoints (AC: #4, #5)
  - [ ] Implement GET `/api/ersatztv/stream/{channel_id}` for HLS manifest
  - [ ] Implement GET `/api/ersatztv/segments/{encoded_url}` for segment proxy
  - [ ] Use StreamingResponse for efficient segment delivery
- [ ] Task 3: Implement logo proxy (AC: #6)
  - [ ] Implement GET `/api/ersatztv/logos/{channel_id}`
  - [ ] Fetch logo from original_logo_url stored in channel
  - [ ] Return with correct content-type header
- [ ] Task 4: Register router in main.py
  - [ ] Import and include ersatztv router
- [ ] Task 5: Write tests
  - [ ] Test all endpoints with mocked services
  - [ ] Test authentication requirement
  - [ ] Test error handling

## Dev Notes

### Architecture Compliance

- **Router location**: `backend/app/routers/ersatztv.py`
- **Authentication**: All endpoints require JWT (use `get_current_user` dependency)
- **Response models**: Use Pydantic models from `app.models.ersatztv`
- **Streaming**: Use `StreamingResponse` for binary data (segments, logos)

### Technical Implementation

**Router structure** (`backend/app/routers/ersatztv.py`):
```python
"""ErsatzTV API endpoints

Provides REST API for ErsatzTV channel and programme data,
plus HLS stream proxying and logo serving.

Story: 7.6 - ErsatzTV API Endpoints
"""
from fastapi import APIRouter, Depends, Query, Path, HTTPException
from fastapi.responses import StreamingResponse
import httpx
from loguru import logger

from app.config import settings
from app.models.ersatztv import (
    EPGChannelResponse,
    CurrentProgrammeResponse,
    ProgrammeListResponse,
)
from app.routers.auth_deps import get_current_user
from app.services.ersatztv import (
    get_channels,
    get_channel_by_id,
    get_current_programme,
    get_programmes_by_channel,
)
from app.services.ersatztv.hls_rewriter import rewrite_manifest, decode_url

router = APIRouter(prefix="/api/ersatztv", tags=["ersatztv"])


@router.get("/channels", response_model=EPGChannelResponse)
async def list_channels(user=Depends(get_current_user)) -> EPGChannelResponse:
    """Get all ErsatzTV channels"""
    channels = get_channels()
    return EPGChannelResponse(channels=channels)


@router.get("/programmes/{channel_id}", response_model=ProgrammeListResponse)
async def list_programmes(
    channel_id: str = Path(...),
    hours: int = Query(default=6, ge=1, le=24),
    user=Depends(get_current_user),
) -> ProgrammeListResponse:
    """Get programmes for channel within time window"""
    programmes = get_programmes_by_channel(channel_id, hours=hours)
    return ProgrammeListResponse(channel_id=channel_id, programmes=programmes)


@router.get("/current/{channel_id}", response_model=CurrentProgrammeResponse)
async def get_current(
    channel_id: str = Path(...),
    user=Depends(get_current_user),
) -> CurrentProgrammeResponse:
    """Get current and next programme for channel"""
    current, next_up = get_current_programme(channel_id)
    return CurrentProgrammeResponse(
        channel_id=channel_id,
        current=current,
        next_up=next_up,
    )


@router.get("/stream/{channel_id}")
async def get_stream(
    channel_id: str = Path(...),
    url: str = Query(default=None),
    user=Depends(get_current_user),
):
    """
    Get proxied HLS manifest for channel.

    If `url` query param is provided, fetches that URL (for nested playlists).
    Otherwise fetches the channel's stream_url from M3U data.
    """
    try:
        if url:
            # Nested playlist - decode URL
            manifest_url = decode_url(url)
        else:
            # Initial request - get channel stream URL
            channel = get_channel_by_id(channel_id)
            if not channel:
                raise HTTPException(status_code=404, detail="Channel not found")
            manifest_url = channel.stream_url

        # Validate URL is from ErsatzTV
        if not manifest_url.startswith(settings.ersatztv_base_url):
            raise HTTPException(status_code=400, detail="Invalid stream URL")

        # Fetch manifest
        async with httpx.AsyncClient() as client:
            response = await client.get(manifest_url, timeout=10)
            response.raise_for_status()

        # Rewrite manifest
        base_url = manifest_url.rsplit('/', 1)[0] + '/'
        rewritten = rewrite_manifest(response.text, base_url)

        return StreamingResponse(
            iter([rewritten.encode()]),
            media_type="application/vnd.apple.mpegurl",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Stream error: {e}")
        raise HTTPException(status_code=503, detail="Stream unavailable")


@router.get("/segments/{encoded_url:path}")
async def get_segment(
    encoded_url: str = Path(...),
    user=Depends(get_current_user),
):
    """Proxy HLS segment from ErsatzTV"""
    try:
        segment_url = decode_url(encoded_url)

        # Validate URL is from ErsatzTV
        if not segment_url.startswith(settings.ersatztv_base_url):
            raise HTTPException(status_code=400, detail="Invalid segment URL")

        async with httpx.AsyncClient() as client:
            response = await client.get(segment_url, timeout=30)
            response.raise_for_status()

        # Determine content type
        content_type = response.headers.get("content-type", "video/mp2t")

        return StreamingResponse(
            iter([response.content]),
            media_type=content_type,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Segment error: {e}")
        raise HTTPException(status_code=503, detail="Segment unavailable")


@router.get("/logos/{channel_id}")
async def get_logo(
    channel_id: str = Path(...),
    user=Depends(get_current_user),
):
    """Proxy channel logo from ErsatzTV"""
    try:
        channel = get_channel_by_id(channel_id)
        if not channel:
            raise HTTPException(status_code=404, detail="Channel not found")

        logo_url = getattr(channel, 'original_logo_url', None) or channel.logo_url
        if not logo_url:
            raise HTTPException(status_code=404, detail="No logo available")

        async with httpx.AsyncClient() as client:
            response = await client.get(logo_url, timeout=10)
            response.raise_for_status()

        content_type = response.headers.get("content-type", "image/png")

        return StreamingResponse(
            iter([response.content]),
            media_type=content_type,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Logo error: {e}")
        raise HTTPException(status_code=503, detail="Logo unavailable")
```

### Register Router

Add to `backend/app/main.py`:
```python
from app.routers import ersatztv

app.include_router(ersatztv.router)
```

### API Response Examples

**GET /api/ersatztv/channels**:
```json
{
  "channels": [
    {
      "id": "comedy-classics",
      "name": "Comedy Classics",
      "streamUrl": "http://...",
      "logoUrl": "/api/ersatztv/logos/comedy-classics",
      "number": 1,
      "group": "Movies"
    }
  ]
}
```

**GET /api/ersatztv/current/comedy-classics**:
```json
{
  "channelId": "comedy-classics",
  "current": {
    "id": "comedy-classics_1735927200",
    "channelId": "comedy-classics",
    "title": "Airplane!",
    "description": "Classic comedy film",
    "start": "2026-01-03T18:00:00Z",
    "stop": "2026-01-03T19:30:00Z",
    "category": ["Comedy", "Movie"]
  },
  "nextUp": {
    "id": "comedy-classics_1735932600",
    "channelId": "comedy-classics",
    "title": "Naked Gun",
    "start": "2026-01-03T19:30:00Z",
    "stop": "2026-01-03T21:00:00Z"
  }
}
```

### Project Structure Notes

New/modified files:
- `backend/app/routers/ersatztv.py` (new)
- `backend/app/routers/__init__.py` (modify)
- `backend/app/main.py` (modify)
- `backend/app/routers/ersatztv_test.py` (new)

### Testing Requirements

```python
from fastapi.testclient import TestClient
from unittest.mock import patch

def test_list_channels_requires_auth(client: TestClient):
    """Channels endpoint requires authentication"""
    response = client.get("/api/ersatztv/channels")
    assert response.status_code == 401

def test_list_channels_returns_channels(client: TestClient, auth_headers: dict, mocker):
    """Channels endpoint returns channel list"""
    mock_channels = [EPGChannel(id="ch1", name="Test", stream_url="http://test")]
    mocker.patch("app.services.ersatztv.get_channels", return_value=mock_channels)

    response = client.get("/api/ersatztv/channels", headers=auth_headers)
    assert response.status_code == 200
    assert len(response.json()["channels"]) == 1

def test_get_current_returns_programme(client: TestClient, auth_headers: dict, mocker):
    """Current endpoint returns current and next programme"""
    mock_current = Programme(...)
    mock_next = Programme(...)
    mocker.patch("app.services.ersatztv.get_current_programme", return_value=(mock_current, mock_next))

    response = client.get("/api/ersatztv/current/ch1", headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["current"] is not None

def test_get_stream_rejects_non_ersatztv_url(client: TestClient, auth_headers: dict, mocker):
    """Stream endpoint rejects non-ErsatzTV URLs"""
    # Mock channel with external URL
    mock_channel = EPGChannel(id="ch1", name="Test", stream_url="http://malicious.com/stream")
    mocker.patch("app.services.ersatztv.get_channel_by_id", return_value=mock_channel)

    response = client.get("/api/ersatztv/stream/ch1", headers=auth_headers)
    assert response.status_code == 400
```

### Security Considerations

- **URL validation**: All proxied URLs must start with `settings.ersatztv_base_url`
- **Authentication**: All endpoints require valid JWT
- **Timeouts**: Use reasonable timeouts for upstream requests
- **Error masking**: Don't expose internal URLs in error messages

### References

- [Source: backend/app/routers/channels.py] - Existing router pattern
- [Source: backend/app/routers/epg.py] - Existing EPG router
- [Source: backend/app/routers/auth_deps.py] - Authentication dependency
- [Source: _bmad-output/project-context.md] - API patterns

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
