"""Tests for EPG router."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from io import StringIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from loguru import logger

from app.main import app
from app.models.channel import Channel, ChannelGroupWithChannels, GroupedChannelsResponse
from app.models.epg import EPGProgrammesResponse, EPGResponse, Program
from app.services.auth import create_access_token
from app.services.dispatcharr import DispatchrrUnavailableError
from app.services.epg_service import EPGService, EPGServiceError


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def auth_header() -> dict[str, str]:
    """Create valid auth header with JWT token."""
    token = create_access_token({"sub": "testuser", "role": "viewer"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_auth_header() -> dict[str, str]:
    """Create valid auth header with admin JWT token."""
    token = create_access_token({"sub": "admin", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


class TestGetNowPlaying:
    """Tests for GET /api/epg/now-playing endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/epg/now-playing?channel_id=uuid-123")

        assert response.status_code == 401

    def test_requires_channel_id_param(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Missing channel_id returns 422."""
        response = client.get("/api/epg/now-playing", headers=auth_header)

        assert response.status_code == 422

    def test_returns_current_program(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Returns current program when one exists."""
        now = datetime.now(UTC)
        mock_response = EPGResponse(
            channel_id="uuid-123",
            current_program=Program(
                title="Test Show",
                start_time=now - timedelta(minutes=30),
                end_time=now + timedelta(minutes=30),
                description="A test program",
            ),
            next_program=Program(
                title="Next Show",
                start_time=now + timedelta(minutes=30),
                end_time=now + timedelta(hours=1, minutes=30),
            ),
        )

        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing.return_value = mock_response
            mock_get_service.return_value = mock_service

            response = client.get(
                "/api/epg/now-playing?channel_id=uuid-123",
                headers=auth_header,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["channelId"] == "uuid-123"
        assert data["currentProgram"]["title"] == "Test Show"
        assert data["currentProgram"]["description"] == "A test program"
        assert data["nextProgram"]["title"] == "Next Show"

    def test_returns_null_when_no_epg_data(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns null currentProgram when no EPG data exists."""
        mock_response = EPGResponse(
            channel_id="uuid-123",
            current_program=None,
            next_program=None,
        )

        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing.return_value = mock_response
            mock_get_service.return_value = mock_service

            response = client.get(
                "/api/epg/now-playing?channel_id=uuid-123",
                headers=auth_header,
            )

        assert response.status_code == 200
        data = response.json()
        assert data["channelId"] == "uuid-123"
        assert data["currentProgram"] is None
        assert data["nextProgram"] is None

    def test_returns_503_when_service_unavailable(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 503 when EPG service is unavailable."""
        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing.side_effect = EPGServiceError("EPG service unavailable")
            mock_service.get_health = MagicMock()
            mock_get_service.return_value = mock_service

            response = client.get(
                "/api/epg/now-playing?channel_id=uuid-123",
                headers=auth_header,
            )

        assert response.status_code == 503
        assert response.json() == {"detail": "EPG service unavailable"}

    def test_admin_can_access(self, client: TestClient, admin_auth_header: dict[str, str]) -> None:
        """Admin users can access EPG endpoint."""
        mock_response = EPGResponse(
            channel_id="uuid-123",
            current_program=None,
        )

        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing.return_value = mock_response
            mock_get_service.return_value = mock_service

            response = client.get(
                "/api/epg/now-playing?channel_id=uuid-123",
                headers=admin_auth_header,
            )

        assert response.status_code == 200

    def test_response_uses_camel_case(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Response uses camelCase field names."""
        now = datetime.now(UTC)
        mock_response = EPGResponse(
            channel_id="uuid-123",
            current_program=Program(
                title="Test",
                start_time=now,
                end_time=now + timedelta(hours=1),
            ),
        )

        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing.return_value = mock_response
            mock_get_service.return_value = mock_service

            response = client.get(
                "/api/epg/now-playing?channel_id=uuid-123",
                headers=auth_header,
            )

        data = response.json()
        # Check camelCase is used
        assert "channelId" in data
        assert "currentProgram" in data
        assert "startTime" in data["currentProgram"]
        assert "endTime" in data["currentProgram"]
        # Check snake_case is NOT used
        assert "channel_id" not in data
        assert "current_program" not in data
        assert "start_time" not in data["currentProgram"]

    def test_passes_channel_id_to_service(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Channel ID from query param is passed to service."""
        mock_response = EPGResponse(channel_id="test-uuid-456", current_program=None)

        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing.return_value = mock_response
            mock_get_service.return_value = mock_service

            client.get(
                "/api/epg/now-playing?channel_id=test-uuid-456",
                headers=auth_header,
            )

        mock_service.get_now_playing.assert_called_once_with("test-uuid-456", channel_name=None)

    def test_passes_channel_name_to_service(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """The optional channel name is forwarded for the display-name fallback."""
        mock_response = EPGResponse(channel_id="28", current_program=None)

        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing.return_value = mock_response
            mock_get_service.return_value = mock_service

            response = client.get(
                "/api/epg/now-playing",
                params={"channel_id": "28", "channel_name": "CA-S: TSN 5"},
                headers=auth_header,
            )

        assert response.status_code == 200
        mock_service.get_now_playing.assert_called_once_with("28", channel_name="CA-S: TSN 5")

    def test_rejects_overlong_channel_name(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """A channel name over 256 characters is rejected before reaching the service."""
        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            response = client.get(
                "/api/epg/now-playing",
                params={"channel_id": "28", "channel_name": "x" * 257},
                headers=auth_header,
            )

        assert response.status_code == 422
        mock_get_service.assert_not_called()

    def test_invalid_token_returns_401(self, client: TestClient) -> None:
        """Request with invalid token returns 401."""
        response = client.get(
            "/api/epg/now-playing?channel_id=uuid-123",
            headers={"Authorization": "Bearer invalid-token"},
        )

        assert response.status_code == 401


class TestEPGLogging:
    """Tests for EPG router logging."""

    def test_now_playing_logs_debug_with_channel_id(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """GET /epg/now-playing logs DEBUG with channel_id."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="DEBUG")

        try:
            mock_response = EPGResponse(channel_id="test-uuid", current_program=None)
            with patch("app.routers.epg.get_epg_service") as mock_get_service:
                mock_service = AsyncMock()
                mock_service.get_now_playing.return_value = mock_response
                mock_get_service.return_value = mock_service

                client.get(
                    "/api/epg/now-playing?channel_id=test-uuid",
                    headers=auth_header,
                )

            log_output = output.getvalue()
            assert "DEBUG" in log_output
            assert "test-uuid" in log_output
        finally:
            logger.remove(handler_id)

    def test_epg_logging_uses_router_context(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """EPG logging uses logger.bind(router='epg') context."""
        output = StringIO()
        handler_id = logger.add(output, format="{extra} | {message}", level="DEBUG")

        try:
            mock_response = EPGResponse(channel_id="test-uuid", current_program=None)
            with patch("app.routers.epg.get_epg_service") as mock_get_service:
                mock_service = AsyncMock()
                mock_service.get_now_playing.return_value = mock_response
                mock_get_service.return_value = mock_service

                client.get(
                    "/api/epg/now-playing?channel_id=test-uuid",
                    headers=auth_header,
                )

            log_output = output.getvalue()
            assert "router" in log_output
            assert "epg" in log_output
        finally:
            logger.remove(handler_id)


def _channel(guide_id: str, name: str) -> Channel:
    return Channel(
        id=f"uuid-{guide_id}", name=name, stream_url="http://stream.test/x", guide_id=guide_id
    )


class TestGetNowPlayingAll:
    """Tests for GET /api/epg/now-playing/all endpoint."""

    @pytest.fixture(autouse=True)
    def grouped_channels(self) -> Iterator[AsyncMock]:
        """Stub the channel catalogue so no test reaches Dispatcharr."""
        with patch(
            "app.routers.epg.get_grouped_channels",
            new=AsyncMock(return_value=GroupedChannelsResponse()),
        ) as mock_grouped:
            yield mock_grouped

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/epg/now-playing/all")

        assert response.status_code == 401

    def test_returns_program_per_channel(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns the on-air program keyed by channel id."""
        now = datetime.now(UTC)
        mock_now_playing = {
            "uuid-123": Program(
                title="Test Show",
                start_time=now - timedelta(minutes=30),
                end_time=now + timedelta(minutes=30),
                description="A test program",
            ),
        }

        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing_bulk.return_value = mock_now_playing
            mock_get_service.return_value = mock_service

            response = client.get("/api/epg/now-playing/all", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["nowPlaying"]["uuid-123"]["title"] == "Test Show"
        assert data["nowPlaying"]["uuid-123"]["description"] == "A test program"

    def test_returns_empty_mapping_when_nothing_on_air(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """An empty result is a valid response, not an error."""
        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing_bulk.return_value = {}
            mock_get_service.return_value = mock_service

            response = client.get("/api/epg/now-playing/all", headers=auth_header)

        assert response.status_code == 200
        assert response.json() == {"nowPlaying": {}}

    def test_returns_503_when_service_unavailable(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 503 when EPG service is unavailable."""
        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing_bulk.side_effect = EPGServiceError("unavailable")
            mock_service.get_health = MagicMock()
            mock_get_service.return_value = mock_service

            response = client.get("/api/epg/now-playing/all", headers=auth_header)

        assert response.status_code == 503
        assert response.json() == {"detail": "EPG service unavailable"}

    def test_passes_catalogue_channels_to_service(
        self, client: TestClient, auth_header: dict[str, str], grouped_channels: AsyncMock
    ) -> None:
        """Grouped and ungrouped channels are handed over for guide-id resolution."""
        tsn = _channel("28", "CA-S: TSN 5")
        cbc = _channel("29", "CBC")
        grouped_channels.return_value = GroupedChannelsResponse(
            groups=[ChannelGroupWithChannels(id=1, name="Sports", channel_count=1, channels=[tsn])],
            ungrouped=[cbc],
        )

        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing_bulk.return_value = {}
            mock_get_service.return_value = mock_service

            response = client.get("/api/epg/now-playing/all", headers=auth_header)

        assert response.status_code == 200
        mock_service.get_now_playing_bulk.assert_awaited_once_with([tsn, cbc])

    def test_catalogue_outage_still_returns_xmltv_keyed_programmes(
        self, client: TestClient, auth_header: dict[str, str], grouped_channels: AsyncMock
    ) -> None:
        """A Dispatcharr outage drops the guide-id keys but not the whole response."""
        grouped_channels.side_effect = DispatchrrUnavailableError("down")
        now = datetime.now(UTC)
        on_air = Program(
            title="Test Show",
            start_time=now - timedelta(minutes=30),
            end_time=now + timedelta(minutes=30),
        )

        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_now_playing_bulk.return_value = {"tsn5.ca": on_air}
            mock_get_service.return_value = mock_service

            response = client.get("/api/epg/now-playing/all", headers=auth_header)

        assert response.status_code == 200
        assert response.json()["nowPlaying"]["tsn5.ca"]["title"] == "Test Show"
        mock_service.get_now_playing_bulk.assert_awaited_once_with([])


class TestGetProgrammes:
    """Tests for GET /api/epg/programmes endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/epg/programmes?channel_id=28")

        assert response.status_code == 401

    def test_requires_channel_id_param(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Missing channel_id returns 422."""
        response = client.get("/api/epg/programmes", headers=auth_header)

        assert response.status_code == 422

    def test_returns_schedule_in_camel_case(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns the channel id and its programmes with camelCase fields."""
        now = datetime.now(UTC)
        mock_response = EPGProgrammesResponse(
            channel_id="28",
            programmes=[
                Program(
                    title="Hockey Night",
                    start_time=now - timedelta(minutes=30),
                    end_time=now + timedelta(minutes=30),
                    description="Leafs at Habs",
                ),
                Program(
                    title="Post-game",
                    start_time=now + timedelta(minutes=30),
                    end_time=now + timedelta(hours=1),
                ),
            ],
        )

        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_programmes.return_value = mock_response
            mock_get_service.return_value = mock_service

            response = client.get("/api/epg/programmes?channel_id=28", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["channelId"] == "28"
        assert [p["title"] for p in data["programmes"]] == ["Hockey Night", "Post-game"]
        assert data["programmes"][0]["description"] == "Leafs at Habs"
        assert "startTime" in data["programmes"][0]
        assert "endTime" in data["programmes"][0]
        assert "channel_id" not in data

    def test_defaults_to_twelve_hours_without_a_name(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Without hours or channel_name, the service gets 12 hours and no name."""
        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_programmes.return_value = EPGProgrammesResponse(
                channel_id="28", programmes=[]
            )
            mock_get_service.return_value = mock_service

            response = client.get("/api/epg/programmes?channel_id=28", headers=auth_header)

        assert response.status_code == 200
        assert response.json() == {"channelId": "28", "programmes": []}
        mock_service.get_programmes.assert_awaited_once_with("28", 12, channel_name=None)

    def test_passes_hours_and_channel_name_to_service(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """The window length and the fallback name are forwarded."""
        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_programmes.return_value = EPGProgrammesResponse(
                channel_id="28", programmes=[]
            )
            mock_get_service.return_value = mock_service

            response = client.get(
                "/api/epg/programmes",
                params={"channel_id": "28", "hours": 48, "channel_name": "CA-S: TSN 5"},
                headers=auth_header,
            )

        assert response.status_code == 200
        mock_service.get_programmes.assert_awaited_once_with("28", 48, channel_name="CA-S: TSN 5")

    @pytest.mark.parametrize("hours", [0, 49, -1])
    def test_rejects_hours_out_of_range(
        self, client: TestClient, auth_header: dict[str, str], hours: int
    ) -> None:
        """hours must be between 1 and 48; anything else never reaches the service."""
        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            response = client.get(
                "/api/epg/programmes",
                params={"channel_id": "28", "hours": hours},
                headers=auth_header,
            )

        assert response.status_code == 422
        mock_get_service.assert_not_called()

    def test_rejects_overlong_channel_name(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """A channel name over 256 characters is rejected before reaching the service."""
        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            response = client.get(
                "/api/epg/programmes",
                params={"channel_id": "28", "channel_name": "x" * 257},
                headers=auth_header,
            )

        assert response.status_code == 422
        mock_get_service.assert_not_called()

    def test_returns_503_when_service_unavailable(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 503 when EPG service is unavailable."""
        with patch("app.routers.epg.get_epg_service") as mock_get_service:
            mock_service = AsyncMock()
            mock_service.get_programmes.side_effect = EPGServiceError("EPG service unavailable")
            mock_service.get_health = MagicMock()
            mock_get_service.return_value = mock_service

            response = client.get("/api/epg/programmes?channel_id=28", headers=auth_header)

        assert response.status_code == 503
        assert response.json() == {"detail": "EPG service unavailable"}


class TestUnavailableWarning:
    """Guide 503s log at DEBUG, with one WARNING carrying the cause per backoff window (H-08)."""

    @staticmethod
    def _unavailable_service(retry_at: datetime) -> EPGService:
        service = EPGService("http://dispatcharr.synthetic:9191")
        service._last_error = "HTTP 403"
        service._retry_at = retry_at
        return service

    def test_repeated_503s_in_one_backoff_window_warn_once(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="DEBUG")
        retry_at = datetime.now(UTC) + timedelta(minutes=5)
        try:
            with (
                patch(
                    "app.routers.epg.get_epg_service",
                    return_value=self._unavailable_service(retry_at),
                ),
                patch(
                    "app.routers.epg.get_grouped_channels",
                    new=AsyncMock(side_effect=DispatchrrUnavailableError("down")),
                ),
            ):
                for path in (
                    "/api/epg/now-playing?channel_id=28",
                    "/api/epg/programmes?channel_id=28",
                    "/api/epg/now-playing/all",
                    "/api/epg/now-playing?channel_id=29",
                ):
                    assert client.get(path, headers=auth_header).status_code == 503
        finally:
            logger.remove(handler_id)

        lines = output.getvalue().splitlines()
        warnings = [line for line in lines if line.startswith("WARNING") and "EPG" in line]
        assert len(warnings) == 1
        assert "HTTP 403" in warnings[0]
        assert str(retry_at) in warnings[0]
        assert any(
            line.startswith("DEBUG") and "unavailable for channel: 29" in line for line in lines
        )

    def test_a_new_backoff_window_warns_again(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="WARNING")
        now = datetime.now(UTC)
        try:
            for retry_at in (now + timedelta(seconds=30), now + timedelta(seconds=60)):
                with patch(
                    "app.routers.epg.get_epg_service",
                    return_value=self._unavailable_service(retry_at),
                ):
                    for _ in range(2):
                        response = client.get(
                            "/api/epg/now-playing?channel_id=28", headers=auth_header
                        )
                        assert response.status_code == 503
        finally:
            logger.remove(handler_id)

        warnings = [line for line in output.getvalue().splitlines() if "EPG" in line]
        assert len(warnings) == 2
