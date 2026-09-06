"""EPG service for fetching and caching XMLTV data from Dispatcharr."""

import asyncio
from datetime import UTC, datetime, timedelta, timezone

import httpx
from defusedxml import ElementTree
from loguru import logger

from app.config import settings
from app.models.epg import EPGResponse, Program

# Module-level logger with service context
log = logger.bind(service="epg")


class EPGServiceError(Exception):
    """Raised when EPG service encounters an error."""

    pass


class EPGService:
    """Service for fetching and caching EPG data from Dispatcharr XMLTV endpoint."""

    def __init__(self, dispatcharr_url: str):
        self.dispatcharr_url = dispatcharr_url
        self._cache: dict[str, list[Program]] = {}  # channel_id -> list of programs
        self._cache_expires: datetime | None = None
        self._cache_ttl = timedelta(hours=24)
        # A single in-flight lock prevents thundering herd on expiry
        self._refresh_lock = asyncio.Lock()
        self._retry_at: datetime | None = None

    def _is_cache_valid(self) -> bool:
        """Check if cache is still valid."""
        if self._cache_expires is None:
            log.debug("Cache miss: no expiry set")
            return False
        is_valid = datetime.now(UTC) < self._cache_expires
        if is_valid:
            age = (self._cache_expires - datetime.now(UTC)).total_seconds()
            log.debug("Cache hit for EPG data (expires in {}s)", int(age))
        else:
            log.debug("Cache miss: expired")
        return is_valid

    def _parse_xmltv_datetime(self, dt_str: str) -> datetime:
        """Parse XMLTV datetime format (YYYYMMDDHHmmss +ZZZZ).

        Args:
            dt_str: DateTime string like "20260103200000 +0000"

        Returns:
            Timezone-aware datetime object.
        """
        # Split datetime and timezone parts
        parts = dt_str.strip().split()
        dt_part = parts[0]
        tz_part = parts[1] if len(parts) > 1 else "+0000"

        # Parse the datetime part
        year = int(dt_part[0:4])
        month = int(dt_part[4:6])
        day = int(dt_part[6:8])
        hour = int(dt_part[8:10])
        minute = int(dt_part[10:12])
        second = int(dt_part[12:14]) if len(dt_part) >= 14 else 0

        # Parse timezone offset
        tz_sign = 1 if tz_part[0] == "+" else -1
        tz_hours = int(tz_part[1:3])
        tz_minutes = int(tz_part[3:5])
        tz_offset = timedelta(hours=tz_sign * tz_hours, minutes=tz_sign * tz_minutes)

        return datetime(year, month, day, hour, minute, second, tzinfo=timezone(tz_offset))

    def _parse_xmltv(self, xml_content: str) -> dict[str, list[Program]]:
        """Parse XMLTV XML content into channel->programs mapping.

        Args:
            xml_content: Raw XML string from Dispatcharr /xmltv.php

        Returns:
            Dict mapping channel_id to list of Program objects.
        """
        programs_by_channel: dict[str, list[Program]] = {}

        try:
            root = ElementTree.fromstring(xml_content)

            for programme in root.findall("programme"):
                channel_id = programme.get("channel")
                start_str = programme.get("start")
                stop_str = programme.get("stop")

                if not channel_id or not start_str or not stop_str:
                    continue

                title_elem = programme.find("title")
                title = title_elem.text if title_elem is not None else "Unknown"

                desc_elem = programme.find("desc")
                description = desc_elem.text if desc_elem is not None else None

                try:
                    program = Program(
                        title=title,
                        start_time=self._parse_xmltv_datetime(start_str),
                        end_time=self._parse_xmltv_datetime(stop_str),
                        description=description,
                    )

                    if channel_id not in programs_by_channel:
                        programs_by_channel[channel_id] = []
                    programs_by_channel[channel_id].append(program)
                except (ValueError, IndexError) as e:
                    log.warning("Failed to parse programme: {}", e)
                    continue

            # Sort programs by start time for each channel
            for channel_id in programs_by_channel:
                programs_by_channel[channel_id].sort(key=lambda p: p.start_time)

        except ElementTree.ParseError as e:
            log.error("Failed to parse XMLTV: {}", e)
            raise EPGServiceError(f"Failed to parse XMLTV data: {e}") from e

        return programs_by_channel

    async def refresh_cache(self) -> bool:
        """Fetch XMLTV from Dispatcharr and parse into cache.

        Returns:
            True if cache was successfully refreshed, False otherwise.
        """
        url = f"{self.dispatcharr_url}/output/epg"
        log.debug("Fetching EPG data from {}", url)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(url)
                response.raise_for_status()

                # Parse in a thread pool - ElementTree over the whole XMLTV
                # feed is CPU-bound and would otherwise block the event loop
                self._cache = await asyncio.to_thread(self._parse_xmltv, response.text)
                self._cache_expires = datetime.now(UTC) + self._cache_ttl

                total_programmes = sum(len(progs) for progs in self._cache.values())
                log.info(
                    "Refreshed EPG cache: {} channels, {} programmes",
                    len(self._cache),
                    total_programmes,
                )
                return True

        except httpx.HTTPStatusError as e:
            log.error("XMLTV HTTP error from {}: {} - {}", url, e.response.status_code, e)
            return False
        except httpx.ConnectError as e:
            log.error("Failed to connect to Dispatcharr at {}: {}", url, e)
            return False
        except httpx.TimeoutException as e:
            log.error("Timeout fetching XMLTV from {}: {}", url, e)
            return False
        except httpx.HTTPError as e:
            log.error("Failed to fetch XMLTV from {}: {}", url, e)
            return False
        except EPGServiceError as e:
            log.error("Failed to parse XMLTV data: {}", e)
            return False

    async def _ensure_cache(self) -> None:
        """Refresh the cache if stale, falling back to stale data on failure.

        The refresh is serialized behind a lock so that concurrent requests
        hitting an expired cache share one XMLTV download and parse.

        Raises:
            EPGServiceError: If cache is empty and refresh fails.
        """
        if self._is_cache_valid():
            return

        async with self._refresh_lock:
            # Re-check after acquiring the lock (another request may have refreshed)
            if self._is_cache_valid():
                return

            if self._retry_at is not None and datetime.now(UTC) < self._retry_at:
                if self._cache:
                    return
                raise EPGServiceError("EPG service unavailable; retry later")
            refresh_success = await self.refresh_cache()
            self._retry_at = None if refresh_success else datetime.now(UTC) + timedelta(seconds=5)

        if not refresh_success:
            # If refresh failed but we have stale cache, use it
            if self._cache:
                log.warning("Using stale EPG cache after refresh failure")
            else:
                raise EPGServiceError("EPG service unavailable")

    def _find_current_and_next(
        self, programs: list[Program], now: datetime
    ) -> tuple[Program | None, Program | None]:
        """Find the on-air program and the one following it.

        Args:
            programs: Programs for a single channel, sorted by start time.
            now: Timezone-aware reference time.

        Returns:
            Tuple of (current program, next program), either of which may be None.
        """
        current_program: Program | None = None
        next_program: Program | None = None

        for i, program in enumerate(programs):
            # Convert to UTC for comparison if needed
            start = program.start_time
            end = program.end_time
            if start.tzinfo != UTC:
                start = start.astimezone(UTC)
            if end.tzinfo != UTC:
                end = end.astimezone(UTC)

            if start <= now < end:
                current_program = program
                # Get next program if available
                if i + 1 < len(programs):
                    next_program = programs[i + 1]
                break
            elif start > now and next_program is None:
                # This is the next upcoming program
                next_program = program
                break

        return current_program, next_program

    async def get_now_playing(self, channel_id: str) -> EPGResponse:
        """Get current and next program for a channel.

        Args:
            channel_id: UUID of the channel to look up.

        Returns:
            EPGResponse with current and next program info.

        Raises:
            EPGServiceError: If cache is empty and refresh fails.
        """
        await self._ensure_cache()

        # Look up programs for channel
        programs = self._cache.get(channel_id, [])

        if not programs:
            return EPGResponse(
                channel_id=channel_id,
                current_program=None,
                next_program=None,
            )

        current_program, next_program = self._find_current_and_next(programs, datetime.now(UTC))

        return EPGResponse(
            channel_id=channel_id,
            current_program=current_program,
            next_program=next_program,
        )

    async def get_now_playing_bulk(self) -> dict[str, Program]:
        """Get the on-air program for every channel in the EPG cache.

        The whole XMLTV feed is already cached in memory, so this is a scan over
        local data rather than one upstream call per channel.

        Returns:
            Mapping of channel_id to its current program. Channels with nothing
            on air are omitted.

        Raises:
            EPGServiceError: If cache is empty and refresh fails.
        """
        await self._ensure_cache()

        now = datetime.now(UTC)
        now_playing: dict[str, Program] = {}

        for channel_id, programs in self._cache.items():
            current_program, _ = self._find_current_and_next(programs, now)
            if current_program is not None:
                now_playing[channel_id] = current_program

        log.debug("Bulk now-playing: {} of {} channels on air", len(now_playing), len(self._cache))
        return now_playing


# Global singleton instance
_epg_service: EPGService | None = None


def get_epg_service() -> EPGService:
    """Get or create the EPG service singleton.

    Returns:
        EPGService instance configured with Dispatcharr URL.
    """
    global _epg_service
    if _epg_service is None:
        _epg_service = EPGService(settings.dispatcharr_url)
    return _epg_service
