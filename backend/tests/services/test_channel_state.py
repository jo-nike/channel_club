"""Tests for channel state service."""

from unittest.mock import AsyncMock, patch

import pytest

from app.models.channel import Channel
from app.services import channel_state


@pytest.fixture(autouse=True)
def reset_channel_state():
    """Reset channel state before each test."""
    channel_state.clear_current_channel()
    channel_state._active_connections.clear()
    yield
    channel_state.clear_current_channel()
    channel_state._active_connections.clear()


class TestGetCurrentChannel:
    """Tests for get_current_channel function."""

    def test_returns_none_when_no_channel_set(self) -> None:
        """Should return None when no channel has been set."""
        result = channel_state.get_current_channel()
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_channel_when_set(self) -> None:
        """Should return the channel after it's been set."""
        test_channel = Channel(
            id="uuid-123",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-123",
            guide_id="guide-123",
        )
        await channel_state.set_current_channel(test_channel)

        result = channel_state.get_current_channel()

        assert result is not None
        assert result.id == "uuid-123"
        assert result.name == "TSN"
        assert result.stream_url == "https://streams.example.com/stream/uuid-123"


class TestSetCurrentChannel:
    """Tests for set_current_channel function."""

    @pytest.mark.asyncio
    async def test_sets_and_returns_channel(self) -> None:
        """Should set the channel and return it."""
        test_channel = Channel(
            id="uuid-456",
            name="Sportsnet",
            stream_url="https://streams.example.com/stream/uuid-456",
            guide_id="guide-456",
        )

        result = await channel_state.set_current_channel(test_channel)

        assert result.id == "uuid-456"
        assert result.name == "Sportsnet"

    @pytest.mark.asyncio
    async def test_overwrites_previous_channel(self) -> None:
        """Should overwrite previous channel when new one is set."""
        channel1 = Channel(
            id="uuid-1",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-1",
            guide_id="guide-1",
        )
        channel2 = Channel(
            id="uuid-2",
            name="Sportsnet",
            stream_url="https://streams.example.com/stream/uuid-2",
            guide_id="guide-2",
        )

        await channel_state.set_current_channel(channel1)
        await channel_state.set_current_channel(channel2)

        result = channel_state.get_current_channel()
        assert result is not None
        assert result.id == "uuid-2"
        assert result.name == "Sportsnet"


class TestClearCurrentChannel:
    """Tests for clear_current_channel function."""

    @pytest.mark.asyncio
    async def test_clears_set_channel(self) -> None:
        """Should clear the current channel."""
        test_channel = Channel(
            id="uuid-789",
            name="CBC",
            stream_url="https://streams.example.com/stream/uuid-789",
            guide_id="guide-789",
        )
        await channel_state.set_current_channel(test_channel)

        channel_state.clear_current_channel()

        assert channel_state.get_current_channel() is None

    def test_clearing_when_no_channel_is_safe(self) -> None:
        """Should not error when clearing with no channel set."""
        channel_state.clear_current_channel()
        assert channel_state.get_current_channel() is None


class TestConnectionManagement:
    """Tests for WebSocket connection management."""

    def test_get_connection_count_empty(self) -> None:
        """Should return 0 when no connections."""
        assert channel_state.get_connection_count() == 0

    def test_disconnect_removes_connection(self) -> None:
        """Should remove connection from set."""
        # Create mock websocket
        from unittest.mock import MagicMock

        mock_ws = MagicMock()
        channel_state._active_connections.add(mock_ws)
        assert channel_state.get_connection_count() == 1

        channel_state.disconnect(mock_ws)
        assert channel_state.get_connection_count() == 0

    def test_disconnect_safe_when_not_in_set(self) -> None:
        """Should not error when disconnecting unknown websocket."""
        from unittest.mock import MagicMock

        mock_ws = MagicMock()
        channel_state.disconnect(mock_ws)  # Should not raise
        assert channel_state.get_connection_count() == 0


class TestHighlightRecordingOnChannelSwitch:
    """Tests for highlight recording cleanup on channel switch."""

    @pytest.mark.asyncio
    async def test_switching_channels_stops_old_recording(self) -> None:
        """Should stop recording for old channel when switching to new channel."""
        channel1 = Channel(
            id="uuid-1",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-1",
            guide_id="guide-1",
        )
        channel2 = Channel(
            id="uuid-2",
            name="Sportsnet",
            stream_url="https://streams.example.com/stream/uuid-2",
            guide_id="guide-2",
        )

        mock_highlight_service = AsyncMock()

        with (
            patch("app.services.channel_state.settings") as mock_settings,
            patch(
                "app.services.highlight.highlight_service", mock_highlight_service
            ),
        ):
            mock_settings.highlight_enabled = True

            await channel_state.set_current_channel(channel1)
            await channel_state.set_current_channel(channel2)

            # Should have stopped recording for channel1
            mock_highlight_service.stop_recording.assert_called_once_with("uuid-1")
            # Should have started recording for both channels
            assert mock_highlight_service.start_recording.call_count == 2

    @pytest.mark.asyncio
    async def test_switching_to_same_channel_does_not_stop_recording(self) -> None:
        """Should not stop recording when switching to same channel."""
        channel = Channel(
            id="uuid-1",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-1",
            guide_id="guide-1",
        )

        mock_highlight_service = AsyncMock()

        with (
            patch("app.services.channel_state.settings") as mock_settings,
            patch(
                "app.services.highlight.highlight_service", mock_highlight_service
            ),
        ):
            mock_settings.highlight_enabled = True

            await channel_state.set_current_channel(channel)
            await channel_state.set_current_channel(channel)

            # Should not have called stop_recording (same channel)
            mock_highlight_service.stop_recording.assert_not_called()
            # Should have started recording twice (but that's fine, it's idempotent)
            assert mock_highlight_service.start_recording.call_count == 2

    @pytest.mark.asyncio
    async def test_clearing_channel_stops_recording(self) -> None:
        """Should stop recording when clearing current channel."""
        channel = Channel(
            id="uuid-1",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-1",
            guide_id="guide-1",
        )

        mock_highlight_service = AsyncMock()

        with (
            patch("app.services.channel_state.settings") as mock_settings,
            patch(
                "app.services.highlight.highlight_service", mock_highlight_service
            ),
        ):
            mock_settings.highlight_enabled = True

            await channel_state.set_current_channel(channel)
            mock_highlight_service.reset_mock()

            await channel_state.clear_current_channel_async()

            # Should have stopped recording for the channel
            mock_highlight_service.stop_recording.assert_called_once_with("uuid-1")

    @pytest.mark.asyncio
    async def test_no_recording_when_highlight_disabled(self) -> None:
        """Should not call recording functions when highlight is disabled."""
        channel = Channel(
            id="uuid-1",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-1",
            guide_id="guide-1",
        )

        mock_highlight_service = AsyncMock()

        with (
            patch("app.services.channel_state.settings") as mock_settings,
            patch(
                "app.services.highlight.highlight_service", mock_highlight_service
            ),
        ):
            mock_settings.highlight_enabled = False

            await channel_state.set_current_channel(channel)

            # Should not have called any recording functions
            mock_highlight_service.start_recording.assert_not_called()
            mock_highlight_service.stop_recording.assert_not_called()
