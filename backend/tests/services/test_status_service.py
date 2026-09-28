"""Tests for status service."""

from collections.abc import Callable
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.models.status import DispatchrrStatus, EPGHealthStatus, ErsatzTVStatus
from app.services import status_service
from app.services.dispatcharr import DispatchrrUnavailableError
from app.services.epg_service import EPGService
from app.services.status_service import (
    get_dispatcharr_status,
    get_epg_status,
    get_ersatztv_status,
    get_system_status,
)


def _epg_health(**overrides: object) -> EPGHealthStatus:
    fields: dict[str, object] = {
        "name": "Guide data (XMLTV)",
        "online": True,
        "last_checked": datetime.now(UTC),
        "channel_count": 109,
        "programme_count": 5065,
    }
    fields.update(overrides)
    return EPGHealthStatus.model_validate(fields)


@pytest.fixture(autouse=True)
def stub_epg_status(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep system status tests off the shared EPG singleton and its XMLTV download."""
    monkeypatch.setattr(status_service, "get_epg_status", AsyncMock(return_value=_epg_health()))


class TestGetErsatzTVStatus:
    """Tests for get_ersatztv_status function."""

    @pytest.mark.asyncio
    async def test_returns_online_status_with_sessions(self) -> None:
        """Should return online status with active sessions and enriched data."""
        sessions_data = [
            {
                "channelNumber": "1",
                "state": "SeekAndWorkAhead",
                "transcodedUntil": "2026-01-05T01:10:00+00:00",
            },
            {"channelNumber": "2", "state": "Playing"},
        ]
        channels_data = [
            {
                "number": 1,
                "name": "Movies",
                "ffmpegProfile": "1080 h264",
                "streamingMode": "HLS Segmenter",
            },
            {"number": 2, "name": "Sports", "ffmpegProfile": "720p", "streamingMode": "MPEG-TS"},
        ]
        profiles_data = [
            {
                "name": "1080 h264",
                "resolution": "1920x1080",
                "videoFormat": "H264",
                "videoBitrate": 2000,
                "audioFormat": "Aac",
                "audioBitrate": 192,
            },
            {
                "name": "720p",
                "resolution": "1280x720",
                "videoFormat": "H264",
                "videoBitrate": 1500,
                "audioFormat": "Ac3",
                "audioBitrate": 128,
            },
        ]

        with patch(
            "app.services.status_service._fetch_ersatztv_data",
            return_value=(sessions_data, channels_data, profiles_data, None),
        ):
            status = await get_ersatztv_status()

        assert status.name == "ErsatzTV"
        assert status.online is True
        assert status.active_sessions == 2
        assert len(status.sessions) == 2
        assert status.sessions[0].channel_number == 1
        assert status.sessions[0].channel_name == "Movies"
        assert status.sessions[0].state == "SeekAndWorkAhead"
        assert status.sessions[0].resolution == "1920x1080"
        assert status.sessions[0].video_codec == "H264"
        assert status.sessions[0].video_bitrate == 2000
        assert status.sessions[0].streaming_mode == "HLS Segmenter"
        assert status.error is None

    @pytest.mark.asyncio
    async def test_returns_online_status_with_empty_sessions(self) -> None:
        """Should return online status with no active sessions."""
        with patch(
            "app.services.status_service._fetch_ersatztv_data",
            return_value=([], [], [], None),
        ):
            status = await get_ersatztv_status()

        assert status.name == "ErsatzTV"
        assert status.online is True
        assert status.active_sessions == 0
        assert status.sessions == []

    @pytest.mark.asyncio
    async def test_returns_offline_on_connection_error(self) -> None:
        """Should return offline status when sessions fetch fails and base URL unreachable."""
        with (
            patch(
                "app.services.status_service._fetch_ersatztv_data",
                # sessions is None = fetch failed
                return_value=(None, [], [], "sessions API connection failed"),
            ),
            patch("app.services.status_service.httpx.AsyncClient") as mock_client_class,
        ):
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.ConnectError("Connection refused")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            status = await get_ersatztv_status()

        assert status.name == "ErsatzTV"
        assert status.online is False
        assert status.error is not None

    @pytest.mark.asyncio
    async def test_returns_offline_on_timeout(self) -> None:
        """Should return offline status when request times out."""
        with (
            patch(
                "app.services.status_service._fetch_ersatztv_data",
                return_value=(None, [], [], "sessions API timeout"),
            ),
            patch("app.services.status_service.httpx.AsyncClient") as mock_client_class,
        ):
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.TimeoutException("Request timed out")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            status = await get_ersatztv_status()

        assert status.name == "ErsatzTV"
        assert status.online is False
        assert status.error is not None

    @pytest.mark.asyncio
    async def test_handles_partial_api_failures(self) -> None:
        """Should still work when channels/profiles endpoints fail."""
        sessions_data = [{"channelNumber": "1", "state": "Playing"}]

        # Sessions succeeds, channels and profiles return empty (simulating 404)
        with patch(
            "app.services.status_service._fetch_ersatztv_data",
            return_value=(sessions_data, [], [], None),
        ):
            status = await get_ersatztv_status()

        assert status.name == "ErsatzTV"
        assert status.online is True
        assert status.active_sessions == 1
        # Session exists but without enriched data
        assert status.sessions[0].channel_number == 1
        assert status.sessions[0].resolution is None


class TestGetDispatchrrStatus:
    """Tests for get_dispatcharr_status function."""

    @pytest.mark.asyncio
    async def test_returns_online_status_with_streams(self) -> None:
        """Should return online status with stream info from proxy status."""
        # Mock proxy status response
        proxy_status_response = {
            "channels": [
                {
                    "channel_id": "abc123",
                    "stream_name": "Sports HD",
                    "state": "active",
                    "client_count": 2,
                    "uptime": 300.5,
                    "total_bytes": 50000000,
                    "avg_bitrate": "5.5 Mbps",
                    "video_codec": "h264",
                    "resolution": "1920x1080",
                    "source_fps": 60.0,
                    "clients": [
                        {
                            "client_id": "c1",
                            "user_agent": "Chrome",
                            "ip_address": "1.2.3.4",
                            "connected_since": 100,
                        },
                        {
                            "client_id": "c2",
                            "user_agent": "Firefox",
                            "ip_address": "5.6.7.8",
                            "connected_since": 50,
                        },
                    ],
                },
                {
                    "channel_id": "def456",
                    "stream_name": "Movies",
                    "state": "active",
                    "client_count": 1,
                    "uptime": 60.0,
                    "total_bytes": 10000000,
                    "avg_bitrate": "3.0 Mbps",
                    "video_codec": "h264",
                    "resolution": "1280x720",
                    "source_fps": 30.0,
                    "clients": [
                        {
                            "client_id": "c3",
                            "user_agent": "Safari",
                            "ip_address": "9.10.11.12",
                            "connected_since": 30,
                        },
                    ],
                },
            ],
            "count": 2,
        }
        status_response = MagicMock()
        status_response.json.return_value = proxy_status_response
        status_response.raise_for_status = MagicMock()

        with patch("app.services.status_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            # Only one call now: the authenticated proxy status GET
            mock_client.get.return_value = status_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with (
                patch("app.services.status_service.settings") as mock_settings,
                patch("app.services.dispatcharr.settings") as mock_dispatcharr_settings,
            ):
                mock_settings.dispatcharr_url = "http://test:9191"
                mock_dispatcharr_settings.dispatcharr_api_key = "test-api-key"

                status = await get_dispatcharr_status()

        assert status.name == "Dispatcharr"
        assert status.online is True
        assert status.active_streams == 2
        assert status.total_viewers == 3
        assert len(status.streams) == 2
        assert status.streams[0].stream_name == "Sports HD"
        assert status.streams[0].client_count == 2
        assert status.streams[0].resolution == "1920x1080"
        assert status.error is None

    @pytest.mark.asyncio
    async def test_returns_offline_on_connection_error(self) -> None:
        """Should return offline status when connection fails."""
        with patch("app.services.status_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.ConnectError("Connection refused")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            status = await get_dispatcharr_status()

        assert status.name == "Dispatcharr"
        assert status.online is False
        assert status.error is not None

    @pytest.mark.asyncio
    async def test_falls_back_to_lineup_when_no_api_key(self) -> None:
        """Should fall back to lineup check when no API key is configured."""
        # Mock lineup response (no auth required)
        mock_lineup_response = MagicMock()
        mock_lineup_response.status_code = 200

        with patch("app.services.status_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_lineup_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with (
                patch("app.services.status_service.settings") as mock_settings,
                patch("app.services.dispatcharr.settings") as mock_dispatcharr_settings,
            ):
                mock_settings.dispatcharr_url = "http://test:9191"
                mock_dispatcharr_settings.dispatcharr_api_key = None

                status = await get_dispatcharr_status()

        assert status.name == "Dispatcharr"
        assert status.online is True
        assert status.active_streams == 0
        assert status.error == "Auth required for stats"


class TestGetSystemStatus:
    """Tests for get_system_status function."""

    @pytest.mark.asyncio
    async def test_returns_combined_status(self) -> None:
        """Should return status for both services."""
        mock_ersatztv = ErsatzTVStatus(
            name="ErsatzTV",
            online=True,
            last_checked=datetime.now(UTC),
            active_sessions=0,
            sessions=[],
        )
        mock_dispatcharr = DispatchrrStatus(
            name="Dispatcharr",
            online=True,
            last_checked=datetime.now(UTC),
            active_streams=0,
            total_viewers=0,
            streams=[],
        )

        with (
            patch(
                "app.services.status_service.get_ersatztv_status",
                return_value=mock_ersatztv,
            ),
            patch(
                "app.services.status_service.get_dispatcharr_status",
                return_value=mock_dispatcharr,
            ),
        ):
            status = await get_system_status()

        assert status.ersatztv is not None
        assert status.dispatcharr is not None
        assert status.ersatztv.name == "ErsatzTV"
        assert status.dispatcharr.name == "Dispatcharr"

    @pytest.mark.asyncio
    async def test_handles_partial_failure(self) -> None:
        """Should handle one service being offline."""
        mock_ersatztv = ErsatzTVStatus(
            name="ErsatzTV",
            online=True,
            last_checked=datetime.now(UTC),
            active_sessions=0,
            sessions=[],
        )
        mock_dispatcharr = DispatchrrStatus(
            name="Dispatcharr",
            online=False,
            last_checked=datetime.now(UTC),
            error="Connection refused",
        )

        with (
            patch(
                "app.services.status_service.get_ersatztv_status",
                return_value=mock_ersatztv,
            ),
            patch(
                "app.services.status_service.get_dispatcharr_status",
                return_value=mock_dispatcharr,
            ),
        ):
            status = await get_system_status()

        assert status.ersatztv.online is True
        assert status.dispatcharr.online is False


def _install_upstream(
    monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]
) -> None:
    """Route every status_service httpx client through a mock transport."""
    factory = httpx.AsyncClient
    monkeypatch.setattr(
        status_service.httpx,
        "AsyncClient",
        lambda **kwargs: factory(transport=httpx.MockTransport(handler), **kwargs),
    )


def _with_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        status_service, "dispatcharr_auth_headers", lambda: {"Authorization": "ApiKey synthetic"}
    )


class TestDegradedReasons:
    """A service that answers but fails part of its check says why (F-01)."""

    @pytest.mark.parametrize("code", [401, 403])
    async def test_rejected_dispatcharr_key_is_degraded_with_reason(
        self, monkeypatch: pytest.MonkeyPatch, code: int
    ) -> None:
        def upstream(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/proxy/ts/status":
                return httpx.Response(code)
            return httpx.Response(200, json=[])

        _install_upstream(monkeypatch, upstream)
        _with_api_key(monkeypatch)

        status = await get_dispatcharr_status()

        assert status.online is True
        assert status.degraded is True
        assert status.error == f"API key rejected (HTTP {code})"

    async def test_missing_stats_endpoint_is_not_blamed_on_the_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def upstream(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/proxy/ts/status":
                return httpx.Response(404)
            return httpx.Response(200, json=[])

        _install_upstream(monkeypatch, upstream)
        _with_api_key(monkeypatch)

        status = await get_dispatcharr_status()

        assert status.online is True
        assert status.degraded is True
        assert status.error == "stats endpoint missing (HTTP 404)"

    async def test_missing_dispatcharr_key_is_degraded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _install_upstream(monkeypatch, lambda request: httpx.Response(200, json=[]))

        def no_key() -> dict[str, str]:
            raise DispatchrrUnavailableError("no key")

        monkeypatch.setattr(status_service, "dispatcharr_auth_headers", no_key)

        status = await get_dispatcharr_status()

        assert status.online is True
        assert status.degraded is True
        assert status.error == "Auth required for stats"

    async def test_real_dispatcharr_timeout_reports_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def upstream(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("", request=request)

        _install_upstream(monkeypatch, upstream)
        _with_api_key(monkeypatch)

        status = await get_dispatcharr_status()

        assert status.online is False
        assert status.error == "timeout"

    async def test_failing_ersatztv_sessions_api_is_degraded_with_reason(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def upstream(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/sessions":
                return httpx.Response(500)
            return httpx.Response(200, json=[])

        _install_upstream(monkeypatch, upstream)

        status = await get_ersatztv_status()

        assert status.online is True
        assert status.degraded is True
        assert status.error == "sessions API HTTP 500"

    async def test_real_ersatztv_connect_failure_reports_the_reason(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def upstream(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("", request=request)

        _install_upstream(monkeypatch, upstream)

        status = await get_ersatztv_status()

        assert status.online is False
        assert status.error == "connection failed"

    async def test_healthy_services_are_not_degraded(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def upstream(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/proxy/ts/status":
                return httpx.Response(200, json={"channels": []})
            return httpx.Response(200, json=[])

        _install_upstream(monkeypatch, upstream)
        _with_api_key(monkeypatch)

        ersatztv = await get_ersatztv_status()
        dispatcharr = await get_dispatcharr_status()

        assert (ersatztv.online, ersatztv.degraded, ersatztv.error) == (True, False, None)
        assert (dispatcharr.online, dispatcharr.degraded, dispatcharr.error) == (True, False, None)


class _RecordingEPGService(EPGService):
    """EPG service fake that records health checks instead of downloading XMLTV."""

    def __init__(self, health: EPGHealthStatus) -> None:
        super().__init__("http://synthetic.invalid")
        self.health = health
        self.checks = 0

    async def check_health(self) -> EPGHealthStatus:
        self.checks += 1
        return self.health


class TestGetEPGStatus:
    """Tests for the guide data block of the system status."""

    @pytest.mark.asyncio
    async def test_uses_the_backoff_aware_health_check(self) -> None:
        """Reports EPGService.check_health, which respects the refresh backoff."""
        fake = _RecordingEPGService(_epg_health(online=False, error="HTTP 403"))

        with patch("app.services.status_service.get_epg_service", return_value=fake):
            status = await get_epg_status()

        assert fake.checks == 1
        assert status.online is False
        assert status.error == "HTTP 403"

    @pytest.mark.asyncio
    async def test_system_status_includes_epg_block(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The combined status carries the guide data health."""
        monkeypatch.setattr(
            status_service,
            "get_ersatztv_status",
            AsyncMock(
                return_value=ErsatzTVStatus(
                    name="ErsatzTV", online=True, last_checked=datetime.now(UTC)
                )
            ),
        )
        monkeypatch.setattr(
            status_service,
            "get_dispatcharr_status",
            AsyncMock(
                return_value=DispatchrrStatus(
                    name="Dispatcharr", online=True, last_checked=datetime.now(UTC)
                )
            ),
        )
        monkeypatch.setattr(
            status_service,
            "get_epg_status",
            AsyncMock(return_value=_epg_health(online=False, channel_count=0, error="HTTP 403")),
        )

        status = await get_system_status()

        assert status.epg.online is False
        assert status.epg.error == "HTTP 403"
        assert status.ersatztv.online is True
        assert status.dispatcharr.online is True

    @pytest.mark.asyncio
    async def test_epg_exception_does_not_hide_other_services(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A crash in the guide check degrades only the epg block."""
        monkeypatch.setattr(
            status_service,
            "get_ersatztv_status",
            AsyncMock(
                return_value=ErsatzTVStatus(
                    name="ErsatzTV", online=True, last_checked=datetime.now(UTC)
                )
            ),
        )
        monkeypatch.setattr(
            status_service,
            "get_dispatcharr_status",
            AsyncMock(
                return_value=DispatchrrStatus(
                    name="Dispatcharr", online=True, last_checked=datetime.now(UTC)
                )
            ),
        )
        monkeypatch.setattr(
            status_service, "get_epg_status", AsyncMock(side_effect=RuntimeError("boom"))
        )

        status = await get_system_status()

        assert status.epg.online is False
        assert status.epg.error == "Status check failed"
        assert status.epg.name == "Guide data (XMLTV)"
        assert status.ersatztv.online is True
        assert status.dispatcharr.online is True


@pytest.mark.parametrize(
    "bad_payload",
    [
        "<html>maintenance</html>",
        {"error": "maintenance"},
        [None],
        [{"channelNumber": "1", "state": {"invalid": "object"}}],
        [{"channelNumber": "1", "transcodedUntil": 42}],
    ],
)
async def test_sec08_invalid_ersatztv_preserves_healthy_dispatcharr(monkeypatch, bad_payload):
    from app.services import status_service

    def upstream(request):
        if request.url.path == "/api/sessions":
            if isinstance(bad_payload, str):
                return httpx.Response(200, text=bad_payload)
            return httpx.Response(200, json=bad_payload)
        if request.url.path == "/proxy/ts/status":
            return httpx.Response(200, json={"channels": []})
        return httpx.Response(200, json=[])

    factory = httpx.AsyncClient
    monkeypatch.setattr(
        status_service.httpx,
        "AsyncClient",
        lambda **kwargs: factory(transport=httpx.MockTransport(upstream), **kwargs),
    )
    monkeypatch.setattr(
        status_service, "dispatcharr_auth_headers", lambda: {"Authorization": "ApiKey synthetic"}
    )
    result = await status_service.get_system_status()
    assert result.ersatztv.online is False
    assert result.ersatztv.error == "Invalid upstream status response"
    assert result.dispatcharr.online is True


@pytest.mark.parametrize(
    "bad_payload",
    [
        "<html>maintenance</html>",
        [],
        {"channels": {}},
        {"channels": [None]},
        {"channels": [{"client_count": "invalid"}]},
        {"channels": [{"clients": [42]}]},
    ],
)
async def test_sec08_invalid_dispatcharr_preserves_healthy_ersatztv(monkeypatch, bad_payload):
    from app.services import status_service

    def upstream(request):
        if request.url.path == "/proxy/ts/status":
            if isinstance(bad_payload, str):
                return httpx.Response(200, text=bad_payload)
            return httpx.Response(200, json=bad_payload)
        return httpx.Response(200, json=[])

    factory = httpx.AsyncClient
    monkeypatch.setattr(
        status_service.httpx,
        "AsyncClient",
        lambda **kwargs: factory(transport=httpx.MockTransport(upstream), **kwargs),
    )
    monkeypatch.setattr(
        status_service, "dispatcharr_auth_headers", lambda: {"Authorization": "ApiKey synthetic"}
    )
    result = await status_service.get_system_status()
    assert result.dispatcharr.online is False
    assert result.dispatcharr.error == "Invalid upstream status response"
    assert result.ersatztv.online is True


def test_sec08_admin_endpoint_isolates_unexpected_service_failure(monkeypatch):
    from datetime import UTC, datetime
    from unittest.mock import AsyncMock

    from fastapi.testclient import TestClient

    from app.main import app
    from app.models.status import DispatchrrStatus
    from app.services import status_service
    from app.services.auth import create_access_token

    monkeypatch.setattr(
        status_service, "get_ersatztv_status", AsyncMock(side_effect=RuntimeError("schema drift"))
    )
    monkeypatch.setattr(
        status_service,
        "get_dispatcharr_status",
        AsyncMock(
            return_value=DispatchrrStatus(
                name="Dispatcharr", online=True, last_checked=datetime.now(UTC)
            )
        ),
    )
    token = create_access_token({"sub": "admin", "role": "admin"})
    response = TestClient(app).get(
        "/api/admin/status", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    assert response.json()["ersatztv"]["error"] == "Status check failed"
    assert response.json()["dispatcharr"]["online"] is True
    assert response.json()["epg"]["online"] is True
    assert response.json()["epg"]["channelCount"] == 109
