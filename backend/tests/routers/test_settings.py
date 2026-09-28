"""Tests for settings router."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.websocket import server_payload
from app.services import app_settings, presence_broadcast
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
    monkeypatch.setattr(app_settings, "_presence_visible", False)


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
        assert response.json() == {"userChannelSelection": False, "presenceVisible": False}

    def test_reflects_current_value(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The endpoint returns the live value, not a static default."""
        monkeypatch.setattr(app_settings, "_user_channel_selection", True)
        monkeypatch.setattr(app_settings, "_presence_visible", True)

        response = client.get("/api/settings", headers=auth_header)

        assert response.json() == {"userChannelSelection": True, "presenceVisible": True}


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
        assert response.json() == {"userChannelSelection": True, "presenceVisible": False}
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
        assert response.json() == {"userChannelSelection": False, "presenceVisible": False}
        assert app_settings.user_channel_selection_enabled() is False

    def test_omitted_field_leaves_value_unchanged(
        self,
        client: TestClient,
        admin_auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """An empty body does not reset anything."""
        monkeypatch.setattr(app_settings, "_user_channel_selection", True)

        monkeypatch.setattr(app_settings, "_presence_visible", True)

        response = client.put("/api/settings", json={}, headers=admin_auth_header)

        assert response.status_code == 200
        assert response.json() == {"userChannelSelection": True, "presenceVisible": True}


class TestPresenceVisibleSetting:
    """Tests for presenceVisible on /api/settings."""

    def test_defaults_to_off(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Presence ships dark: nobody sees what others watch until an admin allows it."""
        response = client.get("/api/settings", headers=auth_header)

        assert response.json()["presenceVisible"] is False

    def test_viewer_gets_403_forbidden(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Only an admin can make what everyone watches visible."""
        response = client.put(
            "/api/settings",
            json={"presenceVisible": True},
            headers=auth_header,
        )

        assert response.status_code == 403
        assert app_settings.presence_visible_enabled() is False

    def test_admin_can_turn_it_on_and_off(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """An admin can switch it on and back off; the other setting is untouched."""
        on = client.put("/api/settings", json={"presenceVisible": True}, headers=admin_auth_header)

        assert on.status_code == 200
        assert on.json() == {"userChannelSelection": False, "presenceVisible": True}
        assert app_settings.presence_visible_enabled() is True

        off = client.put(
            "/api/settings", json={"presenceVisible": False}, headers=admin_auth_header
        )

        assert off.json() == {"userChannelSelection": False, "presenceVisible": False}
        assert app_settings.presence_visible_enabled() is False

    def test_admin_can_set_both_in_one_request(
        self, client: TestClient, admin_auth_header: dict[str, str]
    ) -> None:
        """Both fields in one body are both applied."""
        response = client.put(
            "/api/settings",
            json={"userChannelSelection": True, "presenceVisible": True},
            headers=admin_auth_header,
        )

        assert response.json() == {"userChannelSelection": True, "presenceVisible": True}
        assert app_settings.user_channel_selection_enabled() is True
        assert app_settings.presence_visible_enabled() is True

    def test_both_fields_save_once_and_broadcast_once(
        self,
        client: TestClient,
        admin_auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """One settings_update carries both values; no intermediate state goes out."""
        broadcast = AsyncMock()
        save = AsyncMock()
        monkeypatch.setattr(app_settings.channel_state, "broadcast", broadcast)
        monkeypatch.setattr(app_settings.state_store, "save", save)

        client.put(
            "/api/settings",
            json={"userChannelSelection": True, "presenceVisible": True},
            headers=admin_auth_header,
        )

        save.assert_awaited_once()
        broadcast.assert_awaited_once()
        assert broadcast.await_args is not None
        assert server_payload(broadcast.await_args.args[0]) == {
            "type": "settings_update",
            "settings": {"userChannelSelection": True, "presenceVisible": True},
        }

    def test_unknown_key_is_rejected_and_changes_nothing(
        self,
        client: TestClient,
        admin_auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A misspelled key is a 422, not a silent 200 that applies nothing."""
        broadcast = AsyncMock()
        monkeypatch.setattr(app_settings.channel_state, "broadcast", broadcast)

        response = client.put(
            "/api/settings",
            json={"userChannelSelection": True, "presenceVisble": True},
            headers=admin_auth_header,
        )

        assert response.status_code == 422
        assert app_settings.user_channel_selection_enabled() is False
        assert app_settings.presence_visible_enabled() is False
        broadcast.assert_not_awaited()

    def test_changing_visibility_rebroadcasts_presence(
        self,
        client: TestClient,
        admin_auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Members' presence lists gain or lose channels as soon as the admin flips it."""
        schedule = MagicMock()
        monkeypatch.setattr(presence_broadcast, "schedule_broadcast", schedule)

        client.put("/api/settings", json={"presenceVisible": True}, headers=admin_auth_header)

        schedule.assert_called_once_with()

    def test_other_settings_do_not_rebroadcast_presence(
        self,
        client: TestClient,
        admin_auth_header: dict[str, str],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        schedule = MagicMock()
        monkeypatch.setattr(presence_broadcast, "schedule_broadcast", schedule)

        client.put("/api/settings", json={"userChannelSelection": True}, headers=admin_auth_header)

        schedule.assert_not_called()
