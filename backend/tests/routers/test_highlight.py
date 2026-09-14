"""Tests for highlight router."""

import time
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.auth import create_access_token
from app.services.highlight import CAPTURE_TTL_SECONDS, Capture, highlight_service


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


CAPTURE_ID = "synthetic-capture-0001"


@pytest.fixture
def capture(tmp_path):
    """A real file registered for `testuser`; removed after the test."""
    path = tmp_path / "snapshot.mp4"
    path.write_bytes(b"0123456789abcdefghijklmnopqrstuvwxyz")
    item = Capture(
        CAPTURE_ID, "testuser", "channel-1", path, path.stat().st_size, 12.5, time.time()
    )
    highlight_service.captures.captures[CAPTURE_ID] = item
    yield item
    highlight_service.captures.captures.pop(CAPTURE_ID, None)


class TestCreateCapture:
    """Tests for POST /api/highlight/{channel_id}/capture endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        assert client.post("/api/highlight/channel-1/capture").status_code == 401

    def test_returns_503_when_disabled(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = False
            response = client.post("/api/highlight/channel-1/capture", headers=auth_header)
        assert response.status_code == 503

    def test_returns_400_on_error(self, client: TestClient, auth_header: dict[str, str]) -> None:
        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = True
            with patch("app.routers.highlight.highlight_service") as mock_service:
                mock_service.create_capture = AsyncMock(return_value=(None, "No recording active"))
                response = client.post("/api/highlight/channel-1/capture", headers=auth_header)
        assert response.status_code == 400
        assert response.json()["detail"] == "No recording active"

    def test_returns_capture_descriptor(
        self, client: TestClient, auth_header: dict[str, str], capture: Capture
    ) -> None:
        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = True
            with patch("app.routers.highlight.highlight_service") as mock_service:
                mock_service.create_capture = AsyncMock(return_value=(capture, None))
                response = client.post("/api/highlight/channel-1/capture", headers=auth_header)
        assert response.status_code == 200
        data = response.json()
        assert data == {
            "id": CAPTURE_ID,
            "duration": 12.5,
            "bytes": 36,
            "expiresAt": pytest.approx(capture.created_at + CAPTURE_TTL_SECONDS),
        }
        mock_service.create_capture.assert_awaited_once_with("channel-1", owner="testuser")


class TestCaptureMedia:
    """Tests for GET and DELETE /api/highlight/capture/{id}."""

    def test_requires_authentication(self, client: TestClient, capture: Capture) -> None:
        assert client.get(f"/api/highlight/capture/{CAPTURE_ID}").status_code == 401
        assert client.delete(f"/api/highlight/capture/{CAPTURE_ID}").status_code == 401
        assert CAPTURE_ID in highlight_service.captures.captures

    def test_streams_with_header_or_query_token(
        self, client: TestClient, auth_header: dict[str, str], capture: Capture
    ) -> None:
        response = client.get(f"/api/highlight/capture/{CAPTURE_ID}", headers=auth_header)
        assert response.status_code == 200
        assert response.content == capture.path.read_bytes()
        assert response.headers["content-type"] == "video/mp4"
        assert response.headers["accept-ranges"] == "bytes"
        assert response.headers["cache-control"] == "private, no-store"
        assert "content-disposition" not in response.headers

        token = auth_header["Authorization"].removeprefix("Bearer ")
        response = client.get(f"/api/highlight/capture/{CAPTURE_ID}?token={token}&download=1")
        assert response.status_code == 200
        assert response.headers["content-disposition"].startswith(
            'attachment; filename="highlight-channel-1-'
        )

    def test_serves_byte_ranges(
        self, client: TestClient, auth_header: dict[str, str], capture: Capture
    ) -> None:
        response = client.get(
            f"/api/highlight/capture/{CAPTURE_ID}", headers={**auth_header, "Range": "bytes=0-15"}
        )
        assert response.status_code == 206
        assert response.content == b"0123456789abcdef"
        assert response.headers["content-range"] == "bytes 0-15/36"

    def test_other_users_and_expired_captures_are_not_found(
        self, client: TestClient, capture: Capture
    ) -> None:
        other = {
            "Authorization": f"Bearer {create_access_token({'sub': 'other', 'role': 'viewer'})}"
        }
        assert client.get(f"/api/highlight/capture/{CAPTURE_ID}", headers=other).status_code == 404
        assert (
            client.delete(f"/api/highlight/capture/{CAPTURE_ID}", headers=other).status_code == 204
        )
        assert CAPTURE_ID in highlight_service.captures.captures
        assert (
            client.get("/api/highlight/capture/not-a-valid-id!", headers=other).status_code == 422
        )

    def test_delete_frees_capture(
        self, client: TestClient, auth_header: dict[str, str], capture: Capture, monkeypatch
    ) -> None:
        monkeypatch.setattr(
            "app.services.highlight.settings.highlight_temp_dir", str(capture.path.parent.parent)
        )
        assert (
            client.delete(f"/api/highlight/capture/{CAPTURE_ID}", headers=auth_header).status_code
            == 204
        )
        assert (
            client.get(f"/api/highlight/capture/{CAPTURE_ID}", headers=auth_header).status_code
            == 404
        )
        assert not capture.path.exists()
        assert (
            client.delete(f"/api/highlight/capture/{CAPTURE_ID}", headers=auth_header).status_code
            == 204
        )
