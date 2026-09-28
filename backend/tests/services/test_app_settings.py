"""Tests for app_settings service."""

from unittest.mock import AsyncMock, patch

import pytest

from app.models.websocket import server_payload
from app.services import app_settings


@pytest.fixture(autouse=True)
def reset_settings(monkeypatch: pytest.MonkeyPatch):
    """Reset settings to defaults before each test."""
    monkeypatch.setattr(app_settings, "_user_channel_selection", False)
    monkeypatch.setattr(app_settings, "_presence_visible", False)


class TestGetAppSettings:
    """Tests for get_app_settings function."""

    def test_defaults_to_disabled(self) -> None:
        """User channel selection is off by default."""
        settings = app_settings.get_app_settings()

        assert settings.user_channel_selection is False

    def test_serializes_to_camel_case(self) -> None:
        """Settings serialize with camelCase aliases for the API."""
        dumped = app_settings.get_app_settings().model_dump(by_alias=True)

        assert dumped == {"userChannelSelection": False, "presenceVisible": False}


class TestUserChannelSelectionEnabled:
    """Tests for user_channel_selection_enabled function."""

    def test_false_by_default(self) -> None:
        """Returns False when nothing has enabled it."""
        assert app_settings.user_channel_selection_enabled() is False

    async def test_true_after_enabling(self) -> None:
        """Returns True once the setting is turned on."""
        with patch.object(app_settings.channel_state, "broadcast", new=AsyncMock()):
            await app_settings.set_user_channel_selection(True)

        assert app_settings.user_channel_selection_enabled() is True


class TestSetUserChannelSelection:
    """Tests for set_user_channel_selection function."""

    async def test_returns_updated_settings(self) -> None:
        """The updated settings are returned."""
        with patch.object(app_settings.channel_state, "broadcast", new=AsyncMock()):
            result = await app_settings.set_user_channel_selection(True)

        assert result.user_channel_selection is True

    async def test_can_be_turned_back_off(self) -> None:
        """Toggling off restores the default."""
        with patch.object(app_settings.channel_state, "broadcast", new=AsyncMock()):
            await app_settings.set_user_channel_selection(True)
            result = await app_settings.set_user_channel_selection(False)

        assert result.user_channel_selection is False
        assert app_settings.user_channel_selection_enabled() is False

    async def test_broadcasts_settings_update(self) -> None:
        """Connected clients are told about the change."""
        mock_broadcast = AsyncMock()

        with patch.object(app_settings.channel_state, "broadcast", new=mock_broadcast):
            await app_settings.set_user_channel_selection(True, user="admin")

        mock_broadcast.assert_awaited_once()
        assert mock_broadcast.await_args is not None
        assert server_payload(mock_broadcast.await_args.args[0]) == {
            "type": "settings_update",
            "settings": {"userChannelSelection": True, "presenceVisible": False},
        }


class TestPresenceVisible:
    """Tests for the "Show what everyone is watching" setting."""

    def test_off_by_default(self) -> None:
        """Presence ships dark: members see names only until an admin turns it on."""
        assert app_settings.presence_visible_enabled() is False
        assert app_settings.get_app_settings().presence_visible is False

    async def test_can_be_turned_on_and_off(self) -> None:
        """The setting toggles and the updated settings are returned."""
        with patch.object(app_settings.channel_state, "broadcast", new=AsyncMock()):
            on = await app_settings.set_presence_visible(True, user="admin")
            assert on.presence_visible is True
            assert app_settings.presence_visible_enabled() is True

            off = await app_settings.set_presence_visible(False)
            assert off.presence_visible is False
            assert app_settings.presence_visible_enabled() is False

    async def test_leaves_user_channel_selection_alone(self) -> None:
        """Changing presence visibility doesn't touch the other setting."""
        with patch.object(app_settings.channel_state, "broadcast", new=AsyncMock()):
            result = await app_settings.set_presence_visible(True)

        assert result.user_channel_selection is False

    async def test_broadcasts_settings_update(self) -> None:
        """Connected clients are told about the change."""
        mock_broadcast = AsyncMock()

        with patch.object(app_settings.channel_state, "broadcast", new=mock_broadcast):
            await app_settings.set_presence_visible(True, user="admin")

        mock_broadcast.assert_awaited_once()
        assert mock_broadcast.await_args is not None
        assert server_payload(mock_broadcast.await_args.args[0]) == {
            "type": "settings_update",
            "settings": {"userChannelSelection": False, "presenceVisible": True},
        }
