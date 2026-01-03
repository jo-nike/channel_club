"""EPG service for fetching and caching XMLTV data from Dispatcharr."""

import logging
from datetime import UTC, datetime, timedelta, timezone

import httpx
from defusedxml import ElementTree

from app.config import settings
from app.models.epg import EPGResponse, Program

logger = logging.getLogger(__name__)


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

    def _is_cache_valid(self) -> bool:
        """Check if cache is still valid."""
        if self._cache_expires is None:
            return False
        return datetime.now(UTC) < self._cache_expires

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
                    logger.warning(f"Failed to parse programme: {e}")
                    continue

            # Sort programs by start time for each channel
            for channel_id in programs_by_channel:
                programs_by_channel[channel_id].sort(key=lambda p: p.start_time)

        except ElementTree.ParseError as e:
            logger.error(f"Failed to parse XMLTV: {e}")
            raise EPGServiceError(f"Failed to parse XMLTV data: {e}") from e

        return programs_by_channel

    async def refresh_cache(self) -> bool:
        """Fetch XMLTV from Dispatcharr and parse into cache.

        Returns:
            True if cache was successfully refreshed, False otherwise.
        """
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(f"{self.dispatcharr_url}/xmltv.php")
                response.raise_for_status()

                self._cache = self._parse_xmltv(response.text)
                self._cache_expires = datetime.now(UTC) + self._cache_ttl

                logger.info(
                    f"EPG cache refreshed: {len(self._cache)} channels, "
                    f"expires {self._cache_expires.isoformat()}"
                )
                return True

        except httpx.HTTPError as e:
            logger.error(f"Failed to fetch XMLTV from Dispatcharr: {e}")
            return False
        except EPGServiceError:
            return False

    async def get_now_playing(self, channel_id: str) -> EPGResponse:
        """Get current and next program for a channel.

        Args:
            channel_id: UUID of the channel to look up.

        Returns:
            EPGResponse with current and next program info.

        Raises:
            EPGServiceError: If cache is empty and refresh fails.
        """
        # Check if cache needs refresh
        if not self._is_cache_valid():
            refresh_success = await self.refresh_cache()

            if not refresh_success:
                # If refresh failed but we have stale cache, use it
                if self._cache:
                    logger.warning("Using stale EPG cache after refresh failure")
                else:
                    raise EPGServiceError("EPG service unavailable")

        # Look up programs for channel
        programs = self._cache.get(channel_id, [])

        if not programs:
            return EPGResponse(
                channel_id=channel_id,
                current_program=None,
                next_program=None,
            )

        now = datetime.now(UTC)
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

        return EPGResponse(
            channel_id=channel_id,
            current_program=current_program,
            next_program=next_program,
        )


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
