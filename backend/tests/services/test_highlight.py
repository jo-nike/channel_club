"""Tests for highlight capture service."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.highlight import ChannelRecorder, HighlightService, highlight_service


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
    async def test_save_highlight_fails_when_disabled(self, service: HighlightService) -> None:
        """Should return error when feature disabled."""
        with patch("app.services.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = False
            mp4_bytes, error = await service.save_highlight("channel-1")
            assert mp4_bytes is None
            assert error == "Highlight feature is disabled"

    @pytest.mark.asyncio
    async def test_save_highlight_fails_when_no_recorder(self, service: HighlightService) -> None:
        """Should return error when no recorder for channel."""
        with patch("app.services.highlight.settings") as mock_settings:
            mock_settings.highlight_enabled = True
            mp4_bytes, error = await service.save_highlight("channel-1")
            assert mp4_bytes is None
            assert error == "No recording active for this channel"

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
