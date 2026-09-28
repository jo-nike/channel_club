"""EPG service for fetching and caching XMLTV data from Dispatcharr."""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

import httpx
from defusedxml import DefusedXmlException, ElementTree
from loguru import logger

from app.config import settings
from app.models.channel import Channel
from app.models.epg import EPGProgrammesResponse, EPGResponse, Program
from app.services.bounded_http import FEED_BYTES, read_bounded
from app.services.cached_fetch import register_closable
from app.services.tls import SSL_CONTEXT
from app.services.xmltv_cache import (
    GuideIndex,
    XmltvCache,
    parse_xmltv_datetime,
    programme_title,
)

# Module-level logger with service context
log = logger.bind(service="epg")

# A schedule window keeps programmes that ended this recently, so the one just finished still shows
PROGRAMMES_LOOKBACK = timedelta(minutes=30)

EPG_HEALTH_NAME = "Guide data (XMLTV)"


def normalise_channel_name(name: str) -> str:
    """Normalise a channel name for matching: casefolded, whitespace collapsed."""
    return " ".join(name.split()).casefold()


class EPGServiceError(Exception):
    """Raised when EPG service encounters an error."""

    pass


class EPGService(XmltvCache[Program]):
    """Service for fetching and caching EPG data from Dispatcharr XMLTV endpoint."""

    def __init__(self, dispatcharr_url: str):
        self.dispatcharr_url = dispatcharr_url
        # The catalogue's guide ids at its last build, to notice a renumbering
        self._guide_ids: frozenset[str] | None = None
        super().__init__(
            name=EPG_HEALTH_NAME,
            fetch=self._fetch_xmltv,
            parse=self._index_xmltv,
            # A backstop: a renumbering in the catalogue expires the guide sooner
            ttl=timedelta(hours=4),
            start=lambda program: program.start_time,
            end=lambda program: program.end_time,
            unavailable=lambda: EPGServiceError("EPG service unavailable"),
            log=log,
        )

    def note_guide_ids(self, guide_ids: Iterable[str]) -> None:
        """Expire the guide when the channel catalogue's guide ids change.

        XMLTV is keyed by channel number, so after a renumbering the cached
        programmes would sit under the wrong channels until the next refresh.
        """
        ids = frozenset(guide_ids)
        previous, self._guide_ids = self._guide_ids, ids
        if previous is None or previous == ids:
            return
        now = datetime.now(UTC)
        if self._cache_expires is not None and self._cache_expires > now:
            log.info("Channel guide ids changed; expiring the EPG cache")
            self._cache_expires = now

    # The shared XMLTV timestamp parser (a missing offset means +0000)
    _parse_xmltv_datetime = staticmethod(parse_xmltv_datetime)

    def _parse_xmltv(
        self, xml_content: str | bytes
    ) -> tuple[dict[str, list[Program]], dict[str, str], dict[str, set[str]]]:
        """Parse XMLTV XML content into channel->programs and name<->channel mappings.

        Args:
            xml_content: Raw XML from Dispatcharr's /output/epg. Bytes are decoded
                by the parser, following the XML declaration's encoding.

        Returns:
            Tuple of (dict mapping channel_id to list of Program objects,
            dict mapping normalised display-name to channel_id, dict mapping
            channel_id to its normalised display names). When two channels
            share a display name, the first one in the feed wins the name map.
        """
        programs_by_channel: dict[str, list[Program]] = {}
        channel_names: dict[str, str] = {}
        display_names: dict[str, set[str]] = {}

        try:
            root = ElementTree.fromstring(xml_content)

            for channel in root.findall("channel"):
                xmltv_id = channel.get("id")
                if not xmltv_id:
                    continue
                for display_name in channel.findall("display-name"):
                    if display_name.text and display_name.text.strip():
                        name = normalise_channel_name(display_name.text)
                        channel_names.setdefault(name, xmltv_id)
                        display_names.setdefault(xmltv_id, set()).add(name)

            for programme in root.findall("programme"):
                channel_id = programme.get("channel")
                start_str = programme.get("start")
                stop_str = programme.get("stop")

                if not channel_id or not start_str or not stop_str:
                    continue

                title = programme_title(programme)

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

        except (ElementTree.ParseError, DefusedXmlException) as e:
            log.error("Failed to parse XMLTV: {}", e)
            raise EPGServiceError(f"Failed to parse XMLTV data: {e}") from e

        return programs_by_channel, channel_names, display_names

    async def _fetch_xmltv(self) -> bytes:
        """Download Dispatcharr's XMLTV feed."""
        url = f"{self.dispatcharr_url}/output/epg"
        log.debug("Fetching EPG data from {}", url)
        async with (
            httpx.AsyncClient(timeout=30.0, verify=SSL_CONTEXT) as client,
            client.stream("GET", url) as response,
        ):
            response.raise_for_status()
            # A byte budget and a body deadline, so a huge or slow-drip feed
            # can neither exhaust memory nor hold the refresh lock
            return await read_bounded(response, FEED_BYTES)

    def _index_xmltv(self, body: bytes) -> GuideIndex[Program]:
        return GuideIndex(*self._parse_xmltv(body))

    def reset(self) -> None:
        """Forget the guide, the backoff and the refresh task (tests: new event loop)."""
        super().reset()
        self._guide_ids = None

    def _resolve_programs(
        self, channel_id: str, channel_name: str | None
    ) -> tuple[list[Program], str | None]:
        """Find a channel's programmes by guide id, or by name when the id is wrong.

        The name is used when the guide id has no programmes, and also when the
        feed's display names for the guide id do not include the name while the
        name belongs to a different XMLTV channel: the feed's numbering then
        disagrees with the catalogue's. A name merely differing from the id's
        display names ('CBC' vs 'CBC HD') keeps the id.

        Args:
            channel_id: Guide id of the channel.
            channel_name: Optional channel name to match against XMLTV display names.

        Returns:
            Tuple of (programmes, XMLTV id matched by name). The XMLTV id is None
            unless the name was used.
        """
        programs = self._cache.get(channel_id, [])
        if not channel_name:
            return programs, None

        name = normalise_channel_name(channel_name)
        if programs:
            id_names = self._channel_display_names.get(channel_id)
            if not id_names or name in id_names:
                return programs, None

        xmltv_id = self._channel_names.get(name)
        if xmltv_id is None or xmltv_id == channel_id:
            return programs, None
        return self._cache.get(xmltv_id, []), xmltv_id

    async def get_now_playing(
        self, channel_id: str, channel_name: str | None = None
    ) -> EPGResponse:
        """Get current and next program for a channel.

        The guide id is tried first. The channel name is matched against the
        XMLTV display names when the id has no programmes or when the feed names
        the id as a different channel, which covers a feed keyed differently
        from the guide id (another tvg_id_source, or a profile's own channel
        numbering).

        Args:
            channel_id: Guide id of the channel to look up.
            channel_name: Optional channel name to fall back on.

        Returns:
            EPGResponse with current and next program info.

        Raises:
            EPGServiceError: If cache is empty and refresh fails.
        """
        await self._ensure_cache()

        programs, xmltv_id = self._resolve_programs(channel_id, channel_name)
        if xmltv_id is not None:
            log.debug(
                "Guide id {} resolved by channel name {!r} to XMLTV id {}",
                channel_id,
                channel_name,
                xmltv_id,
            )

        if not programs:
            return EPGResponse(
                channel_id=channel_id,
                current_program=None,
                next_program=None,
            )

        current_program, next_program = self.now_and_next(programs, datetime.now(UTC))

        return EPGResponse(
            channel_id=channel_id,
            current_program=current_program,
            next_program=next_program,
        )

    async def get_programmes(
        self, channel_id: str, hours: int, channel_name: str | None = None
    ) -> EPGProgrammesResponse:
        """Get a channel's schedule from 30 minutes ago to the given number of hours ahead.

        The channel is resolved like get_now_playing: guide id first, then the
        channel name against the XMLTV display names when the id has no
        programmes or the feed names it as a different channel.

        Args:
            channel_id: Guide id of the channel to look up.
            hours: How far ahead of now the window reaches.
            channel_name: Optional channel name to fall back on.

        Returns:
            EPGProgrammesResponse with the programmes that end after now minus
            30 minutes and start before now plus hours, in start order.

        Raises:
            EPGServiceError: If cache is empty and refresh fails.
        """
        await self._ensure_cache()

        programs, xmltv_id = self._resolve_programs(channel_id, channel_name)
        if xmltv_id is not None:
            log.debug(
                "Guide id {} resolved by channel name {!r} to XMLTV id {}",
                channel_id,
                channel_name,
                xmltv_id,
            )

        now = datetime.now(UTC)
        window_start = now - PROGRAMMES_LOOKBACK
        window_end = now + timedelta(hours=hours)
        in_window = self.in_window(programs, window_start, window_end)

        return EPGProgrammesResponse(channel_id=channel_id, programmes=in_window)

    async def get_now_playing_bulk(self, channels: Iterable[Channel] = ()) -> dict[str, Program]:
        """Get the on-air program for every channel in the EPG cache.

        The whole XMLTV feed is already cached in memory, so this is a scan over
        local data rather than one upstream call per channel.

        Each of the given catalogue channels is resolved first, the way
        get_now_playing resolves it (guide id, then its name against the XMLTV
        display names), so a feed keyed differently from the guide ids still
        yields the right entry under each channel's guide id. Raw XMLTV ids
        fill in only the keys no catalogue channel claims.

        Args:
            channels: Catalogue channels to key by guide id.

        Returns:
            Mapping of each given channel's guide id, and of every other XMLTV
            channel id, to its current program. Channels with nothing on air are
            omitted.

        Raises:
            EPGServiceError: If cache is empty and refresh fails.
        """
        await self._ensure_cache()

        now = datetime.now(UTC)
        now_playing: dict[str, Program] = {}
        claimed: set[str] = set()

        for channel in channels:
            claimed.add(channel.guide_id)
            programs, _ = self._resolve_programs(channel.guide_id, channel.name)
            current_program, _ = self.now_and_next(programs, now)
            if current_program is not None:
                now_playing[channel.guide_id] = current_program

        for channel_id, programs in self._cache.items():
            if channel_id in claimed:
                continue
            current_program, _ = self.now_and_next(programs, now)
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
        # Shut down and reset (tests) with the upstream caches
        register_closable(_epg_service)
    return _epg_service
