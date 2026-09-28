"""Tests for highlight capture service."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import settings
from app.services.highlight import (
    RECORDER_RW_TIMEOUT_MICROSECONDS,
    ChannelRecorder,
    HighlightService,
    highlight_service,
)


class TestChannelRecorder:
    """Tests for ChannelRecorder class."""

    def test_init_creates_recorder(self) -> None:
        """Should initialize recorder with channel info."""
        recorder = ChannelRecorder("channel-1", "http://stream.url/test.m3u8")
        assert recorder.channel_id == "channel-1"
        assert recorder.stream_url == "http://stream.url/test.m3u8"
        assert recorder.process is None
        assert not recorder.is_running

    def test_is_running_false_when_no_process(self) -> None:
        """Should return False when no process exists."""
        recorder = ChannelRecorder("channel-1", "http://stream.url")
        assert not recorder.is_running

    def test_is_running_false_when_process_stopped(self) -> None:
        """Should return False when process has stopped."""
        recorder = ChannelRecorder("channel-1", "http://stream.url")
        mock_process = MagicMock()
        mock_process.poll.return_value = 0  # Process exited
        recorder.process = mock_process
        assert not recorder.is_running

    def test_is_running_true_when_process_running(self) -> None:
        """Should return True when process is running."""
        recorder = ChannelRecorder("channel-1", "http://stream.url")
        mock_process = MagicMock()
        mock_process.poll.return_value = None  # Process still running
        recorder.process = mock_process
        assert recorder.is_running

    def test_get_buffer_seconds_zero_when_not_running(self) -> None:
        """Should return 0 when recorder not running."""
        recorder = ChannelRecorder("channel-1", "http://stream.url")
        assert recorder.get_buffer_seconds() == 0

    @pytest.mark.asyncio
    async def test_start_returns_false_when_ffmpeg_not_found(self) -> None:
        """Should return False if FFmpeg not installed."""
        recorder = ChannelRecorder("channel-1", "http://stream.url")

        with patch("subprocess.Popen", side_effect=FileNotFoundError("ffmpeg not found")):
            result = await recorder.start()
            assert not result

    @pytest.mark.asyncio
    async def test_start_bounds_reads_from_a_stalled_source(self, tmp_path, monkeypatch) -> None:
        """FFmpeg must exit on a silent upstream instead of hanging as 'running'."""
        monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
        recorder = ChannelRecorder("channel-1", "http://stream.url")

        with patch("subprocess.Popen", side_effect=FileNotFoundError) as spawn:
            await recorder.start()

        cmd = spawn.call_args.args[0]
        timeout = cmd.index("-rw_timeout")
        assert cmd[timeout + 1] == str(RECORDER_RW_TIMEOUT_MICROSECONDS)
        assert timeout < cmd.index("-i")

    @pytest.mark.asyncio
    async def test_stop_cleans_up_resources(self) -> None:
        """Should clean up process and segment directory on stop."""
        recorder = ChannelRecorder("channel-1", "http://stream.url")

        # Mock a running process
        mock_process = MagicMock()
        mock_process.poll.return_value = None
        mock_process.pid = 12345
        recorder.process = mock_process

        # Mock segment directory
        from pathlib import Path

        with (
            patch.object(Path, "exists", return_value=True),
            patch("shutil.rmtree"),
            patch("os.getpgid", return_value=12345),
            patch("os.killpg"),
        ):
            await recorder.stop()

        assert recorder.process is None


class TestHighlightService:
    """Tests for HighlightService class."""

    @pytest.fixture
    def service(self) -> HighlightService:
        """Create fresh service instance."""
        return HighlightService()

    def test_get_status_when_disabled(self, service: HighlightService) -> None:
        """Should return disabled status when feature disabled."""
        with patch("app.services.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = False
            status = service.get_status("channel-1")
            assert status["enabled"] is False
            assert status["recording"] is False

    def test_get_status_when_no_recorder(self, service: HighlightService) -> None:
        """Should return not recording when no recorder exists."""
        with patch("app.services.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = True
            status = service.get_status("channel-1")
            assert status["enabled"] is True
            assert status["recording"] is False

    @pytest.mark.asyncio
    async def test_start_recording_returns_false_when_disabled(
        self, service: HighlightService
    ) -> None:
        """Should not start recording when feature disabled."""
        with patch("app.services.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = False
            result = await service.start_recording("channel-1", "http://stream.url")
            assert not result

    @pytest.mark.asyncio
    async def test_stop_all_clears_recorders(self, service: HighlightService) -> None:
        """Should stop all recorders and clear dict."""
        # Add mock recorder
        mock_recorder = MagicMock()
        mock_recorder.stop = AsyncMock()
        service._recorders["channel-1"] = mock_recorder

        await service.stop_all()

        mock_recorder.stop.assert_called_once()
        assert len(service._recorders) == 0


class TestHighlightServiceSingleton:
    """Tests for global highlight_service singleton."""

    def test_singleton_exists(self) -> None:
        """Should have a global service instance."""
        assert highlight_service is not None
        assert isinstance(highlight_service, HighlightService)


class TestStartBackoff:
    """A channel whose FFmpeg fails to start is not respawned on every status poll."""

    @pytest.fixture(autouse=True)
    def enabled(self, tmp_path, monkeypatch):
        from app.services.media_limits import recorder_budget

        monkeypatch.setattr(settings, "highlight_enabled", True)
        monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
        recorder_budget.owners.clear()
        highlight_service.clear_start_backoff()
        yield
        recorder_budget.owners.clear()
        highlight_service.clear_start_backoff()

    @pytest.fixture
    def source(self):
        from types import SimpleNamespace

        from app.models.channel import Channel

        channel = Channel(id="failing", name="F", streamUrl="https://source/ts", guideId="1")
        with patch(
            "app.services.highlight.resolve_media_channel",
            AsyncMock(return_value=SimpleNamespace(channel=channel)),
        ):
            yield

    @staticmethod
    def expire(service: HighlightService, channel_id: str) -> None:
        failures, _ = service._start_failures[channel_id]
        service._start_failures[channel_id] = (failures, 0.0)

    @staticmethod
    def window(service: HighlightService, channel_id: str) -> float:
        return service._start_failures[channel_id][1] - time.monotonic()

    @pytest.mark.asyncio
    async def test_failed_start_waits_out_a_doubling_window(self, source) -> None:
        service = HighlightService()
        with patch("subprocess.Popen", side_effect=FileNotFoundError) as spawn:
            for _ in range(3):
                assert await service.start_recording("failing", "") is False
            assert spawn.call_count == 1
            assert self.window(service, "failing") == pytest.approx(30, abs=1)

            self.expire(service, "failing")
            assert await service.start_recording("failing", "") is False
            assert spawn.call_count == 2
            assert self.window(service, "failing") == pytest.approx(60, abs=1)

            for _ in range(10):
                self.expire(service, "failing")
                await service.start_recording("failing", "")
            assert self.window(service, "failing") == pytest.approx(300, abs=1)

    @pytest.mark.asyncio
    async def test_successful_start_resets_the_backoff(self, source) -> None:
        service = HighlightService()
        with patch("subprocess.Popen", side_effect=FileNotFoundError):
            await service.start_recording("failing", "")
        self.expire(service, "failing")
        with (
            patch.object(ChannelRecorder, "start", AsyncMock(return_value=True)),
            patch.object(ChannelRecorder, "stop", AsyncMock()),
        ):
            assert await service.start_recording("failing", "") is True
            assert "failing" not in service._start_failures
            await service.stop_all()

    def test_status_polls_inside_the_window_do_not_respawn(self, source) -> None:
        from fastapi.testclient import TestClient

        from app.main import app
        from app.services.auth import create_access_token

        token = create_access_token({"sub": "alice", "role": "viewer"})
        client = TestClient(app)
        with patch("subprocess.Popen", side_effect=FileNotFoundError) as spawn:
            for _ in range(3):
                response = client.get(
                    "/api/highlight/status/failing",
                    headers={"Authorization": f"Bearer {token}"},
                )
                assert response.status_code == 200
                assert response.json()["recording"] is False
        assert spawn.call_count == 1

    @pytest.mark.asyncio
    async def test_live_change_clears_the_backoff(self, source) -> None:
        from app.models.channel import Channel
        from app.services import channel_state

        channel = Channel(id="failing", name="F", streamUrl="https://source/ts", guideId="1")
        channel_state.clear_current_channel()
        try:
            with (
                patch("subprocess.Popen", side_effect=FileNotFoundError) as spawn,
                patch("app.services.channel_state.broadcast", AsyncMock()),
                patch("app.services.channel_state.broadcast_channel_update", AsyncMock()),
            ):
                await highlight_service.start_recording("failing", "")
                await channel_state.set_current_channel(channel)
                assert spawn.call_count == 2

                await channel_state.clear_current_channel_async()
                assert not highlight_service._start_failures
        finally:
            channel_state.clear_current_channel()


class TestCaptureAfterRecorderStop:
    """A recorder stopped or replaced during the tail wait is looked up again, not reused."""

    @pytest.fixture(autouse=True)
    def enabled(self, monkeypatch):
        monkeypatch.setattr(settings, "highlight_enabled", True)

    @staticmethod
    def running() -> MagicMock:
        recorder = MagicMock()
        recorder.is_running = True
        recorder.wait_for_current_segment = AsyncMock()
        return recorder

    @pytest.mark.asyncio
    async def test_a_recorder_stopped_while_waiting_answers_live_tv_changed(self) -> None:
        from app.services.highlight import RECORDER_GONE_ERROR

        service = HighlightService()
        recorder = self.running()

        async def stopped_meanwhile() -> bool:
            del service._recorders["channel-1"]
            recorder.is_running = False
            return False

        recorder.wait_for_current_segment.side_effect = stopped_meanwhile
        service._recorders["channel-1"] = recorder
        with patch.object(service.captures, "create", AsyncMock()) as create:
            assert await service.create_capture("channel-1", owner="viewer") == (
                None,
                RECORDER_GONE_ERROR,
            )
        create.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_recorder_restarted_while_waiting_is_the_one_captured(self) -> None:
        service = HighlightService()
        old, new = self.running(), self.running()

        async def restarted_meanwhile() -> bool:
            old.is_running = False
            service._recorders["channel-1"] = new
            return False

        old.wait_for_current_segment.side_effect = restarted_meanwhile
        service._recorders["channel-1"] = old
        with patch.object(service.captures, "create", AsyncMock(return_value="made")) as create:
            assert await service.create_capture("channel-1", owner="viewer") == ("made", None)
        assert create.await_args is not None and create.await_args.args[0] is new
