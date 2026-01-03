"""Tests for EPG router."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.epg import EPGResponse, Program
from app.services.auth import create_access_token
from app.services.epg_service import EPGServiceError


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

    def test_returns_current_program(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns current program when one exists."""
        now = datetime.now(timezone.utc)
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
            mock_service.get_now_playing.side_effect = EPGServiceError(
                "EPG service unavailable"
            )
            mock_get_service.return_value = mock_service

            response = client.get(
                "/api/epg/now-playing?channel_id=uuid-123",
                headers=auth_header,
            )

        assert response.status_code == 503
        assert response.json() == {"detail": "EPG service unavailable"}

    def test_admin_can_access(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
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
        now = datetime.now(timezone.utc)
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

        mock_service.get_now_playing.assert_called_once_with("test-uuid-456")

    def test_invalid_token_returns_401(self, client: TestClient) -> None:
        """Request with invalid token returns 401."""
        response = client.get(
            "/api/epg/now-playing?channel_id=uuid-123",
            headers={"Authorization": "Bearer invalid-token"},
        )

        assert response.status_code == 401
