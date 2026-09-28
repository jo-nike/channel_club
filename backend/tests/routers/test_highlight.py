"""Tests for highlight router."""

import time
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.auth import create_access_token
from app.services.highlight import (
    CAPTURE_TTL_SECONDS,
    DOWNLOAD_TOKEN_TTL_SECONDS,
    Capture,
    highlight_service,
)


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


class TestLegacySaveRouteIsGone:
    """The capture-then-export flow replaced POST /api/highlight/{channel_id}."""

    def test_legacy_save_route_no_longer_exists(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        response = client.post("/api/highlight/channel-1?format=mp4", headers=auth_header)
        assert response.status_code in (404, 405)


CAPTURE_ID = "synthetic-capture-0001"


@pytest.fixture
def capture(tmp_path):
    """A real file registered for `testuser`; removed after the test."""
    path = tmp_path / "snapshot.mp4"
    path.write_bytes(b"0123456789abcdefghijklmnopqrstuvwxyz")
    now = time.time()
    # Pressed 2s before the capture's last frame, so the press sits 10.5s into it.
    item = Capture(
        CAPTURE_ID, "testuser", "channel-1", path, path.stat().st_size, 12.5, now, now - 2, now
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

    def test_returns_409_when_the_recorder_stopped_while_clipping(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        from app.services.highlight import RECORDER_GONE_ERROR

        with patch("app.routers.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = True
            with patch("app.routers.highlight.highlight_service") as mock_service:
                mock_service.create_capture = AsyncMock(return_value=(None, RECORDER_GONE_ERROR))
                response = client.post("/api/highlight/channel-1/capture", headers=auth_header)
        assert response.status_code == 409
        assert response.json()["detail"] == "Live TV changed while clipping; press Clip again"

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
            "pressedAt": pytest.approx(capture.pressed_at),
            "endsAt": pytest.approx(capture.ends_at),
        }
        assert data["endsAt"] - data["pressedAt"] == pytest.approx(2)
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


class TestCaptureDownloadLink:
    """Tests for POST /capture/{id}/download-token and GET /download/{token}."""

    @pytest.fixture(autouse=True)
    def no_leftover_tokens(self):
        yield
        highlight_service.captures.download_tokens.clear()

    def link(self, client: TestClient, headers: dict[str, str]) -> str:
        response = client.post(
            f"/api/highlight/capture/{CAPTURE_ID}/download-token", headers=headers
        )
        assert response.status_code == 200
        return response.json()["url"]

    def test_requires_authentication(self, client: TestClient, capture: Capture) -> None:
        response = client.post(f"/api/highlight/capture/{CAPTURE_ID}/download-token")
        assert response.status_code == 401
        assert highlight_service.captures.download_tokens == {}

    def test_link_downloads_the_capture_once_without_the_session_token(
        self, client: TestClient, auth_header: dict[str, str], capture: Capture
    ) -> None:
        url = self.link(client, auth_header)
        session_token = auth_header["Authorization"].removeprefix("Bearer ")
        assert url.startswith("/api/highlight/download/")
        assert session_token not in url and "?" not in url

        response = client.get(url)
        assert response.status_code == 200
        assert response.content == capture.path.read_bytes()
        assert response.headers["content-type"] == "video/mp4"
        assert response.headers["cache-control"] == "private, no-store"
        assert response.headers["content-disposition"].startswith(
            'attachment; filename="highlight-channel-1-'
        )
        assert response.headers["content-disposition"].endswith('.mp4"')

        # A plain replay finds nothing; only a resumed (Range) download is served again.
        assert client.get(url).status_code == 404
        # The capture itself is untouched: the editor keeps previewing it.
        assert CAPTURE_ID in highlight_service.captures.captures

    def test_an_interrupted_download_resumes_with_a_range_request(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        capture: Capture,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        url = self.link(client, auth_header)
        assert client.get(url).status_code == 200
        resumed = client.get(url, headers={"Range": "bytes=16-"})
        assert resumed.status_code == 206
        assert resumed.content == capture.path.read_bytes()[16:]
        assert client.get(url, headers={"Range": "bytes=30-"}).status_code == 206
        # A plain replay of the link is still refused, and so is a resume after expiry.
        assert client.get(url).status_code == 404
        issued = time.time()
        monkeypatch.setattr(
            "app.services.highlight.time.time", lambda: issued + DOWNLOAD_TOKEN_TTL_SECONDS + 1
        )
        assert client.get(url, headers={"Range": "bytes=16-"}).status_code == 404

    def test_each_link_is_separate(
        self, client: TestClient, auth_header: dict[str, str], capture: Capture
    ) -> None:
        first, second = self.link(client, auth_header), self.link(client, auth_header)
        assert first != second
        assert client.get(second).status_code == 200
        assert client.get(first).status_code == 200

    def test_link_expires(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        capture: Capture,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        url = self.link(client, auth_header)
        issued = time.time()
        monkeypatch.setattr(
            "app.services.highlight.time.time", lambda: issued + DOWNLOAD_TOKEN_TTL_SECONDS + 1
        )
        assert client.get(url).status_code == 404

    def test_another_owner_gets_no_link(self, client: TestClient, capture: Capture) -> None:
        other = {
            "Authorization": f"Bearer {create_access_token({'sub': 'other', 'role': 'viewer'})}"
        }
        response = client.post(f"/api/highlight/capture/{CAPTURE_ID}/download-token", headers=other)
        assert response.status_code == 404
        assert highlight_service.captures.download_tokens == {}
        assert (
            client.post(
                "/api/highlight/capture/unknown-capture-0001/download-token", headers=other
            ).status_code
            == 404
        )

    def test_deleting_the_capture_drops_its_links(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        capture: Capture,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            "app.services.highlight.settings.highlight_temp_dir", str(capture.path.parent.parent)
        )
        url = self.link(client, auth_header)
        assert (
            client.delete(f"/api/highlight/capture/{CAPTURE_ID}", headers=auth_header).status_code
            == 204
        )
        assert highlight_service.captures.download_tokens == {}
        assert client.get(url).status_code == 404

    def test_unknown_and_malformed_tokens(self, client: TestClient) -> None:
        assert client.get("/api/highlight/download/unknown-token-000000").status_code == 404
        assert client.get("/api/highlight/download/not!a!token").status_code == 422
