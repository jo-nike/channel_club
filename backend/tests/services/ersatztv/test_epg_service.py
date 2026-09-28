"""Tests for ErsatzTV EPG service layer.

Story: 7.4 - EPG Service Layer
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from app.models.ersatztv import EPGChannel, Programme
from app.services.ersatztv.xmltv_parser import guide


def _warm(programmes: list[Programme]) -> None:
    """Load programmes into the ErsatzTV guide as a fresh cache."""
    by_channel: dict[str, list[Programme]] = {}
    for programme in programmes:
        by_channel.setdefault(programme.channel_id, []).append(programme)
    guide._cache = {
        channel_id: sorted(channel_programmes, key=lambda p: p.start)
        for channel_id, channel_programmes in by_channel.items()
    }
    guide._cache_expires = datetime.now(UTC) + timedelta(minutes=5)


class TestGetChannels:
    """Tests for get_channels function (AC: #1)."""

    @patch("app.services.ersatztv.epg_service.parse_m3u_playlist")
    def test_get_channels_returns_list(self, mock_parse: MagicMock):
        """get_channels returns channel list from M3U."""
        mock_parse.return_value = [
            EPGChannel(id="ch1", name="Channel 1", stream_url="http://test.m3u8"),
            EPGChannel(id="ch2", name="Channel 2", stream_url="http://test2.m3u8"),
        ]

        from app.services.ersatztv.epg_service import get_channels

        result = get_channels()
        assert len(result) == 2
        assert result[0].id == "ch1"
        assert result[1].id == "ch2"

    @patch("app.services.ersatztv.epg_service.settings")
    @patch("app.services.ersatztv.epg_service.parse_m3u_playlist")
    def test_get_channels_rewrites_logo_urls(self, mock_parse: MagicMock, mock_settings: MagicMock):
        """get_channels rewrites ErsatzTV logo URLs to proxy endpoint."""
        mock_settings.ersatztv_base_url = "http://192.168.50.108:8409"
        mock_parse.return_value = [
            EPGChannel(
                id="ch1",
                name="Channel 1",
                stream_url="http://test.m3u8",
                logo_url="http://192.168.50.108:8409/logos/ch1.png",
            ),
        ]

        from app.services.ersatztv.epg_service import get_channels

        result = get_channels()
        assert result[0].logo_url == "/api/ersatztv/logos/ch1"
        assert result[0].original_logo_url == "http://192.168.50.108:8409/logos/ch1.png"

    @patch("app.services.ersatztv.epg_service.settings")
    @patch("app.services.ersatztv.epg_service.parse_m3u_playlist")
    def test_get_channels_preserves_external_logo_urls(
        self, mock_parse: MagicMock, mock_settings: MagicMock
    ):
        """get_channels does not rewrite non-ErsatzTV logo URLs."""
        mock_settings.ersatztv_base_url = "http://192.168.50.108:8409"
        mock_parse.return_value = [
            EPGChannel(
                id="ch1",
                name="Channel 1",
                stream_url="http://test.m3u8",
                logo_url="http://external.com/logo.png",
            ),
        ]

        from app.services.ersatztv.epg_service import get_channels

        result = get_channels()
        # External URLs should not be rewritten
        assert result[0].logo_url == "http://external.com/logo.png"
        assert result[0].original_logo_url is None


class TestGetChannelById:
    """Tests for get_channel_by_id function."""

    @patch("app.services.ersatztv.epg_service.parse_m3u_playlist")
    def test_get_channel_by_id_found(self, mock_parse: MagicMock):
        """get_channel_by_id returns channel when found."""
        mock_parse.return_value = [
            EPGChannel(id="ch1", name="Channel 1", stream_url="http://test.m3u8"),
            EPGChannel(id="ch2", name="Channel 2", stream_url="http://test2.m3u8"),
        ]

        from app.services.ersatztv.epg_service import get_channel_by_id

        result = get_channel_by_id("ch2")
        assert result is not None
        assert result.id == "ch2"
        assert result.name == "Channel 2"

    @patch("app.services.ersatztv.epg_service.parse_m3u_playlist")
    def test_get_channel_by_id_not_found(self, mock_parse: MagicMock):
        """get_channel_by_id returns None when channel not found."""
        mock_parse.return_value = [
            EPGChannel(id="ch1", name="Channel 1", stream_url="http://test.m3u8"),
        ]

        from app.services.ersatztv.epg_service import get_channel_by_id

        result = get_channel_by_id("nonexistent")
        assert result is None


class TestGetCurrentProgramme:
    """Tests for get_current_programme function (AC: #2)."""

    async def test_get_current_programme_finds_airing(self):
        """get_current_programme finds currently airing programme."""
        now = datetime.now(UTC)
        _warm(
            [
                Programme(
                    id="prog1",
                    channel_id="ch1",
                    title="Current Show",
                    start=now - timedelta(hours=1),
                    stop=now + timedelta(hours=1),
                ),
            ]
        )

        from app.services.ersatztv.epg_service import get_current_programme

        current, next_up = await get_current_programme("ch1")
        assert current is not None
        assert current.title == "Current Show"
        assert next_up is None

    async def test_get_current_programme_finds_next(self):
        """get_current_programme returns next programme."""
        now = datetime.now(UTC)
        _warm(
            [
                Programme(
                    id="prog1",
                    channel_id="ch1",
                    title="Current Show",
                    start=now - timedelta(hours=1),
                    stop=now + timedelta(minutes=30),
                ),
                Programme(
                    id="prog2",
                    channel_id="ch1",
                    title="Next Show",
                    start=now + timedelta(minutes=30),
                    stop=now + timedelta(hours=2),
                ),
            ]
        )

        from app.services.ersatztv.epg_service import get_current_programme

        current, next_up = await get_current_programme("ch1")
        assert current is not None
        assert current.title == "Current Show"
        assert next_up is not None
        assert next_up.title == "Next Show"

    async def test_get_current_programme_no_current(self):
        """get_current_programme returns None for current if none airing."""
        now = datetime.now(UTC)
        _warm(
            [
                Programme(
                    id="prog1",
                    channel_id="ch1",
                    title="Upcoming Show",
                    start=now + timedelta(hours=1),
                    stop=now + timedelta(hours=2),
                ),
            ]
        )

        from app.services.ersatztv.epg_service import get_current_programme

        current, next_up = await get_current_programme("ch1")
        assert current is None
        assert next_up is not None
        assert next_up.title == "Upcoming Show"

    async def test_get_current_programme_filters_by_channel(self):
        """get_current_programme filters by channel_id."""
        now = datetime.now(UTC)
        _warm(
            [
                Programme(
                    id="prog1",
                    channel_id="ch1",
                    title="Ch1 Show",
                    start=now - timedelta(hours=1),
                    stop=now + timedelta(hours=1),
                ),
                Programme(
                    id="prog2",
                    channel_id="ch2",
                    title="Ch2 Show",
                    start=now - timedelta(hours=1),
                    stop=now + timedelta(hours=1),
                ),
            ]
        )

        from app.services.ersatztv.epg_service import get_current_programme

        current, _ = await get_current_programme("ch2")
        assert current is not None
        assert current.title == "Ch2 Show"


class TestGetProgrammesByChannel:
    """Tests for get_programmes_by_channel function (AC: #3)."""

    async def test_get_programmes_respects_window(self):
        """get_programmes_by_channel filters by time window."""
        now = datetime.now(UTC)
        _warm(
            [
                Programme(
                    id="p1",
                    channel_id="ch1",
                    title="Soon",
                    start=now + timedelta(hours=1),
                    stop=now + timedelta(hours=2),
                ),
                Programme(
                    id="p2",
                    channel_id="ch1",
                    title="Later",
                    start=now + timedelta(hours=10),
                    stop=now + timedelta(hours=11),
                ),
            ]
        )

        from app.services.ersatztv.epg_service import get_programmes_by_channel

        result = await get_programmes_by_channel("ch1", hours=6)
        assert len(result) == 1
        assert result[0].title == "Soon"

    async def test_get_programmes_includes_current(self):
        """get_programmes_by_channel includes currently airing programme."""
        now = datetime.now(UTC)
        _warm(
            [
                Programme(
                    id="p1",
                    channel_id="ch1",
                    title="Current",
                    start=now - timedelta(hours=1),
                    stop=now + timedelta(minutes=30),
                ),
                Programme(
                    id="p2",
                    channel_id="ch1",
                    title="Next",
                    start=now + timedelta(minutes=30),
                    stop=now + timedelta(hours=2),
                ),
            ]
        )

        from app.services.ersatztv.epg_service import get_programmes_by_channel

        result = await get_programmes_by_channel("ch1", hours=6)
        assert len(result) == 2
        assert result[0].title == "Current"
        assert result[1].title == "Next"

    async def test_get_programmes_sorted_by_start(self):
        """get_programmes_by_channel returns programmes sorted by start time."""
        now = datetime.now(UTC)
        _warm(
            [
                Programme(
                    id="p2",
                    channel_id="ch1",
                    title="Second",
                    start=now + timedelta(hours=2),
                    stop=now + timedelta(hours=3),
                ),
                Programme(
                    id="p1",
                    channel_id="ch1",
                    title="First",
                    start=now + timedelta(hours=1),
                    stop=now + timedelta(hours=2),
                ),
            ]
        )

        from app.services.ersatztv.epg_service import get_programmes_by_channel

        result = await get_programmes_by_channel("ch1", hours=6)
        assert len(result) == 2
        assert result[0].title == "First"
        assert result[1].title == "Second"

    async def test_get_programmes_includes_recent_past(self):
        """get_programmes_by_channel keeps programmes that ended within the last hour."""
        now = datetime(2026, 9, 27, 13, 0, tzinfo=UTC)
        _warm(
            [
                Programme(
                    id="p1",
                    channel_id="ch1",
                    title="Current",
                    start=now - timedelta(minutes=20),
                    stop=now + timedelta(minutes=30),
                ),
                Programme(
                    id="p0",
                    channel_id="ch1",
                    title="Just Ended",
                    start=now - timedelta(minutes=50),
                    stop=now - timedelta(minutes=20),
                ),
                Programme(
                    id="p-1",
                    channel_id="ch1",
                    title="Long Gone",
                    start=now - timedelta(hours=3),
                    stop=now - timedelta(hours=2),
                ),
            ]
        )

        from app.services.ersatztv import epg_service

        with patch.object(epg_service, "datetime", wraps=datetime) as mock_datetime:
            mock_datetime.now.return_value = now
            result = await epg_service.get_programmes_by_channel("ch1", hours=6)

        assert [p.title for p in result] == ["Just Ended", "Current"]


class TestGetUpcomingProgrammes:
    """Tests for get_upcoming_programmes function."""

    async def test_get_upcoming_excludes_current(self):
        """get_upcoming_programmes excludes currently airing programme."""
        now = datetime.now(UTC)
        _warm(
            [
                Programme(
                    id="p1",
                    channel_id="ch1",
                    title="Current",
                    start=now - timedelta(hours=1),
                    stop=now + timedelta(minutes=30),
                ),
                Programme(
                    id="p2",
                    channel_id="ch1",
                    title="Next",
                    start=now + timedelta(minutes=30),
                    stop=now + timedelta(hours=2),
                ),
            ]
        )

        from app.services.ersatztv.epg_service import get_upcoming_programmes

        result = await get_upcoming_programmes("ch1", hours=6)
        assert len(result) == 1
        assert result[0].title == "Next"

    async def test_get_upcoming_respects_limit(self):
        """get_upcoming_programmes respects limit parameter."""
        now = datetime.now(UTC)
        _warm(
            [
                Programme(
                    id=f"p{i}",
                    channel_id="ch1",
                    title=f"Show {i}",
                    start=now + timedelta(hours=i),
                    stop=now + timedelta(hours=i + 1),
                )
                for i in range(1, 5)
            ]
        )

        from app.services.ersatztv.epg_service import get_upcoming_programmes

        result = await get_upcoming_programmes("ch1", hours=10, limit=2)
        assert len(result) == 2
        assert result[0].title == "Show 1"
        assert result[1].title == "Show 2"


def _scan_current(programmes: list[Programme], channel_id: str, now: datetime):
    """get_current_programme as it was: a scan over the whole feed."""
    current = next(
        (p for p in programmes if p.channel_id == channel_id and p.start <= now < p.stop), None
    )
    later = sorted(
        (p for p in programmes if p.channel_id == channel_id and p.start >= now),
        key=lambda p: p.start,
    )
    if current and later:
        return current, next((p for p in later if p.start >= current.stop), None)
    return current, later[0] if later else None


def _scan_window(programmes: list[Programme], channel_id: str, now: datetime, hours: int):
    start, end = now - timedelta(hours=1), now + timedelta(hours=hours)
    return sorted(
        (p for p in programmes if p.channel_id == channel_id and p.start < end and p.stop > start),
        key=lambda p: p.start,
    )


def _scan_upcoming(
    programmes: list[Programme], channel_id: str, now: datetime, hours: int, limit: int | None
):
    end = now + timedelta(hours=hours)
    upcoming = sorted(
        (p for p in programmes if p.channel_id == channel_id and now <= p.start < end),
        key=lambda p: p.start,
    )
    return upcoming[:limit] if limit else upcoming


class TestLookupsMatchTheScan:
    """The bisecting lookups answer as the old whole-feed scan did (D-06)."""

    BASE = datetime(2026, 9, 28, 10, 0, tzinfo=UTC)

    @classmethod
    def _programme(cls, channel_id: str, title: str, start: float, stop: float) -> Programme:
        return Programme(
            id=f"{channel_id}_{title}",
            channel_id=channel_id,
            title=title,
            start=cls.BASE + timedelta(hours=start),
            stop=cls.BASE + timedelta(hours=stop),
        )

    def _feed(self) -> list[Programme]:
        """Overlapping (Long holds Inside, Evening overlaps Late), adjacent and gapped."""
        return [
            self._programme("ch1", "Long", 0, 2),
            self._programme("ch1", "Inside", 1, 1.5),
            self._programme("ch1", "Adjacent", 2, 3),
            self._programme("ch1", "Evening", 2.5, 4),
            self._programme("ch1", "Late", 3.5, 4.5),
            self._programme("ch1", "Same start", 3.5, 3.75),
            self._programme("ch1", "After gap", 6, 7),
            self._programme("ch2", "Other channel", 0, 8),
        ]

    async def test_same_answers_as_the_scan_at_every_quarter_hour(self) -> None:
        from app.services.ersatztv import epg_service

        feed = self._feed()
        _warm(feed)
        times = [self.BASE + timedelta(minutes=15 * i) for i in range(-4, 40)]
        times += [p.start for p in feed] + [p.stop for p in feed]

        for now in times:
            with patch.object(epg_service, "datetime", wraps=datetime) as mock_datetime:
                mock_datetime.now.return_value = now
                current = await epg_service.get_current_programme("ch1")
                window = await epg_service.get_programmes_by_channel("ch1", hours=2)
                upcoming = await epg_service.get_upcoming_programmes("ch1", hours=3, limit=2)
                everything = await epg_service.get_upcoming_programmes("ch1", hours=3)

            assert current == _scan_current(feed, "ch1", now), now
            assert window == _scan_window(feed, "ch1", now, 2), now
            assert upcoming == _scan_upcoming(feed, "ch1", now, 3, 2), now
            assert everything == _scan_upcoming(feed, "ch1", now, 3, None), now


class TestRefreshAll:
    """Tests for refresh_all function."""

    @patch("app.services.ersatztv.epg_service.clear_xmltv_cache")
    @patch("app.services.ersatztv.epg_service.clear_m3u_cache")
    def test_refresh_all_clears_both_caches(
        self, mock_clear_m3u: MagicMock, mock_clear_xmltv: MagicMock
    ):
        """refresh_all clears both M3U and XMLTV caches."""
        from app.services.ersatztv.epg_service import refresh_all

        refresh_all()

        mock_clear_m3u.assert_called_once()
        mock_clear_xmltv.assert_called_once()


@pytest.fixture(autouse=True)
def synthetic_optional_catalog():
    with patch("app.services.ersatztv.epg_service.parse_m3u_playlist", return_value=[]):
        yield
