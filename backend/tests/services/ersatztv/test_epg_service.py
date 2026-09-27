"""Tests for ErsatzTV EPG service layer.

Story: 7.4 - EPG Service Layer
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from app.models.ersatztv import EPGChannel, Programme


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

    @patch("app.services.ersatztv.epg_service.parse_xmltv")
    def test_get_current_programme_finds_airing(self, mock_parse: MagicMock):
        """get_current_programme finds currently airing programme."""
        now = datetime.now(UTC)
        mock_parse.return_value = [
            Programme(
                id="prog1",
                channel_id="ch1",
                title="Current Show",
                start=now - timedelta(hours=1),
                stop=now + timedelta(hours=1),
            ),
        ]

        from app.services.ersatztv.epg_service import get_current_programme

        current, next_up = get_current_programme("ch1")
        assert current is not None
        assert current.title == "Current Show"
        assert next_up is None

    @patch("app.services.ersatztv.epg_service.parse_xmltv")
    def test_get_current_programme_finds_next(self, mock_parse: MagicMock):
        """get_current_programme returns next programme."""
        now = datetime.now(UTC)
        mock_parse.return_value = [
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

        from app.services.ersatztv.epg_service import get_current_programme

        current, next_up = get_current_programme("ch1")
        assert current is not None
        assert current.title == "Current Show"
        assert next_up is not None
        assert next_up.title == "Next Show"

    @patch("app.services.ersatztv.epg_service.parse_xmltv")
    def test_get_current_programme_no_current(self, mock_parse: MagicMock):
        """get_current_programme returns None for current if none airing."""
        now = datetime.now(UTC)
        mock_parse.return_value = [
            Programme(
                id="prog1",
                channel_id="ch1",
                title="Upcoming Show",
                start=now + timedelta(hours=1),
                stop=now + timedelta(hours=2),
            ),
        ]

        from app.services.ersatztv.epg_service import get_current_programme

        current, next_up = get_current_programme("ch1")
        assert current is None
        assert next_up is not None
        assert next_up.title == "Upcoming Show"

    @patch("app.services.ersatztv.epg_service.parse_xmltv")
    def test_get_current_programme_filters_by_channel(self, mock_parse: MagicMock):
        """get_current_programme filters by channel_id."""
        now = datetime.now(UTC)
        mock_parse.return_value = [
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

        from app.services.ersatztv.epg_service import get_current_programme

        current, _ = get_current_programme("ch2")
        assert current is not None
        assert current.title == "Ch2 Show"


class TestGetProgrammesByChannel:
    """Tests for get_programmes_by_channel function (AC: #3)."""

    @patch("app.services.ersatztv.epg_service.parse_xmltv")
    def test_get_programmes_respects_window(self, mock_parse: MagicMock):
        """get_programmes_by_channel filters by time window."""
        now = datetime.now(UTC)
        mock_parse.return_value = [
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

        from app.services.ersatztv.epg_service import get_programmes_by_channel

        result = get_programmes_by_channel("ch1", hours=6)
        assert len(result) == 1
        assert result[0].title == "Soon"

    @patch("app.services.ersatztv.epg_service.parse_xmltv")
    def test_get_programmes_includes_current(self, mock_parse: MagicMock):
        """get_programmes_by_channel includes currently airing programme."""
        now = datetime.now(UTC)
        mock_parse.return_value = [
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

        from app.services.ersatztv.epg_service import get_programmes_by_channel

        result = get_programmes_by_channel("ch1", hours=6)
        assert len(result) == 2
        assert result[0].title == "Current"
        assert result[1].title == "Next"

    @patch("app.services.ersatztv.epg_service.parse_xmltv")
    def test_get_programmes_sorted_by_start(self, mock_parse: MagicMock):
        """get_programmes_by_channel returns programmes sorted by start time."""
        now = datetime.now(UTC)
        mock_parse.return_value = [
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

        from app.services.ersatztv.epg_service import get_programmes_by_channel

        result = get_programmes_by_channel("ch1", hours=6)
        assert len(result) == 2
        assert result[0].title == "First"
        assert result[1].title == "Second"

    @patch("app.services.ersatztv.epg_service.parse_xmltv")
    def test_get_programmes_includes_recent_past(self, mock_parse: MagicMock):
        """get_programmes_by_channel keeps programmes that ended within the last hour."""
        now = datetime(2026, 9, 27, 13, 0, tzinfo=UTC)
        mock_parse.return_value = [
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

        from app.services.ersatztv import epg_service

        with patch.object(epg_service, "datetime", wraps=datetime) as mock_datetime:
            mock_datetime.now.return_value = now
            result = epg_service.get_programmes_by_channel("ch1", hours=6)

        assert [p.title for p in result] == ["Just Ended", "Current"]


class TestGetUpcomingProgrammes:
    """Tests for get_upcoming_programmes function."""

    @patch("app.services.ersatztv.epg_service.parse_xmltv")
    def test_get_upcoming_excludes_current(self, mock_parse: MagicMock):
        """get_upcoming_programmes excludes currently airing programme."""
        now = datetime.now(UTC)
        mock_parse.return_value = [
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

        from app.services.ersatztv.epg_service import get_upcoming_programmes

        result = get_upcoming_programmes("ch1", hours=6)
        assert len(result) == 1
        assert result[0].title == "Next"

    @patch("app.services.ersatztv.epg_service.parse_xmltv")
    def test_get_upcoming_respects_limit(self, mock_parse: MagicMock):
        """get_upcoming_programmes respects limit parameter."""
        now = datetime.now(UTC)
        mock_parse.return_value = [
            Programme(
                id=f"p{i}",
                channel_id="ch1",
                title=f"Show {i}",
                start=now + timedelta(hours=i),
                stop=now + timedelta(hours=i + 1),
            )
            for i in range(1, 5)
        ]

        from app.services.ersatztv.epg_service import get_upcoming_programmes

        result = get_upcoming_programmes("ch1", hours=10, limit=2)
        assert len(result) == 2
        assert result[0].title == "Show 1"
        assert result[1].title == "Show 2"


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
