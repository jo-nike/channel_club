"""Tests for EPG service."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
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
        assert service._cache_expires is not None
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


class TestGetNowPlayingBulk:
    """Tests for get_now_playing_bulk functionality."""

    @pytest.mark.asyncio
    async def test_returns_on_air_program_per_channel(self) -> None:
        """Every channel with something airing is included."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        service._cache = {
            "channel-1": [
                Program(
                    title="Show One",
                    start_time=now - timedelta(minutes=30),
                    end_time=now + timedelta(minutes=30),
                ),
            ],
            "channel-2": [
                Program(
                    title="Show Two",
                    start_time=now - timedelta(minutes=10),
                    end_time=now + timedelta(minutes=50),
                ),
            ],
        }
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing_bulk()

        assert set(result) == {"channel-1", "channel-2"}
        assert result["channel-1"].title == "Show One"
        assert result["channel-2"].title == "Show Two"

    @pytest.mark.asyncio
    async def test_omits_channels_with_nothing_on_air(self) -> None:
        """Channels whose schedule has no current program are left out."""
        service = EPGService("http://test:9191")

        now = datetime.now(UTC)
        service._cache = {
            "channel-1": [
                Program(
                    title="On Air",
                    start_time=now - timedelta(minutes=30),
                    end_time=now + timedelta(minutes=30),
                ),
            ],
            "channel-2": [
                Program(
                    title="Later Today",
                    start_time=now + timedelta(hours=2),
                    end_time=now + timedelta(hours=3),
                ),
            ],
            "channel-3": [],
        }
        service._cache_expires = now + timedelta(hours=1)

        result = await service.get_now_playing_bulk()

        assert set(result) == {"channel-1"}

    @pytest.mark.asyncio
    async def test_returns_empty_dict_for_empty_cache(self) -> None:
        """A valid but empty cache yields no results rather than an error."""
        service = EPGService("http://test:9191")

        service._cache = {}
        service._cache_expires = datetime.now(UTC) + timedelta(hours=1)

        assert await service.get_now_playing_bulk() == {}

    @pytest.mark.asyncio
    async def test_raises_when_no_cache_and_refresh_fails(self) -> None:
        """Propagates EPGServiceError like the single-channel lookup does."""
        service = EPGService("http://test:9191")

        service._cache = {}
        service._cache_expires = None

        with (
            patch.object(service, "refresh_cache", new=AsyncMock(return_value=False)),
            pytest.raises(EPGServiceError),
        ):
            await service.get_now_playing_bulk()


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


HEALTH_XMLTV = """<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="ch-a">
    <title>A1</title>
  </programme>
  <programme start="20260103210000 +0000" stop="20260103220000 +0000" channel="ch-a">
    <title>A2</title>
  </programme>
  <programme start="20260103200000 +0000" stop="20260103210000 +0000" channel="ch-b">
    <title>B1</title>
  </programme>
</tv>
"""


def _raise(error: Exception) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error

    return handler


class _Upstream:
    """Mock XMLTV upstream that records how many requests reached it."""

    def __init__(self, handler: Callable[[httpx.Request], httpx.Response]) -> None:
        self.handler = handler
        self.requests = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests += 1
        return self.handler(request)


def _patch_upstream(monkeypatch: pytest.MonkeyPatch, upstream: _Upstream) -> None:
    factory = httpx.AsyncClient

    def client(**kwargs: Any) -> httpx.AsyncClient:
        return factory(transport=httpx.MockTransport(upstream), **kwargs)

    monkeypatch.setattr("app.services.epg_service.httpx.AsyncClient", client)


