# Story 7.4: EPG Service Layer

Status: ready-for-dev

## Story

As the system,
I want a unified EPG service layer,
so that I can easily query channels and programmes.

## Acceptance Criteria

1. **get_channels()**: Returns all ErsatzTV channels from M3U data
2. **get_current_programme(channel_id)**: Returns the currently airing programme and next upcoming programme
3. **get_programmes_by_channel(channel_id, hours=6)**: Returns programmes for the specified time window

## Tasks / Subtasks

- [ ] Task 1: Create EPG service module (AC: #1, #2, #3)
  - [ ] Create `backend/app/services/ersatztv/epg_service.py`
  - [ ] Implement `get_channels()` using m3u_parser
  - [ ] Implement `get_current_programme(channel_id)` using xmltv_parser
  - [ ] Implement `get_programmes_by_channel(channel_id, hours)` with time window filtering
- [ ] Task 2: Add helper functions
  - [ ] Implement `get_channel_by_id(channel_id)` for single channel lookup
  - [ ] Implement `get_upcoming_programmes(channel_id, hours, limit)` for future programmes only
  - [ ] Implement `refresh_all()` to force refresh both caches
- [ ] Task 3: Add logo URL rewriting
  - [ ] Rewrite ErsatzTV logo URLs to proxy endpoint `/api/ersatztv/logos/{channel_id}`
  - [ ] Preserve original_logo_url for backend fetching
- [ ] Task 4: Write tests
  - [ ] Test get_channels returns channel list
  - [ ] Test get_current_programme finds correct programme by time
  - [ ] Test get_programmes_by_channel respects time window

## Dev Notes

### Architecture Compliance

- **Service location**: `backend/app/services/ersatztv/epg_service.py`
- **Composition**: Combines m3u_parser and xmltv_parser functionality
- **Timezone**: All time comparisons use UTC
- **Logging**: Use `loguru` logger

### Technical Implementation

**Service structure** (`backend/app/services/ersatztv/epg_service.py`):
```python
"""ErsatzTV EPG service layer

Unified service combining M3U channel data and XMLTV programme data.
Provides high-level API for querying channels and programmes.

Story: 7.4 - EPG Service Layer
"""
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from loguru import logger

from app.config import settings
from app.models.ersatztv import EPGChannel, Programme
from app.services.ersatztv.m3u_parser import parse_m3u_playlist, clear_cache as clear_m3u_cache
from app.services.ersatztv.xmltv_parser import parse_xmltv, clear_cache as clear_xmltv_cache


def get_channels() -> List[EPGChannel]:
    """
    Get all ErsatzTV channels with logo URLs rewritten to proxy.

    Returns:
        List of EPGChannel objects from M3U playlist

    Note:
        Logo URLs are rewritten from ErsatzTV URLs to /api/ersatztv/logos/{channel_id}
        to avoid mixed content issues (HTTPS app -> HTTP ErsatzTV).
    """
    channels = parse_m3u_playlist()

    # Rewrite logo URLs to use proxy
    ersatztv_base = settings.ersatztv_base_url
    for channel in channels:
        if channel.logo_url and channel.logo_url.startswith(ersatztv_base):
            # Store original for backend fetching
            channel.original_logo_url = channel.logo_url
            # Rewrite to proxy endpoint
            channel.logo_url = f"/api/ersatztv/logos/{channel.id}"

    return channels


def get_channel_by_id(channel_id: str) -> Optional[EPGChannel]:
    """
    Get a specific channel by ID.

    Args:
        channel_id: Channel identifier

    Returns:
        EPGChannel if found, None otherwise
    """
    channels = get_channels()
    for channel in channels:
        if channel.id == channel_id:
            return channel
    return None


def get_current_programme(channel_id: str) -> tuple[Optional[Programme], Optional[Programme]]:
    """
    Get current and next programme for a channel.

    Args:
        channel_id: Channel identifier

    Returns:
        Tuple of (current_programme, next_programme), either may be None
    """
    programmes = parse_xmltv()
    now = datetime.now(timezone.utc)

    current = None
    next_up = None

    # Find current programme (start <= now < stop)
    for prog in programmes:
        if prog.channel_id == channel_id:
            if prog.start <= now < prog.stop:
                current = prog
                break

    # Find next programme (start >= now, first one after current)
    channel_progs = sorted(
        [p for p in programmes if p.channel_id == channel_id and p.start >= now],
        key=lambda p: p.start
    )

    # If we have a current programme, next is first after current ends
    if current and channel_progs:
        for prog in channel_progs:
            if prog.start >= current.stop:
                next_up = prog
                break
    elif channel_progs:
        next_up = channel_progs[0]

    return current, next_up


def get_programmes_by_channel(channel_id: str, hours: int = 6) -> List[Programme]:
    """
    Get programmes for a channel within time window.

    Args:
        channel_id: Channel identifier
        hours: Number of hours to look ahead (default: 6)

    Returns:
        List of programmes sorted by start time
    """
    programmes = parse_xmltv()
    now = datetime.now(timezone.utc)
    end_time = now + timedelta(hours=hours)

    # Include currently airing + upcoming within window
    result = []
    for prog in programmes:
        if prog.channel_id != channel_id:
            continue
        # Include if: currently airing OR starts within window
        if (prog.start <= now < prog.stop) or (now <= prog.start < end_time):
            result.append(prog)

    return sorted(result, key=lambda p: p.start)


def get_upcoming_programmes(
    channel_id: str,
    hours: int = 6,
    limit: Optional[int] = None
) -> List[Programme]:
    """
    Get upcoming (future only) programmes for a channel.

    Args:
        channel_id: Channel identifier
        hours: Number of hours to look ahead
        limit: Maximum number of programmes to return

    Returns:
        List of upcoming programmes sorted by start time
    """
    programmes = parse_xmltv()
    now = datetime.now(timezone.utc)
    end_time = now + timedelta(hours=hours)

    upcoming = [
        p for p in programmes
        if p.channel_id == channel_id
        and p.start >= now
        and p.start < end_time
    ]

    upcoming.sort(key=lambda p: p.start)

    if limit:
        return upcoming[:limit]
    return upcoming


def refresh_all() -> None:
    """Force refresh both M3U and XMLTV caches"""
    clear_m3u_cache()
    clear_xmltv_cache()
    logger.info("ErsatzTV EPG caches cleared")
```

### Package Init

Update `backend/app/services/ersatztv/__init__.py`:
```python
from app.services.ersatztv.m3u_parser import parse_m3u_playlist, clear_cache as clear_m3u_cache
from app.services.ersatztv.xmltv_parser import parse_xmltv, clear_cache as clear_xmltv_cache
from app.services.ersatztv.epg_service import (
    get_channels,
    get_channel_by_id,
    get_current_programme,
    get_programmes_by_channel,
    get_upcoming_programmes,
    refresh_all,
)

__all__ = [
    "parse_m3u_playlist",
    "parse_xmltv",
    "get_channels",
    "get_channel_by_id",
    "get_current_programme",
    "get_programmes_by_channel",
    "get_upcoming_programmes",
    "refresh_all",
]
```

### Reference from Prototype

Port from `/home/jon/Code/iptv_viewer/app/epg/service.py`:
- `get_epg_channels()` with logo URL rewriting
- `get_current_programme()` with time comparison
- `get_programmes_by_channel()` with time window
- Graceful fallback on cache miss

### Project Structure Notes

New/modified files:
- `backend/app/services/ersatztv/epg_service.py` (new)
- `backend/app/services/ersatztv/__init__.py` (modify)
- `backend/app/services/ersatztv/epg_service_test.py` (new)

### Testing Requirements

```python
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

def test_get_channels_returns_list(mocker):
    """get_channels returns channel list from M3U"""
    mock_channels = [
        EPGChannel(id="ch1", name="Channel 1", stream_url="http://test.m3u8"),
    ]
    mocker.patch("app.services.ersatztv.m3u_parser.parse_m3u_playlist", return_value=mock_channels)

    result = get_channels()
    assert len(result) == 1
    assert result[0].id == "ch1"

def test_get_current_programme_finds_airing(mocker):
    """get_current_programme finds currently airing programme"""
    now = datetime.now(timezone.utc)
    mock_programmes = [
        Programme(
            id="prog1", channel_id="ch1", title="Current Show",
            start=now - timedelta(hours=1), stop=now + timedelta(hours=1)
        ),
    ]
    mocker.patch("app.services.ersatztv.xmltv_parser.parse_xmltv", return_value=mock_programmes)

    current, next_up = get_current_programme("ch1")
    assert current is not None
    assert current.title == "Current Show"

def test_get_programmes_by_channel_respects_window(mocker):
    """get_programmes_by_channel filters by time window"""
    now = datetime.now(timezone.utc)
    mock_programmes = [
        Programme(id="p1", channel_id="ch1", title="Soon",
                  start=now + timedelta(hours=1), stop=now + timedelta(hours=2)),
        Programme(id="p2", channel_id="ch1", title="Later",
                  start=now + timedelta(hours=10), stop=now + timedelta(hours=11)),
    ]
    mocker.patch("app.services.ersatztv.xmltv_parser.parse_xmltv", return_value=mock_programmes)

    result = get_programmes_by_channel("ch1", hours=6)
    assert len(result) == 1
    assert result[0].title == "Soon"
```

### References

- [Source: /home/jon/Code/iptv_viewer/app/epg/service.py] - Prototype EPG service
- [Source: backend/app/services/epg_service.py] - Existing Dispatcharr EPG service
- [Source: _bmad-output/project-context.md] - Service layer patterns

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
