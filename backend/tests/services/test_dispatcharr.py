"""Tests for Dispatcharr service."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.models.channel import Channel
from app.services.dispatcharr import (
    DispatchrrUnavailableError,
    dispatcharr_auth_headers,
    extract_uuid,
    get_channel_groups,
    get_lineup,
)


class TestDispatcharrAuthHeaders:
    """Tests for dispatcharr_auth_headers."""

    def test_builds_apikey_header(self) -> None:
        """Should send the key using Dispatcharr's ApiKey scheme, not Bearer."""
        with patch("app.services.dispatcharr.settings") as mock_settings:
            mock_settings.dispatcharr_api_key = "secret-key"
            assert dispatcharr_auth_headers() == {"Authorization": "ApiKey secret-key"}

    def test_raises_when_api_key_missing(self) -> None:
        """Should fail loudly rather than issuing an unauthenticated request."""
        with patch("app.services.dispatcharr.settings") as mock_settings:
            mock_settings.dispatcharr_api_key = None
            with pytest.raises(DispatchrrUnavailableError, match="DISPATCHARR_API_KEY"):
                dispatcharr_auth_headers()

    @pytest.mark.asyncio
    async def test_channel_groups_sends_api_key(self) -> None:
        """Authenticated calls should carry the API key header."""
        response = MagicMock()
        response.json.return_value = []
        response.raise_for_status = MagicMock()

        with patch("app.services.dispatcharr.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with patch("app.services.dispatcharr.settings") as mock_settings:
                mock_settings.dispatcharr_api_key = "secret-key"
                mock_settings.dispatcharr_url = "http://test:9191"
                await get_channel_groups()

        _, kwargs = mock_client.get.call_args
        assert kwargs["headers"] == {"Authorization": "ApiKey secret-key"}

    @pytest.mark.asyncio
    async def test_channel_groups_raises_without_api_key(self) -> None:
        """No key configured should surface as DispatchrrUnavailableError (503)."""
        with patch("app.services.dispatcharr.settings") as mock_settings:
            mock_settings.dispatcharr_api_key = None
            with pytest.raises(DispatchrrUnavailableError):
                await get_channel_groups()


class TestExtractUuid:
    """Tests for extract_uuid utility function."""

    def test_extract_uuid_from_standard_url(self) -> None:
        """Extract UUID from standard Dispatcharr URL."""
        url = "http://10.8.0.2:9191/proxy/ts/stream/abc-123-def-456"
        assert extract_uuid(url) == "abc-123-def-456"

    def test_extract_uuid_from_url_with_long_uuid(self) -> None:
        """Extract UUID from URL with full UUID format."""
        url = "http://10.8.0.2:9191/proxy/ts/stream/550e8400-e29b-41d4-a716-446655440000"
        assert extract_uuid(url) == "550e8400-e29b-41d4-a716-446655440000"

    def test_extract_uuid_preserves_entire_path_segment(self) -> None:
        """UUID extraction gets the last path segment regardless of format."""
        url = "http://10.8.0.2:9191/proxy/ts/stream/my-stream-id"
        assert extract_uuid(url) == "my-stream-id"


class TestGetLineup:
    """Tests for get_lineup service function."""

    @pytest.mark.asyncio
    async def test_get_lineup_success(self) -> None:
        """Successful lineup fetch transforms Dispatcharr format to Channel format."""
        dispatcharr_response = [
            {
                "GuideNumber": "1.1",
                "GuideName": "TSN",
                "URL": "http://10.8.0.2:9191/proxy/ts/stream/uuid-abc123",
                "Guide_ID": "1",
            },
            {
                "GuideNumber": "2.1",
                "GuideName": "Sportsnet",
                "URL": "http://10.8.0.2:9191/proxy/ts/stream/uuid-def456",
                "Guide_ID": "2",
            },
        ]

        mock_response = MagicMock()
        mock_response.json.return_value = dispatcharr_response
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.dispatcharr.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            channels = await get_lineup()

        assert len(channels) == 2
        assert all(isinstance(c, Channel) for c in channels)
        assert channels[0].id == "uuid-abc123"
        assert channels[0].name == "TSN"
        assert channels[0].guide_id == "1"
        assert "uuid-abc123" in channels[0].stream_url
        assert channels[1].id == "uuid-def456"
        assert channels[1].name == "Sportsnet"
        assert channels[1].guide_id == "2"

    @pytest.mark.asyncio
    async def test_get_lineup_uses_stream_base_url(self) -> None:
        """Stream URLs use STREAM_BASE_URL from config, not Dispatcharr internal URL."""
        dispatcharr_response = [
            {
                "GuideNumber": "1.1",
                "GuideName": "TSN",
                "URL": "http://10.8.0.2:9191/proxy/ts/stream/uuid-abc123",
                "Guide_ID": "1",
            },
        ]

        mock_response = MagicMock()
        mock_response.json.return_value = dispatcharr_response
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.dispatcharr.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with patch("app.services.dispatcharr.settings") as mock_settings:
                mock_settings.dispatcharr_url = "http://10.8.0.2:9191"
                mock_settings.stream_base_url = "https://streams.example.com"

                channels = await get_lineup()

        # Stream URL should use the public STREAM_BASE_URL, not internal Dispatcharr URL
        assert channels[0].stream_url == "https://streams.example.com/proxy/ts/stream/uuid-abc123"
        assert "10.8.0.2" not in channels[0].stream_url
        assert channels[0].guide_id == "1"

    @pytest.mark.asyncio
    async def test_get_lineup_handles_empty_response(self) -> None:
        """Empty lineup from Dispatcharr returns empty list."""
        mock_response = MagicMock()
        mock_response.json.return_value = []
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.dispatcharr.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            channels = await get_lineup()

        assert channels == []

    @pytest.mark.asyncio
    async def test_get_lineup_connection_error_raises_unavailable(self) -> None:
        """Connection error raises DispatchrrUnavailableError."""
        with patch("app.services.dispatcharr.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.ConnectError("Connection refused")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with pytest.raises(DispatchrrUnavailableError) as exc_info:
                await get_lineup()

        assert "Failed to fetch channels" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_get_lineup_timeout_raises_unavailable(self) -> None:
        """Timeout error raises DispatchrrUnavailableError."""
        with patch("app.services.dispatcharr.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.side_effect = httpx.TimeoutException("Request timed out")
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with pytest.raises(DispatchrrUnavailableError) as exc_info:
                await get_lineup()

        assert "Failed to fetch channels" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_get_lineup_http_error_raises_unavailable(self) -> None:
        """HTTP error (e.g., 500) raises DispatchrrUnavailableError."""
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Server Error",
            request=MagicMock(),
            response=MagicMock(status_code=500),
        )

        with patch("app.services.dispatcharr.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with pytest.raises(DispatchrrUnavailableError) as exc_info:
                await get_lineup()

        assert "Failed to fetch channels" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_get_lineup_calls_correct_endpoint(self) -> None:
        """get_lineup calls the correct Dispatcharr endpoint."""
        mock_response = MagicMock()
        mock_response.json.return_value = []
        mock_response.raise_for_status = MagicMock()

        with patch("app.services.dispatcharr.httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__.return_value = mock_client
            mock_client.__aexit__.return_value = None
            mock_client_class.return_value = mock_client

            with patch("app.services.dispatcharr.settings") as mock_settings:
                mock_settings.dispatcharr_url = "http://10.8.0.2:9191"
                mock_settings.stream_base_url = "https://streams.example.com"

                await get_lineup()

        mock_client.get.assert_called_once_with("http://10.8.0.2:9191/hdhr/lineup.json")
