"""Tests for EPG service."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.models.epg import Program
from app.services.epg_service import EPGService, EPGServiceError


class TestParseXmltvDatetime:
    """Tests for XMLTV datetime parsing."""

    def test_parse_standard_format(self) -> None:
        """Parse standard XMLTV datetime with timezone."""
        service = EPGService("http://test:9191")
        result = service._parse_xmltv_datetime("20260103200000 +0000")

        assert result.year == 2026
        assert result.month == 1
        assert result.day == 3
        assert result.hour == 20
        assert result.minute == 0
        assert result.second == 0

    def test_parse_with_positive_offset(self) -> None:
        """Parse datetime with positive timezone offset."""
        service = EPGService("http://test:9191")
        result = service._parse_xmltv_datetime("20260103200000 +0530")

        assert result.utcoffset() == timedelta(hours=5, minutes=30)

    def test_parse_with_negative_offset(self) -> None:
        """Parse datetime with negative timezone offset."""
        service = EPGService("http://test:9191")
        result = service._parse_xmltv_datetime("20260103200000 -0500")

        assert result.utcoffset() == timedelta(hours=-5)


class TestParseXmltv:
    """Tests for XMLTV XML parsing."""

    def test_parse_single_programme(self) -> None:
        """Parse XMLTV with single programme."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <channel id="uuid-abc123">
            <display-name>Test Channel</display-name>
          </channel>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="uuid-abc123">
            <title>Test Program</title>
            <desc>Test description</desc>
          </programme>
        </tv>
        """

        result = service._parse_xmltv(xml_content)

        assert "uuid-abc123" in result
        assert len(result["uuid-abc123"]) == 1
        program = result["uuid-abc123"][0]
        assert program.title == "Test Program"
        assert program.description == "Test description"

    def test_parse_multiple_programmes(self) -> None:
        """Parse XMLTV with multiple programmes on same channel."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="uuid-abc123">
            <title>Program 1</title>
          </programme>
          <programme start="20260103210000 +0000" stop="20260103220000 +0000" channel="uuid-abc123">
            <title>Program 2</title>
          </programme>
        </tv>
        """

        result = service._parse_xmltv(xml_content)

        assert len(result["uuid-abc123"]) == 2
        # Programs should be sorted by start time
        assert result["uuid-abc123"][0].title == "Program 1"
        assert result["uuid-abc123"][1].title == "Program 2"

    def test_parse_multiple_channels(self) -> None:
        """Parse XMLTV with programmes on different channels."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="channel-1">
            <title>Channel 1 Program</title>
          </programme>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="channel-2">
            <title>Channel 2 Program</title>
          </programme>
        </tv>
        """

        result = service._parse_xmltv(xml_content)

        assert "channel-1" in result
        assert "channel-2" in result
        assert result["channel-1"][0].title == "Channel 1 Program"
        assert result["channel-2"][0].title == "Channel 2 Program"

    def test_parse_programme_without_description(self) -> None:
        """Parse programme with no description element."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="uuid-abc123">
            <title>Title Only</title>
          </programme>
        </tv>
        """

        result = service._parse_xmltv(xml_content)

        assert result["uuid-abc123"][0].description is None

    def test_parse_empty_tv_element(self) -> None:
        """Parse empty TV element returns empty dict."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
        </tv>
        """

        result = service._parse_xmltv(xml_content)

        assert result == {}

    def test_parse_invalid_xml_raises_error(self) -> None:
        """Invalid XML raises EPGServiceError."""
        service = EPGService("http://test:9191")

        with pytest.raises(EPGServiceError, match="Failed to parse XMLTV"):
            service._parse_xmltv("not valid xml")

    def test_parse_skips_programme_missing_channel(self) -> None:
        """Programmes without channel attribute are skipped."""
        service = EPGService("http://test:9191")
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000">
            <title>No Channel</title>
          </programme>
        </tv>
        """

        result = service._parse_xmltv(xml_content)

        assert result == {}


