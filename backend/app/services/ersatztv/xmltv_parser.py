"""ErsatzTV XMLTV EPG parser

Parses XMLTV EPG data to extract programme schedules.
Implements 5-minute TTL caching with timezone-aware UTC conversion.

Story: 7.3 - XMLTV Parser Service
"""

from datetime import UTC, datetime, timedelta, timezone

import httpx
from defusedxml import ElementTree
from loguru import logger

from app.config import settings
from app.models.ersatztv import Programme

# Module-level logger with service context
log = logger.bind(service="ersatztv")

# Module-level cache
_cache: dict = {
    "programmes": [],
    "timestamp": None,
    "last_successful_fetch": None,
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

    Raises:
        ValueError: If datetime format is invalid
    """
    parts = dt_str.strip().split()
    if len(parts) != 2:
        raise ValueError(f"Invalid XMLTV datetime: {dt_str}")

    dt_part, tz_part = parts

    # Parse datetime components
    if len(dt_part) < 14:
        raise ValueError(f"Invalid XMLTV datetime: {dt_str}")

    year = int(dt_part[0:4])
    month = int(dt_part[4:6])
    day = int(dt_part[6:8])
    hour = int(dt_part[8:10])
    minute = int(dt_part[10:12])
    second = int(dt_part[12:14])

    # Parse timezone offset
    if len(tz_part) != 5 or tz_part[0] not in ("+", "-"):
        raise ValueError(f"Invalid timezone: {tz_part}")

    tz_sign = 1 if tz_part[0] == "+" else -1
    tz_hours = int(tz_part[1:3])
    tz_minutes = int(tz_part[3:5])
    tz_offset = timezone(timedelta(seconds=tz_sign * (tz_hours * 3600 + tz_minutes * 60)))

    # Create local datetime and convert to UTC
    dt_local = datetime(year, month, day, hour, minute, second, tzinfo=tz_offset)
    return dt_local.astimezone(UTC)


def _is_cache_expired() -> bool:
    """Check if cache is expired (> 5 minutes old)."""
    if _cache["timestamp"] is None:
        return True
    age = datetime.now() - _cache["timestamp"]
    return age.total_seconds() > CACHE_TTL_SECONDS


def parse_xmltv() -> list[Programme]:
    """
    Parse ErsatzTV XMLTV and return list of programmes.

    Fetches XMLTV from configured URL, parses programme data,
    and returns Programme objects. Results are cached for 5 minutes.

    Returns:
        List of Programme objects parsed from XMLTV

    Raises:
        Exception: If fetch fails and no cached data available
    """
    if not _is_cache_expired():
        log.debug("Cache hit for XMLTV data")
        return _cache["programmes"]

    log.debug("Cache miss for XMLTV data, fetching from {}", settings.ersatztv_xmltv_url)

    try:
        response = httpx.get(settings.ersatztv_xmltv_url, timeout=30)
        response.raise_for_status()

        programmes = _parse_xmltv_content(response.text)

        _cache["programmes"] = programmes
        _cache["timestamp"] = datetime.now()
        _cache["last_successful_fetch"] = datetime.now()

        log.info("Refreshed XMLTV cache: {} programmes parsed", len(programmes))
        return programmes

    except Exception as e:
        log.error("Failed to fetch XMLTV: {}", e)
        if _cache["last_successful_fetch"] is not None:
            log.warning("Returning stale XMLTV cached data after fetch failure")
            return _cache["programmes"]
        raise Exception("Failed to load EPG from ErsatzTV") from e


def _parse_xmltv_content(content: str) -> list[Programme]:
    """Parse XMLTV content and extract programmes."""
    root = ElementTree.fromstring(content)
    programmes = []

    for elem in root.findall("programme"):
        try:
            channel_id = elem.get("channel")
            start_str = elem.get("start")
            stop_str = elem.get("stop")

            if not channel_id or not start_str or not stop_str:
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

            # Parse episode number (xmltv_ns format: "season-1.episode-1.part-1", 0-indexed)
            season = None
            episode = None
            for ep_elem in elem.findall("episode-num"):
                system = ep_elem.get("system", "")
                text = ep_elem.text if ep_elem.text else ""
                if system == "xmltv_ns" and text:
                    parts = text.split(".")
                    if len(parts) >= 1 and parts[0].strip():
                        try:
                            season = int(parts[0].strip()) + 1
                        except ValueError:
                            pass
                    if len(parts) >= 2 and parts[1].strip():
                        try:
                            episode = int(parts[1].strip()) + 1
                        except ValueError:
                            pass

            # Parse release year
            date_elem = elem.find("date")
            year = date_elem.text.strip()[:4] if date_elem is not None and date_elem.text else None

            programme_id = f"{channel_id}_{int(start.timestamp())}"

            programme = Programme(
                id=programme_id,
                channel_id=channel_id,
                title=title,
                description=description,
                start=start,
                stop=stop,
                category=categories,
                season=season,
                episode=episode,
                year=year,
            )
            programmes.append(programme)

        except (ValueError, AttributeError) as e:
            log.warning("Skipping programme due to parse error: {}", e)
            continue

    return programmes


def clear_cache() -> None:
    """Clear XMLTV cache, forcing re-fetch on next request."""
    _cache["timestamp"] = None
    log.info("XMLTV cache cleared")
