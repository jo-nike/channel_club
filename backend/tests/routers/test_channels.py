"""Tests for channels router."""

from collections.abc import Callable, Iterator
from io import StringIO
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from loguru import logger

from app.config import settings
from app.main import app
from app.models.channel import Channel, ChannelGroupWithChannels, GroupedChannelsResponse
from app.services import app_settings, channel_state
from app.services.auth import create_access_token
from app.services.dispatcharr import DispatchrrUnavailableError, invalidate_grouped_channels_cache


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


@pytest.fixture(autouse=True)
def reset_channel_state():
    """Reset channel state before and after each test."""
    channel_state.clear_current_channel()
    yield
    channel_state.clear_current_channel()


class TestListChannels:
    """Tests for GET /api/channels endpoint."""

    def test_get_channels_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/channels")

        assert response.status_code == 401

    def test_get_channels_with_invalid_token(self, client: TestClient) -> None:
        """Request with invalid token returns 401."""
        response = client.get(
            "/api/channels",
            headers={"Authorization": "Bearer invalid-token"},
        )

        assert response.status_code == 401

    def test_get_channels_success(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Authenticated request returns channel list."""
        mock_channels = [
            Channel(
                id="uuid-1",
                name="TSN",
                stream_url="https://streams.example.com/proxy/ts/stream/uuid-1",
                guide_id="1",
            ),
            Channel(
                id="uuid-2",
                name="Sportsnet",
                stream_url="https://streams.example.com/proxy/ts/stream/uuid-2",
                guide_id="2",
            ),
        ]

        with patch("app.routers.channels.get_lineup", new_callable=AsyncMock) as mock_get_lineup:
            mock_get_lineup.return_value = mock_channels

            response = client.get("/api/channels", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["id"] == "uuid-1"
        assert data[0]["name"] == "TSN"
        assert data[0]["streamUrl"] == "https://streams.example.com/proxy/ts/stream/uuid-1"
        assert data[0]["guideId"] == "1"
        assert data[1]["id"] == "uuid-2"
        assert data[1]["name"] == "Sportsnet"
        assert data[1]["guideId"] == "2"

    def test_get_channels_empty_list(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Empty channel list returns empty array."""
        with patch("app.routers.channels.get_lineup", new_callable=AsyncMock) as mock_get_lineup:
            mock_get_lineup.return_value = []

            response = client.get("/api/channels", headers=auth_header)

        assert response.status_code == 200
        assert response.json() == []

    def test_get_channels_dispatcharr_unavailable(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Dispatcharr unavailable returns 503."""
        with patch("app.routers.channels.get_lineup", new_callable=AsyncMock) as mock_get_lineup:
            mock_get_lineup.side_effect = DispatchrrUnavailableError("Connection failed")

            response = client.get("/api/channels", headers=auth_header)

        assert response.status_code == 503
        assert response.json() == {"detail": "Channel service unavailable"}

    def test_get_channels_admin_can_access(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """Admin users can also access channels endpoint."""
        mock_channels = [
            Channel(
                id="uuid-1",
                name="TSN",
                stream_url="https://streams.example.com/proxy/ts/stream/uuid-1",
                guide_id="1",
            ),
        ]

        with patch("app.routers.channels.get_lineup", new_callable=AsyncMock) as mock_get_lineup:
            mock_get_lineup.return_value = mock_channels

            response = client.get("/api/channels", headers=admin_auth_header)

        assert response.status_code == 200
        assert len(response.json()) == 1

    def test_get_channels_response_uses_camel_case(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Response uses camelCase field names."""
        mock_channels = [
            Channel(
                id="uuid-1",
                name="TSN",
                stream_url="https://streams.example.com/proxy/ts/stream/uuid-1",
                guide_id="1",
            ),
        ]

        with patch("app.routers.channels.get_lineup", new_callable=AsyncMock) as mock_get_lineup:
            mock_get_lineup.return_value = mock_channels

            response = client.get("/api/channels", headers=auth_header)

        data = response.json()
        # Check camelCase is used
        assert "streamUrl" in data[0]
        assert "guideId" in data[0]
        # Check snake_case is NOT used
        assert "stream_url" not in data[0]
        assert "guide_id" not in data[0]


class TestGetCurrentChannel:
    """Tests for GET /api/channels/current endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/channels/current")
        assert response.status_code == 401

    def test_returns_null_when_no_channel_set(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """No channel selected returns null."""
        response = client.get("/api/channels/current", headers=auth_header)

        assert response.status_code == 200
        assert response.json() == {"currentChannel": None}

    def test_returns_channel_when_set(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns channel when one is set."""
        test_channel = Channel(
            id="uuid-123",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-123",
            guide_id="1",
        )
        # Set channel directly for test setup (without async broadcast)
        channel_state._current_channel = test_channel

        response = client.get("/api/channels/current", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["currentChannel"]["id"] == "uuid-123"
        assert data["currentChannel"]["name"] == "TSN"
        assert data["currentChannel"]["streamUrl"] == "https://streams.example.com/stream/uuid-123"
        assert data["currentChannel"]["guideId"] == "1"

    def test_admin_can_access(self, client: TestClient, admin_auth_header: dict[str, str]) -> None:
        """Admin can also access current channel."""
        response = client.get("/api/channels/current", headers=admin_auth_header)

        assert response.status_code == 200
        assert response.json() == {"currentChannel": None}

    def test_response_uses_camel_case(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Response uses camelCase field names."""
        test_channel = Channel(
            id="uuid-123",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-123",
            guide_id="1",
        )
        # Set channel directly for test setup (without async broadcast)
        channel_state._current_channel = test_channel

        response = client.get("/api/channels/current", headers=auth_header)

        data = response.json()
        # Check camelCase is used
        assert "currentChannel" in data
        assert "streamUrl" in data["currentChannel"]
        assert "guideId" in data["currentChannel"]
        # Check snake_case is NOT used
        assert "current_channel" not in data
        assert "stream_url" not in data["currentChannel"]
        assert "guide_id" not in data["currentChannel"]


class TestSetCurrentChannel:
    """Tests for PUT /api/channels/current endpoint."""

    def test_picker_channel_uses_trusted_metadata_when_hdhr_forbidden(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        trusted = Channel(
            id="picker-only",
            name="CA-FR: ICI TELE QUEBEC",
            streamUrl="https://streams.example.com/proxy/ts/stream/picker-only",
            guideId="194",
        )
        with (
            patch(
                "app.services.media_source.get_grouped_channels",
                AsyncMock(return_value=GroupedChannelsResponse(ungrouped=[trusted])),
            ),
            patch(
                "app.services.media_source.get_lineup",
                AsyncMock(side_effect=DispatchrrUnavailableError("403 Forbidden")),
            ) as lineup,
        ):
            response = client.put(
                "/api/channels/current",
                headers=admin_auth_header,
                json={
                    "id": trusted.id,
                    "name": "Forged",
                    "streamUrl": "http://untrusted/private",
                    "guideId": "forged",
                },
            )
        assert response.status_code == 200
        assert response.json() == trusted.model_dump(by_alias=True)
        assert channel_state.get_current_channel() == trusted
        lineup.assert_not_called()

    @pytest.fixture(autouse=True)
    def catalog(self):
        """Selection resolves these trusted fixtures instead of request URLs."""
        channels = [
            Channel(
                id="uuid-123",
                name="TSN",
                streamUrl="https://streams.example.com/stream/uuid-123",
                guideId="1",
            ),
            Channel(
                id="uuid-456",
                name="Sportsnet",
                streamUrl="https://streams.example.com/stream/uuid-456",
                guideId="2",
            ),
            Channel(
                id="uuid-789",
                name="CBC",
                streamUrl="https://streams.example.com/stream/uuid-789",
                guideId="3",
            ),
            Channel(id="uuid-1", name="TSN", streamUrl="https://example.com/1", guideId="1"),
            Channel(id="uuid-2", name="Sportsnet", streamUrl="https://example.com/2", guideId="2"),
            Channel(id="uuid", name="TSN", streamUrl="https://example.com/stream", guideId="1"),
        ]
        with (
            patch("app.services.media_source.get_channel_by_id", return_value=None),
            patch("app.services.media_source.get_lineup", AsyncMock(return_value=channels)),
            patch(
                "app.services.highlight.highlight_service.start_recording",
                AsyncMock(return_value=True),
            ),
        ):
            yield

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        channel_data = {
            "id": "uuid",
            "name": "TSN",
            "streamUrl": "https://example.com/stream",
            "guideId": "1",
        }
        response = client.put("/api/channels/current", json=channel_data)
        assert response.status_code == 401

    def test_viewer_gets_403_forbidden(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Viewer role returns 403 Forbidden while user channel selection is off."""
        channel_data = {
            "id": "uuid",
            "name": "TSN",
            "streamUrl": "https://example.com/stream",
            "guideId": "1",
        }

        response = client.put("/api/channels/current", json=channel_data, headers=auth_header)

        assert response.status_code == 403
        assert response.json()["detail"] == "Channel selection is restricted to admins"

    def test_viewer_can_set_channel_when_user_selection_enabled(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Viewer can set the channel once an admin enables user channel selection."""
        monkeypatch.setattr(app_settings, "_user_channel_selection", True)

        channel_data = {
            "id": "uuid-789",
            "name": "TSN",
            "streamUrl": "https://example.com/stream",
            "guideId": "1",
        }

        response = client.put("/api/channels/current", json=channel_data, headers=auth_header)

        assert response.status_code == 200
        assert response.json()["name"] == "CBC"

    def test_admin_can_set_channel(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """Admin can set current channel."""
        channel_data = {
            "id": "uuid-456",
            "name": "Sportsnet",
            "streamUrl": "https://streams.example.com/stream/uuid-456",
            "guideId": "2",
        }

        response = client.put(
            "/api/channels/current",
            json=channel_data,
            headers=admin_auth_header,
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "uuid-456"
        assert data["name"] == "Sportsnet"
        assert data["streamUrl"] == "https://streams.example.com/stream/uuid-456"
        assert data["guideId"] == "2"

    def test_set_channel_updates_state(
        self,
        client: TestClient,
        admin_auth_header: dict[str, str],
        auth_header: dict[str, str],
    ) -> None:
        """Setting channel updates the state that GET returns."""
        channel_data = {
            "id": "uuid-789",
            "name": "CBC",
            "streamUrl": "https://streams.example.com/stream/uuid-789",
            "guideId": "3",
        }

        # Set the channel as admin
        client.put(
            "/api/channels/current",
            json=channel_data,
            headers=admin_auth_header,
        )

        # Verify it's returned by GET (as viewer)
        response = client.get("/api/channels/current", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["currentChannel"]["id"] == "uuid-789"
        assert data["currentChannel"]["name"] == "CBC"
        assert data["currentChannel"]["guideId"] == "3"

    def test_set_channel_overwrites_previous(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """Setting a new channel overwrites the previous one."""
        channel1 = {
            "id": "uuid-1",
            "name": "TSN",
            "streamUrl": "https://example.com/1",
            "guideId": "1",
        }
        channel2 = {
            "id": "uuid-2",
            "name": "Sportsnet",
            "streamUrl": "https://example.com/2",
            "guideId": "2",
        }

        # Set first channel
        client.put("/api/channels/current", json=channel1, headers=admin_auth_header)

        # Set second channel
        client.put("/api/channels/current", json=channel2, headers=admin_auth_header)

        # Verify second channel is current
        response = client.get("/api/channels/current", headers=admin_auth_header)

        data = response.json()
        assert data["currentChannel"]["id"] == "uuid-2"
        assert data["currentChannel"]["name"] == "Sportsnet"
        assert data["currentChannel"]["guideId"] == "2"

    def test_validates_request_body(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """Invalid request body returns 422."""
        # Missing required fields
        invalid_data = {"name": "TSN"}

        response = client.put(
            "/api/channels/current",
            json=invalid_data,
            headers=admin_auth_header,
        )

        assert response.status_code == 422

    def test_response_uses_camel_case(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """Response uses camelCase field names."""
        channel_data = {
            "id": "uuid-123",
            "name": "TSN",
            "streamUrl": "https://streams.example.com/stream/uuid-123",
            "guideId": "1",
        }

        response = client.put(
            "/api/channels/current",
            json=channel_data,
            headers=admin_auth_header,
        )

        data = response.json()
        # Check camelCase is used
        assert "streamUrl" in data
        assert "guideId" in data
        # Check snake_case is NOT used
        assert "stream_url" not in data
        assert "guide_id" not in data


class TestClearCurrentChannel:
    """Tests for DELETE /api/channels/current endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.delete("/api/channels/current")
        assert response.status_code == 401

    def test_viewer_gets_403_forbidden(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Viewer role returns 403 Forbidden."""
        response = client.delete("/api/channels/current", headers=auth_header)

        assert response.status_code == 403
        assert response.json()["detail"] == "Admin access required"

    def test_viewer_still_forbidden_when_user_selection_enabled(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Clearing stays admin-only even when users may set the channel."""
        monkeypatch.setattr(app_settings, "_user_channel_selection", True)

        response = client.delete("/api/channels/current", headers=auth_header)

        assert response.status_code == 403
        assert response.json()["detail"] == "Admin access required"

    def test_admin_can_clear_channel(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """Admin can clear current channel."""
        # First set a channel
        test_channel = Channel(
            id="uuid-123",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-123",
            guide_id="1",
        )
        channel_state._current_channel = test_channel

        response = client.delete("/api/channels/current", headers=admin_auth_header)

        assert response.status_code == 200
        assert response.json() == {"status": "cleared"}

    def test_clear_channel_updates_state(
        self,
        client: TestClient,
        admin_auth_header: dict[str, str],
        auth_header: dict[str, str],
    ) -> None:
        """Clearing channel updates the state that GET returns."""
        # Set a channel
        test_channel = Channel(
            id="uuid-789",
            name="CBC",
            stream_url="https://streams.example.com/stream/uuid-789",
            guide_id="3",
        )
        channel_state._current_channel = test_channel

        # Clear the channel as admin
        client.delete("/api/channels/current", headers=admin_auth_header)

        # Verify it's cleared by GET (as viewer)
        response = client.get("/api/channels/current", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["currentChannel"] is None

    def test_clear_passes_the_admin_as_the_changer(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """Clearing names the admin so clients can say who stopped live TV."""
        with patch.object(
            channel_state, "clear_current_channel_async", new_callable=AsyncMock
        ) as mock_clear:
            response = client.delete("/api/channels/current", headers=admin_auth_header)

        assert response.status_code == 200
        mock_clear.assert_awaited_once_with(user="admin")

    def test_clear_when_no_channel_set(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """Clearing when no channel is set still succeeds."""
        # Ensure no channel is set
        channel_state.clear_current_channel()

        response = client.delete("/api/channels/current", headers=admin_auth_header)

        assert response.status_code == 200
        assert response.json() == {"status": "cleared"}


class TestChannelsLogging:
    """Tests for channels router logging."""

    def test_get_channels_logs_debug(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """GET /channels logs DEBUG level."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="DEBUG")

        try:
            with patch("app.routers.channels.get_lineup", new_callable=AsyncMock) as mock:
                mock.return_value = []
                client.get("/api/channels", headers=auth_header)

            log_output = output.getvalue()
            assert "DEBUG" in log_output
            assert "channels" in log_output.lower()
        finally:
            logger.remove(handler_id)

    def test_get_current_channel_logs_debug(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """GET /channels/current logs DEBUG level."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="DEBUG")

        try:
            client.get("/api/channels/current", headers=auth_header)

            log_output = output.getvalue()
            assert "DEBUG" in log_output
            assert "current" in log_output.lower()
        finally:
            logger.remove(handler_id)

    def test_set_channel_logs_info_with_admin_and_channel(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """PUT /channels/current logs INFO with channel name and admin user."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="INFO")

        try:
            channel_data = {
                "id": "uuid-123",
                "name": "TestChannel",
                "streamUrl": "https://example.com/stream",
                "guideId": "1",
            }
            trusted = Channel(
                id="uuid-123",
                name="TestChannel",
                streamUrl="https://example.com/stream",
                guideId="1",
            )
            with patch("app.services.media_source.get_lineup", AsyncMock(return_value=[trusted])):
                response = client.put(
                    "/api/channels/current", json=channel_data, headers=admin_auth_header
                )
            assert response.status_code == 200

            log_output = output.getvalue()
            assert "INFO" in log_output
            assert "TestChannel" in log_output
            assert "admin" in log_output.lower()
        finally:
            logger.remove(handler_id)

    def test_unauthorized_channel_change_logs_warning(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Unauthorized channel change attempts log WARNING."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="WARNING")

        try:
            channel_data = {
                "id": "uuid-123",
                "name": "TestChannel",
                "streamUrl": "https://example.com/stream",
                "guideId": "1",
            }
            client.put("/api/channels/current", json=channel_data, headers=auth_header)

            log_output = output.getvalue()
            assert "WARNING" in log_output
        finally:
            logger.remove(handler_id)

    def test_channels_logging_uses_router_context(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Channels logging uses logger.bind(router='channels') context."""
        output = StringIO()
        handler_id = logger.add(output, format="{extra} | {message}", level="DEBUG")

        try:
            with patch("app.routers.channels.get_lineup", new_callable=AsyncMock) as mock:
                mock.return_value = []
                client.get("/api/channels", headers=auth_header)

            log_output = output.getvalue()
            assert "router" in log_output
            assert "channels" in log_output
        finally:
            logger.remove(handler_id)


class TestListGroupedChannels:
    """Tests for GET /api/channels/grouped endpoint."""

    def test_get_grouped_channels_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/channels/grouped")
        assert response.status_code == 401

    def test_get_grouped_channels_with_invalid_token(self, client: TestClient) -> None:
        """Request with invalid token returns 401."""
        response = client.get(
            "/api/channels/grouped",
            headers={"Authorization": "Bearer invalid-token"},
        )
        assert response.status_code == 401

    def test_get_grouped_channels_success(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Authenticated request returns grouped channel list."""
        mock_response = GroupedChannelsResponse(
            groups=[
                ChannelGroupWithChannels(
                    id=1,
                    name="Sports",
                    channel_count=2,
                    channels=[
                        Channel(
                            id="uuid-1",
                            name="TSN",
                            stream_url="https://streams.example.com/proxy/ts/stream/uuid-1",
                            guide_id="1",
                        ),
                        Channel(
                            id="uuid-2",
                            name="Sportsnet",
                            stream_url="https://streams.example.com/proxy/ts/stream/uuid-2",
                            guide_id="2",
                        ),
                    ],
                ),
            ],
            ungrouped=[
                Channel(
                    id="uuid-3",
                    name="CBC",
                    stream_url="https://streams.example.com/proxy/ts/stream/uuid-3",
                    guide_id="3",
                ),
            ],
        )

        with patch(
            "app.routers.channels.get_grouped_channels", new_callable=AsyncMock
        ) as mock_get_grouped:
            mock_get_grouped.return_value = mock_response

            response = client.get("/api/channels/grouped", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert len(data["groups"]) == 1
        assert data["groups"][0]["name"] == "Sports"
        assert data["groups"][0]["channelCount"] == 2
        assert len(data["groups"][0]["channels"]) == 2
        assert data["groups"][0]["channels"][0]["name"] == "TSN"
        assert len(data["ungrouped"]) == 1
        assert data["ungrouped"][0]["name"] == "CBC"

    def test_get_grouped_channels_empty(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Empty grouped response returns empty arrays."""
        mock_response = GroupedChannelsResponse(groups=[], ungrouped=[])

        with patch(
            "app.routers.channels.get_grouped_channels", new_callable=AsyncMock
        ) as mock_get_grouped:
            mock_get_grouped.return_value = mock_response

            response = client.get("/api/channels/grouped", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["groups"] == []
        assert data["ungrouped"] == []

    def test_get_grouped_channels_dispatcharr_unavailable(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Dispatcharr unavailable returns 503."""
        with patch(
            "app.routers.channels.get_grouped_channels", new_callable=AsyncMock
        ) as mock_get_grouped:
            mock_get_grouped.side_effect = DispatchrrUnavailableError("Connection failed")

            response = client.get("/api/channels/grouped", headers=auth_header)

        assert response.status_code == 503
        assert response.json() == {"detail": "Channel service unavailable"}

    def test_get_grouped_channels_admin_can_access(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """Admin users can also access grouped channels endpoint."""
        mock_response = GroupedChannelsResponse(
            groups=[
                ChannelGroupWithChannels(
                    id=1,
                    name="News",
                    channel_count=1,
                    channels=[
                        Channel(
                            id="uuid-1",
                            name="CNN",
                            stream_url="https://streams.example.com/proxy/ts/stream/uuid-1",
                            guide_id="1",
                        ),
                    ],
                ),
            ],
            ungrouped=[],
        )

        with patch(
            "app.routers.channels.get_grouped_channels", new_callable=AsyncMock
        ) as mock_get_grouped:
            mock_get_grouped.return_value = mock_response

            response = client.get("/api/channels/grouped", headers=admin_auth_header)

        assert response.status_code == 200
        assert len(response.json()["groups"]) == 1

    def test_get_grouped_channels_response_uses_camel_case(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Response uses camelCase field names."""
        mock_response = GroupedChannelsResponse(
            groups=[
                ChannelGroupWithChannels(
                    id=1,
                    name="Sports",
                    channel_count=1,
                    channels=[
                        Channel(
                            id="uuid-1",
                            name="TSN",
                            stream_url="https://streams.example.com/proxy/ts/stream/uuid-1",
                            guide_id="1",
                        ),
                    ],
                ),
            ],
            ungrouped=[],
        )

        with patch(
            "app.routers.channels.get_grouped_channels", new_callable=AsyncMock
        ) as mock_get_grouped:
            mock_get_grouped.return_value = mock_response

            response = client.get("/api/channels/grouped", headers=auth_header)

        data = response.json()
        # Check camelCase is used
        assert "channelCount" in data["groups"][0]
        assert "streamUrl" in data["groups"][0]["channels"][0]
        assert "guideId" in data["groups"][0]["channels"][0]
        # Check snake_case is NOT used
        assert "channel_count" not in data["groups"][0]
        assert "stream_url" not in data["groups"][0]["channels"][0]
        assert "guide_id" not in data["groups"][0]["channels"][0]

    def test_get_grouped_channels_only_ungrouped(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Handles response with only ungrouped channels."""
        mock_response = GroupedChannelsResponse(
            groups=[],
            ungrouped=[
                Channel(
                    id="uuid-1",
                    name="Channel 1",
                    stream_url="https://streams.example.com/proxy/ts/stream/uuid-1",
                    guide_id="1",
                ),
                Channel(
                    id="uuid-2",
                    name="Channel 2",
                    stream_url="https://streams.example.com/proxy/ts/stream/uuid-2",
                    guide_id="2",
                ),
            ],
        )

        with patch(
            "app.routers.channels.get_grouped_channels", new_callable=AsyncMock
        ) as mock_get_grouped:
            mock_get_grouped.return_value = mock_response

            response = client.get("/api/channels/grouped", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["groups"] == []
        assert len(data["ungrouped"]) == 2


class TestMalformedDispatcharrPayload:
    """A login page or schema drift from Dispatcharr is a 503, not a 500 (C-08)."""

    HTML = httpx.Response(200, headers={"content-type": "text/html"}, text="<html>Login</html>")
    NO_UUID = httpx.Response(200, json=[{"id": 1, "name": "TSN", "channel_group_id": None}])
    PAGINATED = httpx.Response(200, json={"count": 0, "results": []})

    @pytest.fixture(autouse=True)
    def dispatcharr_settings(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "dispatcharr_url", "http://dispatcharr.test")
        monkeypatch.setattr(settings, "dispatcharr_api_key", "test-key")

    @staticmethod
    def _upstream(monkeypatch: pytest.MonkeyPatch, channels: httpx.Response) -> None:
        """Groups are fine; the channels and lineup calls answer `channels`."""
        real_client = httpx.AsyncClient

        def handle(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/channels/groups/":
                return httpx.Response(200, json=[])
            return httpx.Response(
                channels.status_code, headers=channels.headers, content=channels.content
            )

        def client_factory(**kwargs: Any) -> httpx.AsyncClient:
            return real_client(transport=httpx.MockTransport(handle), **kwargs)

        monkeypatch.setattr("app.services.dispatcharr.httpx.AsyncClient", client_factory)

    @pytest.mark.parametrize("payload", [HTML, NO_UUID, PAGINATED], ids=["html", "no-uuid", "dict"])
    @pytest.mark.parametrize(
        ("route", "detail"),
        [
            ("/api/channels/grouped", "Channel service unavailable"),
            ("/api/channels", "Channel service unavailable"),
            ("/api/channels/logos/17", "Logo unavailable"),
        ],
    )
    def test_answers_503(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
        payload: httpx.Response,
        route: str,
        detail: str,
    ) -> None:
        self._upstream(monkeypatch, payload)

        response = client.get(route, headers=auth_header)

        assert response.status_code == 503
        assert response.json() == {"detail": detail}


PNG_LOGO = b"\x89PNG\r\n\x1a\n" + b"synthetic-image-data"
DISPATCHARR = "http://dispatcharr.test:9191"


class TestGetChannelLogo:
    """Tests for GET /api/channels/logos/{logo_id}."""

    @pytest.fixture(autouse=True)
    def dispatcharr(self, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
        """A catalogue whose TSN channel uses logo 17, and empty logo caches."""
        monkeypatch.setattr(settings, "dispatcharr_url", DISPATCHARR)
        monkeypatch.setattr(settings, "dispatcharr_api_key", "test-key")
        catalogue = GroupedChannelsResponse(
            groups=[
                ChannelGroupWithChannels(
                    id=1,
                    name="Sports",
                    channel_count=1,
                    channels=[
                        Channel(
                            id="uuid-1",
                            name="TSN",
                            stream_url="https://streams.example.com/proxy/ts/stream/uuid-1",
                            guide_id="1",
                            logo_url="/api/channels/logos/17",
                        )
                    ],
                )
            ],
            ungrouped=[
                Channel(
                    id="uuid-2",
                    name="CBC",
                    stream_url="https://streams.example.com/proxy/ts/stream/uuid-2",
                    guide_id="2",
                )
            ],
        )
        invalidate_grouped_channels_cache()
        with patch(
            "app.services.dispatcharr.get_grouped_channels",
            new=AsyncMock(return_value=catalogue),
        ):
            yield
        invalidate_grouped_channels_cache()

    @staticmethod
    def _upstream(
        monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]
    ) -> list[httpx.Request]:
        """Route the service's httpx client to `handler`; returns the requests it saw."""
        requests: list[httpx.Request] = []
        real_client = httpx.AsyncClient

        def record(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return handler(request)

        def client_factory(**kwargs: Any) -> httpx.AsyncClient:
            return real_client(transport=httpx.MockTransport(record), **kwargs)

        monkeypatch.setattr("app.services.dispatcharr.httpx.AsyncClient", client_factory)
        return requests

    @staticmethod
    def _png(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "image/png"}, content=PNG_LOGO)

    def test_serves_the_raster_logo_without_authentication(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """img tags can't send the JWT; the image comes from Dispatcharr's fixed logo URL."""
        requests = self._upstream(monkeypatch, self._png)

        response = client.get("/api/channels/logos/17")

        assert response.status_code == 200
        assert response.content == PNG_LOGO
        assert response.headers["content-type"] == "image/png"
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["content-security-policy"] == "default-src 'none'; sandbox"
        assert [str(r.url) for r in requests] == [f"{DISPATCHARR}/api/channels/logos/17/cache/"]
        assert requests[0].headers["authorization"] == "ApiKey test-key"

    def test_serves_repeat_requests_from_the_cache(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        requests = self._upstream(monkeypatch, self._png)

        first = client.get("/api/channels/logos/17")
        second = client.get("/api/channels/logos/17")

        assert first.status_code == second.status_code == 200
        assert second.content == PNG_LOGO
        assert len(requests) == 1

    def test_404_for_a_logo_no_channel_uses(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Only catalogue logos are served, so the open route can't walk Dispatcharr's logos."""
        requests = self._upstream(monkeypatch, lambda req: pytest.fail("upstream requested"))

        response = client.get("/api/channels/logos/18")

        assert response.status_code == 404
        assert response.json() == {"detail": "No logo available"}
        assert requests == []

    @pytest.mark.parametrize("logo_id", ["0", "-1", "abc", "17.5", "..%2F..%2Fadmin"])
    def test_rejects_anything_but_a_positive_integer_id(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, logo_id: str
    ) -> None:
        requests = self._upstream(monkeypatch, lambda req: pytest.fail("upstream requested"))

        response = client.get(f"/api/channels/logos/{logo_id}")

        assert response.status_code in (404, 422)
        assert requests == []

    @pytest.mark.parametrize(
        "content_type,body",
        [
            ("image/svg+xml", b'<svg onload="evil()"/>'),
            ("text/html", b"<script>evil()</script>"),
            ("image/png", b"<script>evil()</script>"),
        ],
    )
    def test_503_for_a_non_raster_logo_and_the_failure_is_remembered(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, content_type: str, body: bytes
    ) -> None:
        """Dispatcharr can serve SVG logos; those are refused, and not refetched right away."""
        requests = self._upstream(
            monkeypatch,
            lambda req: httpx.Response(200, headers={"content-type": content_type}, content=body),
        )

        first = client.get("/api/channels/logos/17")
        second = client.get("/api/channels/logos/17")

        assert first.status_code == second.status_code == 503
        assert first.json() == {"detail": "Logo unavailable"}
        assert len(requests) == 1

    def test_503_when_dispatcharr_redirects_off_its_origin(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        requests = self._upstream(
            monkeypatch,
            lambda req: httpx.Response(302, headers={"location": "http://evil.invalid/logo.png"}),
        )

        response = client.get("/api/channels/logos/17")

        assert response.status_code == 503
        assert [r.url.host for r in requests] == ["dispatcharr.test"]

    def test_503_when_dispatcharr_is_unreachable(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def unreachable(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("Connection refused", request=request)

        self._upstream(monkeypatch, unreachable)

        response = client.get("/api/channels/logos/17")

        assert response.status_code == 503
