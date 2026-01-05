"""Tests for status service."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.models.status import DispatchrrStatus, ErsatzTVStatus
from app.services.status_service import (
    get_dispatcharr_status,
    get_ersatztv_status,
    get_system_status,
)


class TestGetErsatzTVStatus:
    """Tests for get_ersatztv_status function."""

    @pytest.mark.asyncio
    async def test_returns_online_status_with_sessions(self) -> None:
        """Should return online status with active sessions and enriched data."""
        sessions_data = [
            {
                "channelNumber": "1",
                "state": "SeekAndWorkAhead",
                "transcodedUntil": "2026-01-05T01:10:00+00:00",
            },
            {"channelNumber": "2", "state": "Playing"},
        ]
        channels_data = [
            {
                "number": 1,
                "name": "Movies",
                "ffmpegProfile": "1080 h264",
                "streamingMode": "HLS Segmenter",
            },
            {"number": 2, "name": "Sports", "ffmpegProfile": "720p", "streamingMode": "MPEG-TS"},
        ]
        profiles_data = [
            {
                "name": "1080 h264",
                "resolution": "1920x1080",
                "videoFormat": "H264",
                "videoBitrate": 2000,
                "audioFormat": "Aac",
                "audioBitrate": 192,
            },
            {
                "name": "720p",
                "resolution": "1280x720",
                "videoFormat": "H264",
                "videoBitrate": 1500,
                "audioFormat": "Ac3",
                "audioBitrate": 128,
            },
        ]

        with patch(
            "app.services.status_service._fetch_ersatztv_data",
            return_value=(sessions_data, channels_data, profiles_data),
        ):
            status = await get_ersatztv_status()

        assert status.name == "ErsatzTV"
        assert status.online is True
        assert status.active_sessions == 2
        assert len(status.sessions) == 2
        assert status.sessions[0].channel_number == 1
        assert status.sessions[0].channel_name == "Movies"
        assert status.sessions[0].state == "SeekAndWorkAhead"
        assert status.sessions[0].resolution == "1920x1080"
        assert status.sessions[0].video_codec == "H264"
        assert status.sessions[0].video_bitrate == 2000
        assert status.sessions[0].streaming_mode == "HLS Segmenter"
        assert status.error is None

    @pytest.mark.asyncio
    async def test_returns_online_status_with_empty_sessions(self) -> None:
        """Should return online status with no active sessions."""
        with patch(
            "app.services.status_service._fetch_ersatztv_data",
            return_value=([], [], []),
        ):
            status = await get_ersatztv_status()

        assert status.name == "ErsatzTV"
        assert status.online is True
        assert status.active_sessions == 0
        assert status.sessions == []

    @pytest.mark.asyncio
    async def test_returns_offline_on_connection_error(self) -> None:
        """Should return offline status when sessions fetch fails and base URL unreachable."""
        with (
            patch(
                "app.services.status_service._fetch_ersatztv_data",
                return_value=(None, [], []),  # sessions is None = fetch failed
            ),
            patch("app.services.status_service.httpx.AsyncClient") as mock_client_class,
        ):
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.ConnectError("Connection refused")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            status = await get_ersatztv_status()

        assert status.name == "ErsatzTV"
        assert status.online is False
        assert status.error is not None

    @pytest.mark.asyncio
    async def test_returns_offline_on_timeout(self) -> None:
        """Should return offline status when request times out."""
        with (
            patch(
                "app.services.status_service._fetch_ersatztv_data",
                return_value=(None, [], []),
            ),
            patch("app.services.status_service.httpx.AsyncClient") as mock_client_class,
        ):
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.TimeoutException("Request timed out")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            status = await get_ersatztv_status()

        assert status.name == "ErsatzTV"
        assert status.online is False
        assert status.error is not None

    @pytest.mark.asyncio
    async def test_handles_partial_api_failures(self) -> None:
        """Should still work when channels/profiles endpoints fail."""
        sessions_data = [{"channelNumber": "1", "state": "Playing"}]

        # Sessions succeeds, channels and profiles return empty (simulating 404)
        with patch(
            "app.services.status_service._fetch_ersatztv_data",
            return_value=(sessions_data, [], []),
        ):
            status = await get_ersatztv_status()

        assert status.name == "ErsatzTV"
        assert status.online is True
        assert status.active_sessions == 1
        # Session exists but without enriched data
        assert status.sessions[0].channel_number == 1
        assert status.sessions[0].resolution is None


class TestGetDispatchrrStatus:
    """Tests for get_dispatcharr_status function."""

    @pytest.mark.asyncio
    async def test_returns_online_status_with_streams(self) -> None:
        """Should return online status with stream info from proxy status."""
        # Mock token response
        token_response = MagicMock()
        token_response.status_code = 200
        token_response.json.return_value = {"access": "test-token", "refresh": "refresh"}

        # Mock CSRF response
        csrf_response = MagicMock()
        csrf_response.cookies = {}

        # Mock proxy status response
        proxy_status_response = {
            "channels": [
                {
                    "channel_id": "abc123",
                    "stream_name": "Sports HD",
                    "state": "active",
                    "client_count": 2,
                    "uptime": 300.5,
                    "total_bytes": 50000000,
                    "avg_bitrate": "5.5 Mbps",
                    "video_codec": "h264",
                    "resolution": "1920x1080",
                    "source_fps": 60.0,
                    "clients": [
                        {
                            "client_id": "c1",
                            "user_agent": "Chrome",
                            "ip_address": "1.2.3.4",
                            "connected_since": 100,
                        },
                        {
                            "client_id": "c2",
                            "user_agent": "Firefox",
                            "ip_address": "5.6.7.8",
                            "connected_since": 50,
                        },
                    ],
                },
                {
                    "channel_id": "def456",
                    "stream_name": "Movies",
                    "state": "active",
                    "client_count": 1,
                    "uptime": 60.0,
                    "total_bytes": 10000000,
                    "avg_bitrate": "3.0 Mbps",
                    "video_codec": "h264",
                    "resolution": "1280x720",
                    "source_fps": 30.0,
                    "clients": [
                        {
                            "client_id": "c3",
                            "user_agent": "Safari",
                            "ip_address": "9.10.11.12",
                            "connected_since": 30,
                        },
                    ],
                },
            ],
            "count": 2,
        }
        status_response = MagicMock()
        status_response.json.return_value = proxy_status_response
        status_response.raise_for_status = MagicMock()

        with patch("app.services.status_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.cookies = MagicMock()
            mock_client.cookies.get.return_value = "csrf-token"
            # Order: CSRF GET, token POST, proxy status GET
            mock_client.get.side_effect = [csrf_response, status_response]
            mock_client.post.return_value = token_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with patch("app.services.status_service.settings") as mock_settings:
                mock_settings.dispatcharr_url = "http://test:9191"
                mock_settings.dispatcharr_username = "testuser"
                mock_settings.dispatcharr_password = "testpass"

                status = await get_dispatcharr_status()

        assert status.name == "Dispatcharr"
        assert status.online is True
        assert status.active_streams == 2
        assert status.total_viewers == 3
        assert len(status.streams) == 2
        assert status.streams[0].stream_name == "Sports HD"
        assert status.streams[0].client_count == 2
        assert status.streams[0].resolution == "1920x1080"
        assert status.error is None

    @pytest.mark.asyncio
    async def test_returns_offline_on_connection_error(self) -> None:
        """Should return offline status when connection fails."""
        with patch("app.services.status_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.ConnectError("Connection refused")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            status = await get_dispatcharr_status()

        assert status.name == "Dispatcharr"
        assert status.online is False
        assert status.error is not None

    @pytest.mark.asyncio
    async def test_falls_back_to_lineup_when_no_credentials(self) -> None:
        """Should fall back to lineup check when no credentials configured."""
        # Mock lineup response (no auth required)
        mock_lineup_response = MagicMock()
        mock_lineup_response.status_code = 200

        with patch("app.services.status_service.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_lineup_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with patch("app.services.status_service.settings") as mock_settings:
                mock_settings.dispatcharr_url = "http://test:9191"
                mock_settings.dispatcharr_username = None
                mock_settings.dispatcharr_password = None

                status = await get_dispatcharr_status()

        assert status.name == "Dispatcharr"
        assert status.online is True
        assert status.active_streams == 0
        assert status.error == "Auth required for stats"


class TestGetSystemStatus:
    """Tests for get_system_status function."""

    @pytest.mark.asyncio
    async def test_returns_combined_status(self) -> None:
        """Should return status for both services."""
        mock_ersatztv = ErsatzTVStatus(
            name="ErsatzTV",
            online=True,
            last_checked=datetime.now(UTC),
            active_sessions=0,
            sessions=[],
        )
        mock_dispatcharr = DispatchrrStatus(
            name="Dispatcharr",
            online=True,
            last_checked=datetime.now(UTC),
            active_streams=0,
            total_viewers=0,
            streams=[],
        )

        with (
            patch(
                "app.services.status_service.get_ersatztv_status",
                return_value=mock_ersatztv,
            ),
            patch(
                "app.services.status_service.get_dispatcharr_status",
                return_value=mock_dispatcharr,
            ),
        ):
            status = await get_system_status()

        assert status.ersatztv is not None
        assert status.dispatcharr is not None
        assert status.ersatztv.name == "ErsatzTV"
        assert status.dispatcharr.name == "Dispatcharr"

    @pytest.mark.asyncio
    async def test_handles_partial_failure(self) -> None:
        """Should handle one service being offline."""
        mock_ersatztv = ErsatzTVStatus(
            name="ErsatzTV",
            online=True,
            last_checked=datetime.now(UTC),
            active_sessions=0,
            sessions=[],
        )
        mock_dispatcharr = DispatchrrStatus(
            name="Dispatcharr",
            online=False,
            last_checked=datetime.now(UTC),
            error="Connection refused",
        )

        with (
            patch(
                "app.services.status_service.get_ersatztv_status",
                return_value=mock_ersatztv,
            ),
            patch(
                "app.services.status_service.get_dispatcharr_status",
                return_value=mock_dispatcharr,
            ),
        ):
            status = await get_system_status()

        assert status.ersatztv.online is True
        assert status.dispatcharr.online is False
