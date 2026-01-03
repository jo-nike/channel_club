# Story 7.2: M3U Parser Service

Status: review

## Story

As the system,
I want to parse ErsatzTV's M3U playlist,
so that I can display available movie channels.

## Acceptance Criteria

1. **M3U parsing**: `parse_m3u_playlist()` fetches M3U from `ERSATZTV_M3U_URL` and extracts channel_id, name, stream_url, logo_url, number, group for each channel
2. **1-hour cache**: Data is cached and returns cached data without re-fetching if called within 1 hour
3. **Graceful fallback**: If ErsatzTV is unreachable and cache exists, return stale cached data gracefully

## Tasks / Subtasks

- [x] Task 1: Create M3U parser service (AC: #1)
  - [x] Create `backend/app/services/ersatztv/m3u_parser.py`
  - [x] Implement `parse_m3u_playlist()` function
  - [x] Extract EXTINF attributes: channel-id, tvg-chno, channel-number, tvg-id, tvg-name, tvg-logo, group-title
  - [x] Parse stream URL from line after EXTINF
  - [x] Handle duplicate channel IDs gracefully
- [x] Task 2: Implement caching (AC: #2)
  - [x] Add module-level cache dict with timestamp
  - [x] Implement 1-hour TTL check
  - [x] Implement `clear_cache()` function for testing/manual refresh
- [x] Task 3: Implement error handling (AC: #3)
  - [x] Catch httpx errors and return stale cache if available
  - [x] Log warnings on fallback
  - [x] Raise exception only if no cache exists
- [x] Task 4: Write tests
  - [x] Test M3U parsing with sample data
  - [x] Test cache hit/miss behavior
  - [x] Test graceful fallback on network error

## Dev Notes

### Architecture Compliance

- **Service location**: `backend/app/services/ersatztv/m3u_parser.py` (new subfolder)
- **Dependencies**: Use `httpx` for HTTP requests (already in project)
- **Logging**: Use `loguru` logger (already in project)
- **Async**: Use sync functions (M3U data is small, simpler implementation)

### Technical Implementation

**Service structure** (`backend/app/services/ersatztv/m3u_parser.py`):
```python
"""ErsatzTV M3U playlist parser

Parses M3U playlists with extended metadata attributes.
Implements 1-hour TTL caching with graceful fallback.

Story: 7.2 - M3U Parser Service
"""
from datetime import datetime
from typing import List, Optional
import re
import httpx
from loguru import logger

from app.config import settings
from app.models.ersatztv import EPGChannel

# Module-level cache
_cache: dict = {
    "channels": [],
    "timestamp": None,
    "last_successful_fetch": None
}
CACHE_TTL_SECONDS = 3600  # 1 hour


def _is_cache_expired() -> bool:
    """Check if cache is expired (> 1 hour old)"""
    if _cache["timestamp"] is None:
        return True
    age = datetime.now() - _cache["timestamp"]
    return age.total_seconds() > CACHE_TTL_SECONDS


def parse_m3u_playlist() -> List[EPGChannel]:
    """
    Parse ErsatzTV M3U playlist and return list of channels.

    Fetches M3U from configured URL, parses EXTINF metadata,
    and returns EPGChannel objects. Results are cached for 1 hour.

    Returns:
        List[EPGChannel]: Parsed channels from M3U playlist

    Raises:
        Exception: If fetch fails and no cached data available
    """
    # Check cache
    if not _is_cache_expired():
        logger.debug("Returning cached M3U data")
        return _cache["channels"]

    try:
        logger.info("Fetching M3U playlist from ErsatzTV")
        response = httpx.get(settings.ersatztv_m3u_url, timeout=30)
        response.raise_for_status()

        channels = _parse_m3u_content(response.text)

        # Update cache
        _cache["channels"] = channels
        _cache["timestamp"] = datetime.now()
        _cache["last_successful_fetch"] = datetime.now()

        logger.info(f"Parsed {len(channels)} channels from M3U")
        return channels

    except Exception as e:
        logger.warning(f"Failed to fetch M3U: {e}")
        if _cache["last_successful_fetch"] is not None:
            logger.info("Returning stale cached data")
            return _cache["channels"]
        raise Exception("Failed to load channels from ErsatzTV")


def _parse_m3u_content(content: str) -> List[EPGChannel]:
    """Parse M3U content and extract channels"""
    channels = []
    seen_ids = set()
    lines = content.split('\n')
    i = 0
    channel_index = 0

    while i < len(lines):
        line = lines[i].strip()

        if line.startswith('#EXTINF:'):
            # Extract attributes using regex
            channel_id = _extract_attr(line, 'channel-id')
            tvg_chno = _extract_attr(line, 'tvg-chno')
            channel_number = _extract_attr(line, 'channel-number')
            tvg_id = _extract_attr(line, 'tvg-id')
            tvg_name = _extract_attr(line, 'tvg-name')
            tvg_logo = _extract_attr(line, 'tvg-logo')
            group = _extract_attr(line, 'group-title')

            # Fallback name extraction from after last comma
            if not tvg_name:
                match = re.search(r',([^,]+)$', line)
                if match:
                    tvg_name = match.group(1).strip()

            # Get stream URL from next non-empty, non-comment line
            i += 1
            stream_url = None
            while i < len(lines):
                next_line = lines[i].strip()
                if next_line and not next_line.startswith('#'):
                    stream_url = next_line
                    break
                i += 1

            if stream_url:
                # Determine unique ID: tvg-id > channel-id > index
                unique_id = tvg_id or channel_id or str(channel_index + 1)
                if unique_id in seen_ids:
                    unique_id = f"{unique_id}_{channel_index + 1}"
                seen_ids.add(unique_id)

                # Parse channel number
                channel_num = None
                for num_str in [tvg_chno, channel_number]:
                    if num_str:
                        try:
                            channel_num = int(num_str)
                            break
                        except ValueError:
                            pass

                channel = EPGChannel(
                    id=unique_id,
                    name=tvg_name or unique_id,
                    stream_url=stream_url,
                    logo_url=tvg_logo,
                    number=channel_num,
                    group=group
                )
                channels.append(channel)
                channel_index += 1

        i += 1

    return channels


def _extract_attr(line: str, attr_name: str) -> Optional[str]:
    """Extract attribute value from EXTINF line"""
    match = re.search(rf'{attr_name}="([^"]*)"', line)
    return match.group(1) if match else None


def clear_cache() -> None:
    """Clear M3U cache, forcing re-fetch on next request"""
    _cache["timestamp"] = None
    logger.info("M3U cache cleared")
```

### Reference from Prototype

Port from `/home/jon/Code/iptv_viewer/app/epg/parser.py`:
- Uses `@lru_cache` but we'll use explicit dict cache for TTL control
- Extracts: channel-id, tvg-chno, channel-number, tvg-id, tvg-name, tvg-logo, group-title
- Handles duplicate IDs by appending index suffix

### Sample M3U Format

```
#EXTM3U
#EXTINF:-1 channel-id="C1.145.ersatztv.org" tvg-id="comedy-classics" tvg-chno="1" tvg-name="Comedy Classics" tvg-logo="http://192.168.50.108:8409/artwork/...",Comedy Classics
http://192.168.50.108:8409/iptv/channel/1.m3u8
```

### Project Structure Notes

New files:
- `backend/app/services/ersatztv/__init__.py` (new)
- `backend/app/services/ersatztv/m3u_parser.py` (new)
- `backend/app/services/ersatztv/m3u_parser_test.py` (new)

### Testing Requirements

```python
SAMPLE_M3U = """#EXTM3U
#EXTINF:-1 tvg-id="ch1" tvg-name="Channel 1" tvg-chno="1" tvg-logo="http://logo.png",Channel 1
http://example.com/stream1.m3u8
#EXTINF:-1 tvg-id="ch2" tvg-name="Channel 2" tvg-chno="2",Channel 2
http://example.com/stream2.m3u8
"""

def test_parse_m3u_extracts_channels():
    """Parser extracts all channels from M3U"""
    channels = _parse_m3u_content(SAMPLE_M3U)
    assert len(channels) == 2
    assert channels[0].id == "ch1"
    assert channels[0].name == "Channel 1"
    assert channels[0].number == 1

def test_cache_returns_cached_data_within_ttl(mocker):
    """Cache returns cached data without refetching"""
    # First call populates cache
    # Second call returns cache without HTTP request

def test_fallback_on_network_error(mocker):
    """Returns stale cache if network fails"""
    # Populate cache, then mock network failure
    # Should return stale data
```

### Dependencies

Ensure `httpx` is installed (should already be in pyproject.toml)

### References

- [Source: /home/jon/Code/iptv_viewer/app/epg/parser.py] - Prototype M3U parser
- [Source: backend/app/services/dispatcharr.py] - Existing HTTP service pattern
- [Source: _bmad-output/project-context.md] - Service layer pattern

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- Used Python standard `logging` module instead of `loguru` (not installed in project)
- Followed existing project patterns from `backend/app/services/dispatcharr.py`

### Completion Notes List

- Implemented M3U parser service with full EXTINF attribute extraction
- Added 1-hour TTL caching with module-level dict (CACHE_TTL_SECONDS = 3600)
- Implemented graceful fallback: returns stale cache on network errors if available
- Handles duplicate channel IDs by appending `_N` suffix
- 22 comprehensive unit tests covering all acceptance criteria
- Linting passes with ruff

### File List

- `backend/app/services/ersatztv/__init__.py` (new)
- `backend/app/services/ersatztv/m3u_parser.py` (new)
- `backend/tests/services/__init__.py` (new)
- `backend/tests/services/ersatztv/__init__.py` (new)
- `backend/tests/services/ersatztv/test_m3u_parser.py` (new)

## Change Log

- 2026-01-03: Story 7-2 implemented - M3U parser service with caching and graceful fallback
