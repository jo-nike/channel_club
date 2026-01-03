# Story 7.3: XMLTV Parser Service

Status: review

## Story

As the system,
I want to parse ErsatzTV's XMLTV EPG data,
so that I can display programme schedules.

## Acceptance Criteria

1. **XMLTV parsing**: `parse_xmltv()` fetches XMLTV from `ERSATZTV_XMLTV_URL` and extracts id, channel_id, title, description, start, stop, category for each programme
2. **UTC conversion**: All times are converted to UTC timezone-aware datetimes
3. **5-minute cache**: Data is cached and returns cached data without re-fetching if called within 5 minutes

## Tasks / Subtasks

- [x] Task 1: Create XMLTV parser service (AC: #1, #2)
  - [x] Create `backend/app/services/ersatztv/xmltv_parser.py`
  - [x] Implement `parse_xmltv()` function
  - [x] Parse XMLTV datetime format: "YYYYMMDDHHmmss +ZZZZ"
  - [x] Convert all datetimes to UTC timezone-aware
  - [x] Extract programme attributes: channel, start, stop, title, desc, category
  - [x] Generate unique programme ID from channel_id + start timestamp
- [x] Task 2: Implement caching (AC: #3)
  - [x] Add module-level cache dict with timestamp
  - [x] Implement 5-minute TTL check
  - [x] Implement `clear_cache()` function
- [x] Task 3: Implement error handling
  - [x] Use defusedxml for safe XML parsing (already in project from 6.2)
  - [x] Handle missing optional fields (description, category)
  - [x] Return stale cache on fetch failure
- [x] Task 4: Write tests
  - [x] Test datetime parsing with various timezone offsets
  - [x] Test programme extraction
  - [x] Test cache behavior
  - [x] Test graceful handling of missing fields

## Dev Notes

### Architecture Compliance

- **Service location**: `backend/app/services/ersatztv/xmltv_parser.py`
- **Dependencies**: Use `defusedxml` (already added in 6.2), `httpx`
- **Logging**: Use `loguru` logger
- **Timezone**: All datetimes must be UTC timezone-aware

### Technical Implementation

**Service structure** (`backend/app/services/ersatztv/xmltv_parser.py`):
```python
"""ErsatzTV XMLTV EPG parser

Parses XMLTV EPG data to extract programme schedules.
Implements 5-minute TTL caching with timezone-aware UTC conversion.

Story: 7.3 - XMLTV Parser Service
"""
from datetime import datetime, timezone, timedelta
from typing import List
import httpx
from defusedxml import ElementTree
from loguru import logger

from app.config import settings
from app.models.ersatztv import Programme

# Module-level cache
_cache: dict = {
    "programmes": [],
    "timestamp": None,
    "last_successful_fetch": None
}
CACHE_TTL_SECONDS = 300  # 5 minutes


def _parse_xmltv_datetime(dt_str: str) -> datetime:
    """
    Parse XMLTV datetime format to UTC timezone-aware datetime.

    Format: YYYYMMDDHHmmss +ZZZZ (e.g., "20260103180000 +0000")

    Args:
        dt_str: XMLTV datetime string

    Returns:
        Timezone-aware datetime in UTC
    """
    parts = dt_str.strip().split()
    if len(parts) != 2:
        raise ValueError(f"Invalid XMLTV datetime: {dt_str}")

    dt_part, tz_part = parts

    # Parse datetime
    year = int(dt_part[0:4])
    month = int(dt_part[4:6])
    day = int(dt_part[6:8])
    hour = int(dt_part[8:10])
    minute = int(dt_part[10:12])
    second = int(dt_part[12:14])

    # Parse timezone offset
    if len(tz_part) != 5 or tz_part[0] not in ('+', '-'):
        raise ValueError(f"Invalid timezone: {tz_part}")

    tz_sign = 1 if tz_part[0] == '+' else -1
    tz_hours = int(tz_part[1:3])
    tz_minutes = int(tz_part[3:5])
    tz_offset = timezone(timedelta(
        seconds=tz_sign * (tz_hours * 3600 + tz_minutes * 60)
    ))

    # Create local datetime and convert to UTC
    dt_local = datetime(year, month, day, hour, minute, second, tzinfo=tz_offset)
    return dt_local.astimezone(timezone.utc)


def _is_cache_expired() -> bool:
    """Check if cache is expired (> 5 minutes old)"""
    if _cache["timestamp"] is None:
        return True
    age = datetime.now() - _cache["timestamp"]
    return age.total_seconds() > CACHE_TTL_SECONDS


def parse_xmltv() -> List[Programme]:
    """
    Parse ErsatzTV XMLTV and return list of programmes.

    Fetches XMLTV from configured URL, parses programme data,
    and returns Programme objects. Results are cached for 5 minutes.

    Returns:
        List[Programme]: Parsed programmes from XMLTV

    Raises:
        Exception: If fetch fails and no cached data available
    """
    if not _is_cache_expired():
        logger.debug("Returning cached XMLTV data")
        return _cache["programmes"]

    try:
        logger.info("Fetching XMLTV from ErsatzTV")
        response = httpx.get(settings.ersatztv_xmltv_url, timeout=30)
        response.raise_for_status()

        programmes = _parse_xmltv_content(response.text)

        _cache["programmes"] = programmes
        _cache["timestamp"] = datetime.now()
        _cache["last_successful_fetch"] = datetime.now()

        logger.info(f"Parsed {len(programmes)} programmes from XMLTV")
        return programmes

    except Exception as e:
        logger.warning(f"Failed to fetch XMLTV: {e}")
        if _cache["last_successful_fetch"] is not None:
            logger.info("Returning stale cached data")
            return _cache["programmes"]
        raise Exception("Failed to load EPG from ErsatzTV")


def _parse_xmltv_content(content: str) -> List[Programme]:
    """Parse XMLTV content and extract programmes"""
    root = ElementTree.fromstring(content)
    programmes = []

    for elem in root.findall("programme"):
        try:
            channel_id = elem.get("channel")
            start_str = elem.get("start")
            stop_str = elem.get("stop")

            if not all([channel_id, start_str, stop_str]):
                continue

            start = _parse_xmltv_datetime(start_str)
            stop = _parse_xmltv_datetime(stop_str)

            title_elem = elem.find("title")
            if title_elem is None or not title_elem.text:
                continue
            title = title_elem.text

            desc_elem = elem.find("desc")
            description = desc_elem.text if desc_elem is not None else None

            category_elems = elem.findall("category")
            categories = [c.text for c in category_elems if c.text] or None

            programme_id = f"{channel_id}_{int(start.timestamp())}"

            programme = Programme(
                id=programme_id,
                channel_id=channel_id,
                title=title,
                description=description,
                start=start,
                stop=stop,
                category=categories
            )
            programmes.append(programme)

        except (ValueError, AttributeError) as e:
            logger.warning(f"Skipping programme: {e}")
            continue

    return programmes


def clear_cache() -> None:
    """Clear XMLTV cache, forcing re-fetch on next request"""
    _cache["timestamp"] = None
    logger.info("XMLTV cache cleared")
```

### Reference from Prototype

Port from `/home/jon/Code/iptv_viewer/app/epg/xmltv_parser.py`:
- `_parse_xmltv_datetime()` handles timezone offset conversion
- Extracts: channel, start, stop, title, desc, category
- Generates programme ID from channel_id + timestamp

### Sample XMLTV Format

```xml
<tv>
  <channel id="comedy-classics">
    <display-name>Comedy Classics</display-name>
  </channel>
  <programme start="20260103180000 +0000" stop="20260103200000 +0000" channel="comedy-classics">
    <title>Airplane!</title>
    <desc>Classic comedy film from 1980</desc>
    <category>Comedy</category>
    <category>Movie</category>
  </programme>
</tv>
```

### Project Structure Notes

New files:
- `backend/app/services/ersatztv/xmltv_parser.py` (new)
- `backend/app/services/ersatztv/xmltv_parser_test.py` (new)

### Testing Requirements

```python
def test_parse_xmltv_datetime_utc():
    """Parses UTC datetime correctly"""
    result = _parse_xmltv_datetime("20260103180000 +0000")
    assert result.tzinfo == timezone.utc
    assert result.hour == 18

def test_parse_xmltv_datetime_with_offset():
    """Converts non-UTC timezone to UTC"""
    result = _parse_xmltv_datetime("20260103180000 -0500")
    assert result.tzinfo == timezone.utc
    assert result.hour == 23  # 18:00 EST = 23:00 UTC

SAMPLE_XMLTV = """<?xml version="1.0"?>
<tv>
  <programme start="20260103180000 +0000" stop="20260103200000 +0000" channel="ch1">
    <title>Test Movie</title>
    <desc>A description</desc>
    <category>Drama</category>
  </programme>
</tv>
"""

def test_parse_xmltv_extracts_programmes():
    """Parser extracts programmes from XMLTV"""
    programmes = _parse_xmltv_content(SAMPLE_XMLTV)
    assert len(programmes) == 1
    assert programmes[0].title == "Test Movie"
    assert programmes[0].channel_id == "ch1"
    assert programmes[0].category == ["Drama"]
```

### Dependencies

Ensure `defusedxml` is installed (added in story 6.2)

### References

- [Source: /home/jon/Code/iptv_viewer/app/epg/xmltv_parser.py] - Prototype XMLTV parser
- [Source: backend/app/services/epg_service.py] - Existing EPG service (Dispatcharr)
- [Source: _bmad-output/project-context.md] - Datetime handling rules

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None

### Completion Notes List

- Implemented XMLTV parser service following existing m3u_parser.py pattern
- `_parse_xmltv_datetime()` handles XMLTV datetime format with timezone offset conversion to UTC
- `parse_xmltv()` fetches from configured URL with 5-minute TTL caching
- `_parse_xmltv_content()` extracts programme attributes using defusedxml for safe parsing
- Graceful handling of missing optional fields (description, category return as None)
- Stale cache returned on fetch failures when previously successful data exists
- Used standard logging module (consistent with m3u_parser.py) instead of loguru
- All 16 new tests pass covering datetime parsing, content extraction, caching, and error handling

### File List

- `backend/app/services/ersatztv/xmltv_parser.py` (new)
- `backend/tests/services/ersatztv/test_xmltv_parser.py` (new)

## Change Log

- 2026-01-03: Story 7.3 implemented - XMLTV parser service with 5-minute caching and UTC timezone conversion
