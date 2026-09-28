"""Tests for channel state service."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from app.config import settings
from app.models.channel import Channel
from app.services import channel_state, chat
from app.services.highlight import HighlightService


@pytest.fixture(autouse=True)
def reset_channel_state():
    """Reset channel state before each test."""
    channel_state.clear_current_channel()
    channel_state._active_connections.clear()
    yield
    channel_state.clear_current_channel()
    channel_state._active_connections.clear()


async def _drain_reconcile() -> None:
    """Wait for the background recorder reconcile to finish, if one is running."""
    task = channel_state._reconcile_task
    if task is not None:
        await task


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


class TestChannelUpdateAttribution:
    """Tests for the changedBy field on channel_update broadcasts."""

    @pytest.mark.asyncio
    async def test_set_broadcast_names_the_user(self) -> None:
        """Setting a channel with a user broadcasts changedBy as that user."""
        channel = Channel(
            id="uuid-1",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-1",
            guide_id="guide-1",
        )

        with patch.object(channel_state, "broadcast", new_callable=AsyncMock) as mock_broadcast:
            await channel_state.set_current_channel(channel, user="alice")

        mock_broadcast.assert_awaited_once()
        assert mock_broadcast.await_args is not None
        message = mock_broadcast.await_args.args[0]
        assert message["type"] == "channel_update"
        assert message["channel"]["id"] == "uuid-1"
        assert message["changedBy"] == "alice"

    @pytest.mark.asyncio
    async def test_set_broadcast_without_user_has_null_changed_by(self) -> None:
        """A system change (no user) broadcasts changedBy as None."""
        channel = Channel(
            id="uuid-1",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-1",
            guide_id="guide-1",
        )

        with patch.object(channel_state, "broadcast", new_callable=AsyncMock) as mock_broadcast:
            await channel_state.set_current_channel(channel)

        assert mock_broadcast.await_args is not None
        message = mock_broadcast.await_args.args[0]
        assert "changedBy" in message
        assert message["changedBy"] is None

    @pytest.mark.asyncio
    async def test_clear_broadcast_names_the_user(self) -> None:
        """Clearing with a user broadcasts a null channel with changedBy."""
        with patch.object(channel_state, "broadcast", new_callable=AsyncMock) as mock_broadcast:
            await channel_state.clear_current_channel_async(user="alice")

        mock_broadcast.assert_awaited_once_with(
            {"type": "channel_update", "channel": None, "changedBy": "alice"}
        )


def _sent_messages(mock_broadcast: AsyncMock) -> list[dict]:
    """The messages a patched broadcast was awaited with, in order."""
    return [call.args[0] for call in mock_broadcast.await_args_list]


class TestLiveChangeSystemLines:
    """Tests for the system chat line posted when someone changes Live."""

    @pytest.fixture
    def channel(self) -> Channel:
        return Channel(
            id="uuid-5",
            name="TSN 5",
            stream_url="https://streams.example.com/stream/uuid-5",
            guide_id="guide-5",
        )

    @pytest.mark.asyncio
    async def test_set_posts_a_system_line_when_chat_is_enabled(
        self, channel: Channel, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """With chat on, a switch broadcasts the channel_update then a system line."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with patch.object(channel_state, "broadcast", new_callable=AsyncMock) as mock_broadcast:
            await channel_state.set_current_channel(channel, user="jon")

        sent = _sent_messages(mock_broadcast)
        assert [m["type"] for m in sent] == ["channel_update", "chat_message"]
        line = sent[1]
        assert line["kind"] == "system"
        assert line["username"] == "Live TV"
        assert line["content"] == "jon put on TSN 5"

    @pytest.mark.asyncio
    async def test_clear_posts_a_system_line_when_chat_is_enabled(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """With chat on, stopping live TV broadcasts a system line naming who did it."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with patch.object(channel_state, "broadcast", new_callable=AsyncMock) as mock_broadcast:
            await channel_state.clear_current_channel_async(user="jon")

        sent = _sent_messages(mock_broadcast)
        assert [m["type"] for m in sent] == ["channel_update", "chat_message"]
        assert sent[1]["kind"] == "system"
        assert sent[1]["content"] == "jon stopped live TV"

    @pytest.mark.asyncio
    async def test_no_system_line_when_chat_is_disabled(
        self, channel: Channel, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """With chat off, only the channel_update goes out, on set and on clear."""
        monkeypatch.setattr(settings, "chat_enabled", False)

        with patch.object(channel_state, "broadcast", new_callable=AsyncMock) as mock_broadcast:
            await channel_state.set_current_channel(channel, user="jon")
            await channel_state.clear_current_channel_async(user="jon")

        assert [m["type"] for m in _sent_messages(mock_broadcast)] == [
            "channel_update",
            "channel_update",
        ]

    @pytest.mark.asyncio
    async def test_no_system_line_without_a_user(
        self, channel: Channel, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A change nobody made has no one to name, so no line is posted."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with patch.object(channel_state, "broadcast", new_callable=AsyncMock) as mock_broadcast:
            await channel_state.set_current_channel(channel)
            await channel_state.clear_current_channel_async()

        assert [m["type"] for m in _sent_messages(mock_broadcast)] == [
            "channel_update",
            "channel_update",
        ]

    @pytest.mark.asyncio
    async def test_system_line_is_not_stored_in_chat_history(
        self, channel: Channel, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Live changes never take room in the chat history."""
        monkeypatch.setattr(settings, "chat_enabled", True)
        chat.clear_history()

        with patch.object(channel_state, "broadcast", new_callable=AsyncMock):
            await channel_state.set_current_channel(channel, user="jon")
            await channel_state.clear_current_channel_async(user="jon")

        assert chat.get_history_count() == 0


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
    async def test_switching_channels_keeps_old_recording(self) -> None:
        """Should leave the old channel's recorder to the idle sweep (E-14)."""
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

        mock_highlight_service = AsyncMock(spec=HighlightService)

        with (
            patch("app.services.channel_state.settings") as mock_settings,
            patch("app.services.highlight.highlight_service", mock_highlight_service),
        ):
            mock_settings.highlight_enabled = True

            await channel_state.set_current_channel(channel1)
            await _drain_reconcile()
            await channel_state.set_current_channel(channel2)
            await _drain_reconcile()

            # Viewers still on channel1 through their own pick keep its buffer
            mock_highlight_service.stop_recording.assert_not_called()
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

        mock_highlight_service = AsyncMock(spec=HighlightService)

        with (
            patch("app.services.channel_state.settings") as mock_settings,
            patch("app.services.highlight.highlight_service", mock_highlight_service),
        ):
            mock_settings.highlight_enabled = True

            await channel_state.set_current_channel(channel)
            await _drain_reconcile()
            await channel_state.set_current_channel(channel)
            await _drain_reconcile()

            # Should not have called stop_recording (same channel)
            mock_highlight_service.stop_recording.assert_not_called()
            # Should have started recording twice (but that's fine, it's idempotent)
            assert mock_highlight_service.start_recording.call_count == 2

    @pytest.mark.asyncio
    async def test_clearing_channel_keeps_recording(self) -> None:
        """Should leave the recorder to the idle sweep when clearing (E-14)."""
        channel = Channel(
            id="uuid-1",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-1",
            guide_id="guide-1",
        )

        mock_highlight_service = AsyncMock(spec=HighlightService)

        with (
            patch("app.services.channel_state.settings") as mock_settings,
            patch("app.services.highlight.highlight_service", mock_highlight_service),
        ):
            mock_settings.highlight_enabled = True

            await channel_state.set_current_channel(channel)
            await _drain_reconcile()
            mock_highlight_service.reset_mock()

            await channel_state.clear_current_channel_async()

            assert channel_state.get_current_channel() is None
            mock_highlight_service.stop_recording.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_recording_when_highlight_disabled(self) -> None:
        """Should not call recording functions when highlight is disabled."""
        channel = Channel(
            id="uuid-1",
            name="TSN",
            stream_url="https://streams.example.com/stream/uuid-1",
            guide_id="guide-1",
        )

        mock_highlight_service = AsyncMock(spec=HighlightService)

        with (
            patch("app.services.channel_state.settings") as mock_settings,
            patch("app.services.highlight.highlight_service", mock_highlight_service),
        ):
            mock_settings.highlight_enabled = False

            await channel_state.set_current_channel(channel)

            # Should not have called any recording functions
            mock_highlight_service.start_recording.assert_not_called()
            mock_highlight_service.stop_recording.assert_not_called()


def _live(channel_id: str) -> Channel:
    return Channel(
        id=channel_id,
        name=f"Channel {channel_id}",
        stream_url=f"https://streams.example.com/stream/{channel_id}",
        guide_id=f"guide-{channel_id}",
    )


class TestSerialisedLiveChanges:
    """Live changes broadcast in order and never wait on recorder work (B-02, E-14)."""

    @pytest.fixture
    def highlight(self):
        """Highlights on, with the recorder API stubbed and broadcasts captured."""
        service = AsyncMock(spec=HighlightService)
        sent: list[dict] = []

        async def capture(message: dict) -> None:
            sent.append(message)

        with (
            patch.object(settings, "highlight_enabled", True),
            patch("app.services.highlight.highlight_service", service),
            patch("app.services.channel_state.broadcast", side_effect=capture),
        ):
            yield service, sent

    @staticmethod
    def _last_live(sent: list[dict]) -> str | None:
        updates = [m for m in sent if m["type"] == "channel_update"]
        channel = updates[-1]["channel"]
        return channel["id"] if channel else None

    @pytest.mark.asyncio
    async def test_overlapping_sets_broadcast_in_order_and_return_their_own_channel(
        self, highlight
    ) -> None:
        service, sent = highlight

        async def start(channel_id: str, *_args, **_kwargs) -> bool:
            # The first change's recorder start is the slow one
            await asyncio.sleep(0.05 if channel_id == "A" else 0)
            return True

        service.start_recording.side_effect = start

        first, second = await asyncio.gather(
            channel_state.set_current_channel(_live("A"), user="alice"),
            channel_state.set_current_channel(_live("B"), user="bob"),
        )
        await _drain_reconcile()

        assert first.id == "A"
        assert second.id == "B"
        current = channel_state.get_current_channel()
        assert current is not None
        assert self._last_live(sent) == current.id == "B"

    @pytest.mark.asyncio
    async def test_set_broadcasts_before_a_slow_recorder_start_finishes(self, highlight) -> None:
        service, sent = highlight
        started = asyncio.Event()

        async def slow_start(*_args, **_kwargs) -> bool:
            started.set()
            await asyncio.sleep(2)
            return True

        service.start_recording.side_effect = slow_start

        result = await asyncio.wait_for(
            channel_state.set_current_channel(_live("A"), user="alice"), timeout=0.5
        )

        assert result.id == "A"
        assert self._last_live(sent) == "A"
        await asyncio.wait_for(started.wait(), timeout=0.5)
        # Shutdown cancels the start still in flight
        await asyncio.wait_for(channel_state.stop_reconcile_task(), timeout=0.5)
        assert channel_state._reconcile_task is not None
        assert channel_state._reconcile_task.cancelled()

    @pytest.mark.asyncio
    async def test_quick_changes_only_start_the_latest_channel(self, highlight) -> None:
        service, _sent = highlight
        a_started = asyncio.Event()

        async def start(channel_id: str, *_args, **_kwargs) -> bool:
            if channel_id == "A":
                a_started.set()
                await asyncio.sleep(0.05)
            return True

        service.start_recording.side_effect = start

        await channel_state.set_current_channel(_live("A"))
        await asyncio.wait_for(a_started.wait(), timeout=0.5)
        await channel_state.set_current_channel(_live("B"))
        await channel_state.set_current_channel(_live("C"))
        await _drain_reconcile()

        started = [call.args[0] for call in service.start_recording.await_args_list]
        assert started == ["A", "C"]
        service.stop_recording.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("set_first", [True, False])
    async def test_clear_racing_a_set_leaves_state_and_broadcast_in_agreement(
        self, highlight, set_first: bool
    ) -> None:
        service, sent = highlight

        async def stop(channel_id: str) -> None:
            # Stopping the old channel's FFmpeg is the slow part
            await asyncio.sleep(0.05 if channel_id == "A" else 0)

        service.stop_recording.side_effect = stop
        await channel_state.set_current_channel(_live("A"))
        await _drain_reconcile()

        change = channel_state.set_current_channel(_live("B"), user="bob")
        clear = channel_state.clear_current_channel_async(user="carol")
        await asyncio.gather(*((change, clear) if set_first else (clear, change)))
        await _drain_reconcile()

        current = channel_state.get_current_channel()
        assert self._last_live(sent) == (current.id if current else None)
        service.stop_recording.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("second", ["set", "clear"])
    async def test_slow_broadcast_is_not_overtaken_by_a_later_change(
        self, highlight, second: str
    ) -> None:
        _service, sent = highlight

        async def slow_for_a(message: dict) -> None:
            # A slow socket holds up the first change's broadcast
            channel = message.get("channel")
            if channel and channel["id"] == "A":
                await asyncio.sleep(0.05)
            sent.append(message)

        with patch("app.services.channel_state.broadcast", side_effect=slow_for_a):
            later = (
                channel_state.set_current_channel(_live("B"), user="bob")
                if second == "set"
                else channel_state.clear_current_channel_async(user="carol")
            )
            await asyncio.gather(channel_state.set_current_channel(_live("A"), user="alice"), later)
        await _drain_reconcile()

        current = channel_state.get_current_channel()
        assert self._last_live(sent) == (current.id if current else None)

    @pytest.mark.asyncio
    async def test_recorder_failure_is_logged_and_does_not_escape(self, highlight) -> None:
        service, sent = highlight
        service.start_recording.side_effect = RuntimeError("ffmpeg missing")

        result = await channel_state.set_current_channel(_live("A"))
        await _drain_reconcile()

        assert result.id == "A"
        assert self._last_live(sent) == "A"
        task = channel_state._reconcile_task
        assert task is not None and task.exception() is None
