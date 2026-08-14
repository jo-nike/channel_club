"""Tests for app_settings service."""

from unittest.mock import AsyncMock, patch

import pytest

from app.services import app_settings


@pytest.fixture(autouse=True)
def reset_settings(monkeypatch: pytest.MonkeyPatch):
    """Reset settings to defaults before each test."""
    monkeypatch.setattr(app_settings, "_user_channel_selection", False)


class TestGetAppSettings:
    """Tests for get_app_settings function."""

    def test_defaults_to_disabled(self) -> None:
        """User channel selection is off by default."""
        settings = app_settings.get_app_settings()

        assert settings.user_channel_selection is False

    def test_serializes_to_camel_case(self) -> None:
        """Settings serialize with camelCase aliases for the API."""
        dumped = app_settings.get_app_settings().model_dump(by_alias=True)

        assert dumped == {"userChannelSelection": False}


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

        mock_broadcast.assert_awaited_once_with(
            {
                "type": "settings_update",
                "settings": {"userChannelSelection": True},
            }
        )