class TestRefreshCache:
    """Tests for cache refresh functionality."""

    @pytest.mark.asyncio
    async def test_refresh_cache_success(self) -> None:
        """Successful cache refresh stores parsed data."""
        service = EPGService("http://test:9191")

        xml_response = """<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="uuid-abc123">
            <title>Test Program</title>
          </programme>
        </tv>
        """

        mock_response = MagicMock()
        mock_response.text = xml_response
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.epg_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            result = await service.refresh_cache()

        assert result is True
        assert "uuid-abc123" in service._cache
        assert service._cache_expires is not None

    @pytest.mark.asyncio
    async def test_refresh_cache_sets_24h_expiry(self) -> None:
        """Cache expiry is set to 24 hours from now."""
        service = EPGService("http://test:9191")

        mock_response = MagicMock()
        mock_response.text = "<tv></tv>"
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.epg_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            before = datetime.now(UTC)
            await service.refresh_cache()
            after = datetime.now(UTC)

        expected_min = before + timedelta(hours=24)
        expected_max = after + timedelta(hours=24)
        assert expected_min <= service._cache_expires <= expected_max

    @pytest.mark.asyncio
    async def test_refresh_cache_connection_error_returns_false(self) -> None:
        """Connection error returns False without raising."""
        service = EPGService("http://test:9191")

        with patch("app.services.epg_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.ConnectError("Connection refused")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            result = await service.refresh_cache()

        assert result is False

    @pytest.mark.asyncio
    async def test_refresh_cache_timeout_returns_false(self) -> None:
        """Timeout returns False without raising."""
        service = EPGService("http://test:9191")

        with patch("app.services.epg_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.TimeoutException("Timeout")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            result = await service.refresh_cache()

        assert result is False

    @pytest.mark.asyncio
    async def test_refresh_cache_calls_correct_endpoint(self) -> None:
        """Refresh calls /output/epg endpoint."""
        service = EPGService("http://dispatcharr:9191")

        mock_response = MagicMock()
        mock_response.text = "<tv></tv>"
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.epg_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            await service.refresh_cache()

        mock_client.get.assert_called_once_with("http://dispatcharr:9191/output/epg")


class TestGetNowPlaying:
    """Tests for get_now_playing functionality."""

    @pytest.mark.asyncio
    async def test_get_now_playing_with_current_program(self) -> None:
        """Returns current program when one is airing."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        programs = [
            Program(
                title="Current Show",
                start_time=now - timedelta(minutes=30),
                end_time=now + timedelta(minutes=30),
                description="Currently airing",
            ),
            Program(
                title="Next Show",
                start_time=now + timedelta(minutes=30),
                end_time=now + timedelta(hours=1, minutes=30),
            ),
        ]

        service._cache = {"channel-1": programs}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing("channel-1")

        assert result.channel_id == "channel-1"
        assert result.current_program is not None
        assert result.current_program.title == "Current Show"
        assert result.next_program is not None
        assert result.next_program.title == "Next Show"

    @pytest.mark.asyncio
    async def test_get_now_playing_no_current_program(self) -> None:
        """Returns next program when nothing is currently airing."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        programs = [
            Program(
                title="Upcoming Show",
                start_time=now + timedelta(hours=1),
                end_time=now + timedelta(hours=2),
            ),
        ]

        service._cache = {"channel-1": programs}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing("channel-1")

        assert result.current_program is None
        assert result.next_program is not None
        assert result.next_program.title == "Upcoming Show"

    @pytest.mark.asyncio
    async def test_get_now_playing_unknown_channel(self) -> None:
        """Returns null programs for unknown channel."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        service._cache = {}
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing("unknown-channel")

        assert result.channel_id == "unknown-channel"
        assert result.current_program is None
        assert result.next_program is None

    @pytest.mark.asyncio
    async def test_get_now_playing_refreshes_stale_cache(self) -> None:
        """Refreshes cache when expired before returning data."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        # Set cache as expired
        service._cache = {}
        service._cache_expires = now - timedelta(hours=1)

        xml_response = f"""<?xml version="1.0" encoding="UTF-8"?>
        <tv>
          <programme start="{(now - timedelta(minutes=30)).strftime("%Y%m%d%H%M%S")} +0000"
                     stop="{(now + timedelta(minutes=30)).strftime("%Y%m%d%H%M%S")} +0000"
                     channel="channel-1">
            <title>Fresh Program</title>
          </programme>
        </tv>
        """

        mock_response = MagicMock()
        mock_response.text = xml_response
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.epg_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            result = await service.get_now_playing("channel-1")

        assert result.current_program is not None
        assert result.current_program.title == "Fresh Program"

    @pytest.mark.asyncio
    async def test_get_now_playing_uses_stale_cache_on_refresh_failure(self) -> None:
        """Uses stale cache when refresh fails."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        stale_programs = [
            Program(
                title="Stale Program",
                start_time=now - timedelta(minutes=30),
                end_time=now + timedelta(minutes=30),
            ),
        ]

        # Set cache as expired but with data
        service._cache = {"channel-1": stale_programs}
        service._cache_expires = now - timedelta(hours=1)

        with patch("app.services.epg_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.ConnectError("Connection refused")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            result = await service.get_now_playing("channel-1")

        assert result.current_program is not None
        assert result.current_program.title == "Stale Program"

    @pytest.mark.asyncio
    async def test_get_now_playing_raises_when_no_cache_and_refresh_fails(self) -> None:
        """Raises error when refresh fails and no cache exists."""
        service = EPGService("http://test:9191")

        # No cache at all
        service._cache = {}
        service._cache_expires = None

        with patch("app.services.epg_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.ConnectError("Connection refused")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with pytest.raises(EPGServiceError, match="EPG service unavailable"):
                await service.get_now_playing("channel-1")


class TestCacheValidity:
    """Tests for cache validity checking."""

    def test_cache_valid_when_not_expired(self) -> None:
        """Cache is valid when expiry is in the future."""
        service = EPGService("http://test:9191")
        service._cache_expires = datetime.now(UTC) + timedelta(hours=1)

        assert service._is_cache_valid() is True

    def test_cache_invalid_when_expired(self) -> None:
        """Cache is invalid when expiry is in the past."""
        service = EPGService("http://test:9191")
        service._cache_expires = datetime.now(UTC) - timedelta(hours=1)

        assert service._is_cache_valid() is False

    def test_cache_invalid_when_never_set(self) -> None:
        """Cache is invalid when never initialized."""
        service = EPGService("http://test:9191")

        assert service._is_cache_valid() is False
