"""Tests for channels router."""

from io import StringIO
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from loguru import logger

from app.main import app
from app.models.channel import Channel, ChannelGroupWithChannels, GroupedChannelsResponse
from app.services import app_settings, channel_state
from app.services.auth import create_access_token
from app.services.dispatcharr import DispatchrrUnavailableError


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
