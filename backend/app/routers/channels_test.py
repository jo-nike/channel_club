"""Tests for channels router."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

from app.main import app
from app.models.channel import Channel
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

    def test_get_channels_success(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Authenticated request returns channel list."""
        mock_channels = [
            Channel(id="uuid-1", name="TSN", stream_url="https://streams.example.com/proxy/ts/stream/uuid-1"),
            Channel(id="uuid-2", name="Sportsnet", stream_url="https://streams.example.com/proxy/ts/stream/uuid-2"),
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
        assert data[1]["id"] == "uuid-2"
        assert data[1]["name"] == "Sportsnet"

    def test_get_channels_empty_list(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
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
            Channel(id="uuid-1", name="TSN", stream_url="https://streams.example.com/proxy/ts/stream/uuid-1"),
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
            Channel(id="uuid-1", name="TSN", stream_url="https://streams.example.com/proxy/ts/stream/uuid-1"),
        ]

        with patch("app.routers.channels.get_lineup", new_callable=AsyncMock) as mock_get_lineup:
            mock_get_lineup.return_value = mock_channels

            response = client.get("/api/channels", headers=auth_header)

        data = response.json()
        # Check camelCase is used
        assert "streamUrl" in data[0]
        # Check snake_case is NOT used
        assert "stream_url" not in data[0]
