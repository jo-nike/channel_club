"""Tests for highlight router."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.auth import create_access_token


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def auth_header() -> dict[str, str]:
    """Create valid auth header with JWT token."""
    token = create_access_token({"sub": "testuser", "role": "viewer"})
    return {"Authorization": f"Bearer {token}"}


class TestGetFeatureStatus:
    """Tests for GET /api/highlight/feature endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/highlight/feature")
        assert response.status_code == 401

    def test_returns_enabled_false_when_disabled(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns enabled=false when feature disabled."""
        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = False
            mock_settings.zipline_available = False

            response = client.get("/api/highlight/feature", headers=auth_header)

        assert response.status_code == 200
        assert response.json() == {"enabled": False, "ziplineEnabled": False}

    def test_returns_enabled_true_when_enabled(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns enabled=true when feature enabled."""
        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = True
            mock_settings.zipline_available = False

            response = client.get("/api/highlight/feature", headers=auth_header)

        assert response.status_code == 200
        assert response.json() == {"enabled": True, "ziplineEnabled": False}


class TestGetHighlightStatus:
    """Tests for GET /api/highlight/status/{channel_id} endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/highlight/status/channel-1")
        assert response.status_code == 401

    def test_returns_status_when_disabled(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns disabled status when feature disabled."""
        with patch("app.routers.highlight.highlight_service") as mock_service:
            mock_service.get_status.return_value = {
                "enabled": False,
                "recording": False,
                "bufferSeconds": 0,
                "maxBufferSeconds": 60,
            }

            response = client.get("/api/highlight/status/channel-1", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is False
        assert data["recording"] is False

    def test_returns_recording_status(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns recording status when active."""
        with patch("app.routers.highlight.highlight_service") as mock_service:
            mock_service.get_status.return_value = {
                "enabled": True,
                "recording": True,
                "bufferSeconds": 45.5,
                "maxBufferSeconds": 60,
            }

            response = client.get("/api/highlight/status/channel-1", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["enabled"] is True
        assert data["recording"] is True
        assert data["bufferSeconds"] == 45.5
        assert data["maxBufferSeconds"] == 60


class TestSaveHighlight:
    """Tests for POST /api/highlight/{channel_id} endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.post("/api/highlight/channel-1")
        assert response.status_code == 401

    def test_returns_503_when_disabled(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 503 when feature disabled."""
        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = False

            response = client.post("/api/highlight/channel-1", headers=auth_header)

        assert response.status_code == 503
        assert response.json()["detail"] == "Highlight feature is disabled"

    def test_returns_400_on_error(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Returns 400 with error message on failure."""
        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = True

            with patch("app.routers.highlight.highlight_service") as mock_service:
                mock_service.save_highlight = AsyncMock(return_value=(None, "No recording active"))

                response = client.post("/api/highlight/channel-1", headers=auth_header)

        assert response.status_code == 400
        assert response.json()["detail"] == "No recording active"

    def test_returns_mp4_on_success(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Returns MP4 file on success."""
        mp4_content = b"fake mp4 content"

        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = True

            with patch("app.routers.highlight.highlight_service") as mock_service:
                mock_service.save_highlight = AsyncMock(return_value=(mp4_content, None))

                response = client.post("/api/highlight/channel-1", headers=auth_header)

        assert response.status_code == 200
        assert response.content == mp4_content
        assert response.headers["content-type"] == "video/mp4"
        assert "attachment" in response.headers["content-disposition"]
        assert "highlight-channel-1" in response.headers["content-disposition"]
        assert ".mp4" in response.headers["content-disposition"]

    def test_returns_mp4_with_explicit_format(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns MP4 when format=mp4 is specified."""
        mp4_content = b"fake mp4 content"

        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = True

            with patch("app.routers.highlight.highlight_service") as mock_service:
                mock_service.save_highlight = AsyncMock(return_value=(mp4_content, None))

                response = client.post("/api/highlight/channel-1?format=mp4", headers=auth_header)

        assert response.status_code == 200
        assert response.content == mp4_content
        assert response.headers["content-type"] == "video/mp4"
        mock_service.save_highlight.assert_called_once_with(
            "channel-1", format="mp4", start_time=None, end_time=None, owner="testuser"
        )

    def test_returns_webm_on_success(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Returns WebM file when format=webm is specified."""
        webm_content = b"fake webm content"

        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = True

            with patch("app.routers.highlight.highlight_service") as mock_service:
                mock_service.save_highlight = AsyncMock(return_value=(webm_content, None))

                response = client.post("/api/highlight/channel-1?format=webm", headers=auth_header)

        assert response.status_code == 200
        assert response.content == webm_content
        assert response.headers["content-type"] == "video/webm"
        assert "attachment" in response.headers["content-disposition"]
        assert "highlight-channel-1" in response.headers["content-disposition"]
        assert ".webm" in response.headers["content-disposition"]
        mock_service.save_highlight.assert_called_once_with(
            "channel-1", format="webm", start_time=None, end_time=None, owner="testuser"
        )

    def test_invalid_format_returns_422(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 422 for invalid format parameter."""
        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = True

            response = client.post("/api/highlight/channel-1?format=avi", headers=auth_header)

        assert response.status_code == 422  # Validation error
