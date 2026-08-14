"""Tests for settings router."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import app_settings
from app.services.auth import create_access_token


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def auth_header() -> dict[str, str]:
    """Create valid auth header with viewer JWT token."""
    token = create_access_token({"sub": "testuser", "role": "viewer"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_auth_header() -> dict[str, str]:
    """Create valid auth header with admin JWT token."""
    token = create_access_token({"sub": "admin", "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def reset_settings(monkeypatch: pytest.MonkeyPatch):
    """Reset settings to defaults before each test."""
    monkeypatch.setattr(app_settings, "_user_channel_selection", False)


class TestGetSettings:
    """Tests for GET /api/settings endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/settings")

        assert response.status_code == 401

    def test_viewer_can_read_settings(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Viewers can read settings so they know what they are allowed to do."""
        response = client.get("/api/settings", headers=auth_header)

        assert response.status_code == 200
        assert response.json() == {"userChannelSelection": False}

    def test_reflects_current_value(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The endpoint returns the live value, not a static default."""
        monkeypatch.setattr(app_settings, "_user_channel_selection", True)

        response = client.get("/api/settings", headers=auth_header)

        assert response.json() == {"userChannelSelection": True}


class TestUpdateSettings:
    """Tests for PUT /api/settings endpoint."""

    def test_viewer_gets_403_forbidden(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Viewer role cannot change settings."""
        response = client.put(
            "/api/settings",
            json={"userChannelSelection": True},
            headers=auth_header,
        )

        assert response.status_code == 403
        assert response.json()["detail"] == "Admin access required"
        assert app_settings.user_channel_selection_enabled() is False

    def test_admin_can_enable(self, client: TestClient, admin_auth_header: dict[str, str]) -> None:
        """Admin can turn user channel selection on."""
        response = client.put(
            "/api/settings",
            json={"userChannelSelection": True},
            headers=admin_auth_header,
        )

        assert response.status_code == 200
        assert response.json() == {"userChannelSelection": True}
        assert app_settings.user_channel_selection_enabled() is True

    def test_admin_can_disable(
        self,
        client: TestClient,
        admin_auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Admin can turn user channel selection back off."""
        monkeypatch.setattr(app_settings, "_user_channel_selection", True)

        response = client.put(
            "/api/settings",
            json={"userChannelSelection": False},
            headers=admin_auth_header,
        )

        assert response.status_code == 200
        assert response.json() == {"userChannelSelection": False}
        assert app_settings.user_channel_selection_enabled() is False

    def test_omitted_field_leaves_value_unchanged(
        self,
        client: TestClient,
        admin_auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """An empty body does not reset anything."""
        monkeypatch.setattr(app_settings, "_user_channel_selection", True)

        response = client.put("/api/settings", json={}, headers=admin_auth_header)

        assert response.status_code == 200
        assert response.json() == {"userChannelSelection": True}