class TestHealth:
    """Tests for guide data health reporting."""

    @pytest.mark.asyncio
    async def test_health_after_403(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A refused XMLTV download reports the status code, not the URL."""
        upstream = _Upstream(lambda request: httpx.Response(403, text="Forbidden"))
        _patch_upstream(monkeypatch, upstream)
        service = EPGService("http://dispatcharr.synthetic:9191")

        before = datetime.now(UTC)
        health = await service.check_health()

        assert health.online is False
        assert health.stale is False
        assert health.error == "HTTP 403"
        assert health.channel_count == 0
        assert health.programme_count == 0
        assert health.last_success_at is None
        assert health.last_attempt_at is not None
        assert health.last_attempt_at >= before
        assert health.next_retry_at is not None
        assert health.next_retry_at - before >= timedelta(seconds=30)
        assert "dispatcharr.synthetic" not in health.model_dump_json()

    @pytest.mark.asyncio
    async def test_health_checks_wait_out_the_backoff(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Status polls during the backoff do not reach Dispatcharr."""
        upstream = _Upstream(lambda request: httpx.Response(403))
        _patch_upstream(monkeypatch, upstream)
        service = EPGService("http://dispatcharr.synthetic:9191")

        health = await service.check_health()
        for _ in range(2):
            health = await service.check_health()

        assert upstream.requests == 1
        assert health.error == "HTTP 403"

    @pytest.mark.asyncio
    async def test_health_after_success(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """A successful refresh reports counts and when it succeeded."""
        _patch_upstream(
            monkeypatch, _Upstream(lambda request: httpx.Response(200, text=HEALTH_XMLTV))
        )
        service = EPGService("http://dispatcharr.synthetic:9191")

        before = datetime.now(UTC)
        health = await service.check_health()

        assert health.online is True
        assert health.stale is False
        assert health.error is None
        assert health.channel_count == 2
        assert health.programme_count == 3
        assert health.last_success_at is not None
        assert health.last_success_at >= before
        assert health.next_retry_at is None
        dumped = health.model_dump(by_alias=True)
        assert dumped["channelCount"] == 2
        assert dumped["programmeCount"] == 3
        assert dumped["lastSuccessAt"] == health.last_success_at

    @pytest.mark.asyncio
    async def test_health_is_stale_when_refresh_fails_with_cached_data(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Expired guide data stays online but is flagged stale with the reason."""
        _patch_upstream(monkeypatch, _Upstream(lambda request: httpx.Response(403)))
        service = EPGService("http://dispatcharr.synthetic:9191")
        now = datetime.now(UTC)
        service._cache = {
            "ch-a": [Program(title="Old", start_time=now, end_time=now + timedelta(hours=1))]
        }
        service._cache_expires = now - timedelta(seconds=1)

        health = await service.check_health()

        assert health.online is True
        assert health.stale is True
        assert health.error == "HTTP 403"
        assert health.channel_count == 1
        assert health.programme_count == 1

    @pytest.mark.asyncio
    async def test_success_clears_previous_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Recovering from a failure clears the error and the retry deadline."""
        responses = iter([httpx.Response(403), httpx.Response(200, text=HEALTH_XMLTV)])
        _patch_upstream(monkeypatch, _Upstream(lambda request: next(responses)))
        service = EPGService("http://dispatcharr.synthetic:9191")

        assert (await service.check_health()).error == "HTTP 403"
        service._retry_at = datetime.now(UTC) - timedelta(seconds=1)
        health = await service.check_health()

        assert health.online is True
        assert health.error is None
        assert health.next_retry_at is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("handler", "reason"),
        [
            (_raise(httpx.ConnectError("refused")), "connection failed"),
            (_raise(httpx.ReadTimeout("slow")), "timeout"),
            (_raise(httpx.RemoteProtocolError("reset")), "request failed"),
            (lambda request: httpx.Response(200, text="<tv><broken"), "invalid XMLTV"),
        ],
    )
    async def test_health_reports_short_failure_reason(
        self,
        monkeypatch: pytest.MonkeyPatch,
        handler: Callable[[httpx.Request], httpx.Response],
        reason: str,
    ) -> None:
        """Each failure kind maps to a short reason without upstream details."""
        _patch_upstream(monkeypatch, _Upstream(handler))
        service = EPGService("http://dispatcharr.synthetic:9191")

        health = await service.check_health()

        assert health.online is False
        assert health.error == reason

    def test_get_health_does_not_refresh(self) -> None:
        """get_health reads local state only."""
        service = EPGService("http://dispatcharr.synthetic:9191")

        with patch.object(service, "refresh_cache", new=AsyncMock()) as refresh:
            health = service.get_health()

        refresh.assert_not_called()
        assert health.online is False
        assert health.last_attempt_at is None
