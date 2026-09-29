"""Tests for ErsatzTV router endpoints.

Story: 7.6 - ErsatzTV API Endpoints
"""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from io import StringIO
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from loguru import logger

from app.config import settings
from app.main import app
from app.models.ersatztv import EPGChannel, Programme
from app.services.auth import create_access_token
from app.services.ersatztv.refresh import FeedUnavailableError
from app.services.http_clients import ERSATZTV
from tests.http_helpers import mock_upstream


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def auth_header() -> dict[str, str]:
    """Create valid auth header with JWT token."""
    token = create_access_token({"sub": "testuser", "role": "viewer"})
    return {"Authorization": f"Bearer {token}"}


@contextmanager
def _upstream(status: int, body: bytes, content_type: str) -> Iterator[list[httpx.Request]]:
    """Route the router's ErsatzTV client to a MockTransport; yield the requests it sees."""
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(status, content=body, headers={"content-type": content_type})

    mock_upstream(ERSATZTV, handler)
    yield requests


@pytest.fixture
def mock_channel() -> EPGChannel:
    """Create a mock EPGChannel for testing."""
    return EPGChannel(
        id="comedy-classics",
        name="Comedy Classics",
        stream_url="http://192.168.50.108:8409/iptv/channel/1.m3u8",
        logo_url="/api/ersatztv/logos/comedy-classics",
        original_logo_url="http://192.168.50.108:8409/logos/comedy.png",
        number=1,
        group="Movies",
    )


@pytest.fixture
def mock_programme() -> Programme:
    """Create a mock Programme for testing."""
    now = datetime.now(UTC)
    return Programme(
        id="comedy-classics_1735927200",
        channel_id="comedy-classics",
        title="Airplane!",
        description="Classic comedy film",
        start=now - timedelta(minutes=30),
        stop=now + timedelta(minutes=60),
        category=["Comedy", "Movie"],
    )


class TestListChannels:
    """Tests for GET /api/ersatztv/channels endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/ersatztv/channels")
        assert response.status_code == 401

    def test_returns_503_when_ersatztv_unavailable(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 503 when ErsatzTV is unavailable."""
        with patch(
            "app.routers.ersatztv.get_channels",
            side_effect=FeedUnavailableError("Failed to load channels from ErsatzTV"),
        ):
            response = client.get("/api/ersatztv/channels", headers=auth_header)

        assert response.status_code == 503
        assert response.json()["detail"] == "ErsatzTV service unavailable"

    def test_returns_channels(
        self, client: TestClient, auth_header: dict[str, str], mock_channel: EPGChannel
    ) -> None:
        """Returns list of channels when authenticated."""
        with patch("app.routers.ersatztv.get_channels", return_value=[mock_channel]):
            response = client.get("/api/ersatztv/channels", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert "channels" in data
        assert len(data["channels"]) == 1
        assert data["channels"][0]["id"] == "comedy-classics"
        assert data["channels"][0]["name"] == "Comedy Classics"

    def test_returns_empty_list_when_no_channels(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns empty list when no channels exist."""
        with patch("app.routers.ersatztv.get_channels", return_value=[]):
            response = client.get("/api/ersatztv/channels", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["channels"] == []

    def test_response_uses_camel_case(
        self, client: TestClient, auth_header: dict[str, str], mock_channel: EPGChannel
    ) -> None:
        """Response uses camelCase field names."""
        with patch("app.routers.ersatztv.get_channels", return_value=[mock_channel]):
            response = client.get("/api/ersatztv/channels", headers=auth_header)

        data = response.json()
        channel = data["channels"][0]
        # Check camelCase is used
        assert "streamUrl" in channel
        assert "logoUrl" in channel
        # Check snake_case is NOT used
        assert "stream_url" not in channel
        assert "logo_url" not in channel

    def test_sends_no_internal_ersatztv_url(
        self, client: TestClient, auth_header: dict[str, str], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """C-12: no LAN URL reaches a browser; streamUrl is the tokenless proxy path."""
        base = "http://192.168.50.108:8409"
        monkeypatch.setattr(settings, "ersatztv_base_url", base)
        channels = [
            EPGChannel(
                id=f"ch{n}",
                name=f"Channel {n}",
                stream_url=f"{base}/iptv/channel/{n}.m3u8",
                logo_url=f"{base}/iptv/logos/{n}.png",
                number=n,
            )
            for n in (1, 2)
        ]
        with patch("app.services.ersatztv.epg_service.parse_m3u_playlist", return_value=channels):
            response = client.get("/api/ersatztv/channels", headers=auth_header)

        assert response.status_code == 200
        assert base not in response.text
        listed = response.json()["channels"]
        assert [c["streamUrl"] for c in listed] == [
            "/api/ersatztv/stream/ch1",
            "/api/ersatztv/stream/ch2",
        ]
        assert all("originalLogoUrl" not in c for c in listed)
        assert [c["logoUrl"] for c in listed] == [
            "/api/ersatztv/logos/ch1",
            "/api/ersatztv/logos/ch2",
        ]
        # The backend keeps the upstream URLs for the stream and logo routes
        assert channels[0].stream_url == f"{base}/iptv/channel/1.m3u8"
        assert channels[0].original_logo_url == f"{base}/iptv/logos/1.png"


class TestListProgrammes:
    """Tests for GET /api/ersatztv/programmes/{channel_id} endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/ersatztv/programmes/comedy-classics")
        assert response.status_code == 401

    def test_returns_503_when_ersatztv_unavailable(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 503 when ErsatzTV is unavailable."""
        with patch(
            "app.routers.ersatztv.get_programmes_by_channel",
            side_effect=FeedUnavailableError("Failed to load XMLTV"),
        ):
            response = client.get("/api/ersatztv/programmes/comedy-classics", headers=auth_header)

        assert response.status_code == 503
        assert response.json()["detail"] == "ErsatzTV service unavailable"

    def test_returns_programmes(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        mock_programme: Programme,
    ) -> None:
        """Returns list of programmes for channel."""
        with patch(
            "app.routers.ersatztv.get_programmes_by_channel",
            return_value=[mock_programme],
        ):
            response = client.get("/api/ersatztv/programmes/comedy-classics", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["channelId"] == "comedy-classics"
        assert len(data["programmes"]) == 1
        assert data["programmes"][0]["title"] == "Airplane!"

    def test_respects_hours_param(
        self, client: TestClient, auth_header: dict[str, str], mock_programme: Programme
    ) -> None:
        """Hours query param is passed to service."""
        with patch(
            "app.routers.ersatztv.get_programmes_by_channel",
            return_value=[mock_programme],
        ) as mock_get:
            response = client.get(
                "/api/ersatztv/programmes/comedy-classics?hours=12",
                headers=auth_header,
            )

        assert response.status_code == 200
        mock_get.assert_called_once_with("comedy-classics", hours=12)

    def test_hours_default_is_6(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Default hours param is 6."""
        with patch("app.routers.ersatztv.get_programmes_by_channel", return_value=[]) as mock_get:
            client.get("/api/ersatztv/programmes/comedy-classics", headers=auth_header)

        mock_get.assert_called_once_with("comedy-classics", hours=6)

    def test_hours_validation_min(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Hours param must be at least 1."""
        response = client.get(
            "/api/ersatztv/programmes/comedy-classics?hours=0", headers=auth_header
        )
        assert response.status_code == 422

    def test_hours_validation_max(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Hours param must be at most 168 (7 days)."""
        response = client.get(
            "/api/ersatztv/programmes/comedy-classics?hours=169", headers=auth_header
        )
        assert response.status_code == 422


class TestGetCurrentProgramme:
    """Tests for GET /api/ersatztv/current/{channel_id} endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/ersatztv/current/comedy-classics")
        assert response.status_code == 401

    def test_returns_503_when_ersatztv_unavailable(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 503 when ErsatzTV is unavailable."""
        with patch(
            "app.routers.ersatztv.get_current_programme",
            side_effect=FeedUnavailableError("Failed to load XMLTV"),
        ):
            response = client.get("/api/ersatztv/current/comedy-classics", headers=auth_header)

        assert response.status_code == 503
        assert response.json()["detail"] == "ErsatzTV service unavailable"

    def test_returns_current_and_next(
        self, client: TestClient, auth_header: dict[str, str], mock_programme: Programme
    ) -> None:
        """Returns current and next programme."""
        now = datetime.now(UTC)
        next_prog = Programme(
            id="comedy-classics_next",
            channel_id="comedy-classics",
            title="Naked Gun",
            start=now + timedelta(hours=1),
            stop=now + timedelta(hours=2, minutes=30),
        )

        with patch(
            "app.routers.ersatztv.get_current_programme",
            return_value=(mock_programme, next_prog),
        ):
            response = client.get("/api/ersatztv/current/comedy-classics", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["channelId"] == "comedy-classics"
        assert data["current"]["title"] == "Airplane!"
        assert data["nextUp"]["title"] == "Naked Gun"

    def test_handles_no_current_programme(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Handles case when no current programme exists."""
        with patch(
            "app.routers.ersatztv.get_current_programme",
            return_value=(None, None),
        ):
            response = client.get("/api/ersatztv/current/comedy-classics", headers=auth_header)

        assert response.status_code == 200
        data = response.json()
        assert data["channelId"] == "comedy-classics"
        assert data["current"] is None
        assert data["nextUp"] is None


class TestHeadStream:
    """Tests for HEAD /api/ersatztv/stream/{channel_id} endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated HEAD request returns 401."""
        response = client.head("/api/ersatztv/stream/comedy-classics")
        assert response.status_code == 401

    def test_returns_200_with_headers_only(
        self, client: TestClient, auth_header: dict[str, str], mock_channel: EPGChannel
    ) -> None:
        """HEAD request returns 200 with correct headers but no body."""
        with patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel):
            response = client.head("/api/ersatztv/stream/comedy-classics", headers=auth_header)

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/vnd.apple.mpegurl"
        assert response.content == b""  # No body for HEAD

    def test_returns_404_for_nonexistent_channel(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """HEAD request returns 404 when channel not found."""
        with patch("app.routers.ersatztv.get_channel_by_id", return_value=None):
            response = client.head("/api/ersatztv/stream/nonexistent", headers=auth_header)

        assert response.status_code == 404

    def test_accepts_token_query_param(self, client: TestClient, mock_channel: EPGChannel) -> None:
        """HEAD stream endpoint accepts token via query parameter."""
        token = create_access_token({"sub": "testuser", "role": "viewer"})

        with patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel):
            response = client.head(f"/api/ersatztv/stream/comedy-classics?token={token}")

        assert response.status_code == 200


class TestGetStream:
    """Tests for GET /api/ersatztv/stream/{channel_id} endpoint."""

    @pytest.mark.parametrize("failure", ["json", "html", "timeout", "exhausted", "late", "empty"])
    def test_cold_start_retries_before_manifest_validation(
        self, client: TestClient, auth_header: dict[str, str], mock_channel: EPGChannel, failure
    ) -> None:
        import gzip

        calls = []
        error_responses = []

        class ErrorBody(httpx.AsyncByteStream):
            async def __aiter__(self):
                raise AssertionError("Error body must not be read or parsed as HLS")
                yield b""

        def upstream(request):
            calls.append(request)
            if (
                failure in {"late", "empty"}
                and len(calls) <= 6
                or len(calls) == 1
                or failure == "exhausted"
            ):
                if failure == "timeout":
                    raise httpx.ReadTimeout("cold start", request=request)
                if failure == "empty":
                    return httpx.Response(200, text="")
                response = httpx.Response(
                    404 if failure == "late" else 503,
                    headers={
                        "Content-Type": "application/json" if failure == "json" else "text/html"
                    },
                    stream=ErrorBody(),
                )
                error_responses.append(response)
                return response
            body = gzip.compress(b"#EXTM3U\n#EXTINF:5,\nsegment.ts\n")
            return httpx.Response(
                200,
                headers={
                    "Content-Type": "application/vnd.apple.mpegurl",
                    "Content-Encoding": "gzip",
                    "Content-Length": str(len(body)),
                },
                stream=httpx.ByteStream(body),
            )

        mock_upstream(ERSATZTV, upstream)
        with (
            patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel),
            patch("app.routers.ersatztv.asyncio.sleep", AsyncMock()) as sleep,
        ):
            response = client.get("/api/ersatztv/stream/comedy-classics", headers=auth_header)
        assert all(r.is_closed for r in error_responses)
        if failure == "exhausted":
            assert response.status_code == 503
            assert len(calls) == 8
            assert sleep.await_count == 7
        else:
            assert response.status_code == 200
            assert response.text.startswith("#EXTM3U")
            assert "/api/ersatztv/segments/" in response.text
            if failure in {"late", "empty"}:
                assert len(calls) == 7
                assert sum(call.args[0] for call in sleep.await_args_list) == 15.5
            else:
                assert len(calls) == 2
                sleep.assert_awaited_once_with(0.5)

    def test_startup_wall_timeout_cancels_pending_fetch(
        self, client: TestClient, auth_header: dict[str, str], mock_channel: EPGChannel
    ) -> None:
        import asyncio

        cancelled = []

        async def stalled(*args, **kwargs):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.append(True)

        with (
            patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel),
            patch("app.routers.ersatztv.STREAM_STARTUP_SECONDS", 0.01),
            patch("app.routers.ersatztv.fetch_ersatztv", AsyncMock(side_effect=stalled)) as fetch,
        ):
            response = client.get("/api/ersatztv/stream/comedy-classics", headers=auth_header)
        assert response.status_code == 503
        assert cancelled == [True]
        fetch.assert_awaited_once()

    def test_startup_timeout_log_names_the_step_attempt_and_elapsed_time(
        self, client: TestClient, auth_header: dict[str, str], mock_channel: EPGChannel
    ) -> None:
        """H-08: not a bare 'TimeoutError: ' line."""
        import asyncio

        async def stalled(*args, **kwargs):
            await asyncio.Event().wait()

        output = StringIO()
        sink = logger.add(output, format="{level} | {message}", level="INFO")
        try:
            with (
                patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel),
                patch("app.routers.ersatztv.STREAM_STARTUP_SECONDS", 0.01),
                patch("app.routers.ersatztv.fetch_ersatztv", AsyncMock(side_effect=stalled)),
            ):
                response = client.get("/api/ersatztv/stream/comedy-classics", headers=auth_header)
        finally:
            logger.remove(sink)

        assert response.status_code == 503
        lines = [line for line in output.getvalue().splitlines() if "Stream error" in line]
        assert len(lines) == 1
        assert lines[0].startswith("WARNING | Stream error for channel comedy-classics: ")
        assert "manifest fetch attempt 1/8 failed after 0.0s: TimeoutError: no detail" in lines[0]

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/ersatztv/stream/comedy-classics")
        assert response.status_code == 401

    def test_returns_rewritten_manifest(
        self, client: TestClient, auth_header: dict[str, str], mock_channel: EPGChannel
    ) -> None:
        """Returns rewritten HLS manifest."""
        manifest = "#EXTM3U\nsegment1.ts\nsegment2.ts"
        rewritten = "#EXTM3U\n/api/ersatztv/segments/encoded1\n/api/ersatztv/segments/encoded2"

        with (
            patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel),
            patch("app.routers.ersatztv.ersatztv_client") as client_getter,
            patch("app.routers.ersatztv.rewrite_manifest", return_value=rewritten),
        ):
            mock_response = httpx.Response(
                200,
                text=manifest,
                headers={"content-type": "application/vnd.apple.mpegurl"},
                request=httpx.Request("GET", mock_channel.stream_url),
            )
            mock_client = AsyncMock()
            mock_client.build_request = MagicMock(return_value=MagicMock())
            mock_client.send = AsyncMock(return_value=mock_response)
            client_getter.return_value = mock_client

            response = client.get("/api/ersatztv/stream/comedy-classics", headers=auth_header)

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/vnd.apple.mpegurl"

    def test_rejects_channel_not_found(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 404 when channel not found."""
        with patch("app.routers.ersatztv.get_channel_by_id", return_value=None):
            response = client.get("/api/ersatztv/stream/nonexistent", headers=auth_header)

        assert response.status_code == 404
        assert response.json()["detail"] == "Channel not found"

    def test_rejects_non_ersatztv_url(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 400 when stream URL is not from ErsatzTV."""
        bad_channel = EPGChannel(
            id="bad-channel",
            name="Bad Channel",
            stream_url="http://malicious.com/stream.m3u8",
        )

        with patch("app.routers.ersatztv.get_channel_by_id", return_value=bad_channel):
            response = client.get("/api/ersatztv/stream/bad-channel", headers=auth_header)

        assert response.status_code == 400
        assert response.json()["detail"] == "Invalid stream URL"

    @pytest.mark.parametrize(
        "path",
        [
            "/iptv/xmltv.xml",
            "/iptv/channels.m3u",
            "/api/channels",
            "/",
            "/iptv/session/../../api/channels",
        ],
    )
    def test_rejects_nested_url_outside_streaming_paths(
        self, client: TestClient, auth_header: dict[str, str], path: str
    ) -> None:
        """A nested ?url= must be a session or channel playlist; nothing is fetched."""
        from app.config import settings
        from app.services.ersatztv.hls_rewriter import HLSManifestRewriter

        url = settings.ersatztv_base_url.rstrip("/") + path
        encoded = HLSManifestRewriter()._encode_url(url)
        with _upstream(200, b"#EXTM3U\n", "text/plain") as requests:
            got = client.get(f"/api/ersatztv/stream/8?url={encoded}", headers=auth_header)
            head = client.head(f"/api/ersatztv/stream/8?url={encoded}", headers=auth_header)

        assert got.status_code == 400
        assert got.json()["detail"] == "Invalid stream URL"
        assert head.status_code == 400
        assert requests == []

    def test_nested_session_playlist_served_with_security_headers(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """A session variant playlist is proxied with nosniff and a sandbox CSP."""
        from app.config import settings
        from app.services.ersatztv.hls_rewriter import HLSManifestRewriter

        url = settings.ersatztv_base_url.rstrip("/") + "/iptv/session/8/hls.m3u8"
        encoded = HLSManifestRewriter()._encode_url(url)
        manifest = b"#EXTM3U\n#EXTINF:4,\nlive000010.ts\n"
        with _upstream(200, manifest, "application/vnd.apple.mpegurl") as requests:
            response = client.get(f"/api/ersatztv/stream/8?url={encoded}", headers=auth_header)

        assert response.status_code == 200
        assert len(requests) == 1
        assert "/api/ersatztv/segments/" in response.text
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["content-security-policy"] == "default-src 'none'; sandbox"
        assert response.headers["access-control-allow-origin"] == "*"

    def test_accepts_token_query_param(self, client: TestClient, mock_channel: EPGChannel) -> None:
        """Stream endpoint accepts token via query parameter for HLS playback."""
        token = create_access_token({"sub": "testuser", "role": "viewer"})
        manifest = "#EXTM3U\n#EXT-X-VERSION:3\nsegment.ts"
        rewritten = "#EXTM3U\n#EXT-X-VERSION:3\n/api/ersatztv/segments/encoded"

        with (
            patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel),
            patch("app.routers.ersatztv.ersatztv_client") as client_getter,
            patch("app.routers.ersatztv.rewrite_manifest", return_value=rewritten),
        ):
            mock_response = httpx.Response(
                200,
                text=manifest,
                headers={"content-type": "application/vnd.apple.mpegurl"},
                request=httpx.Request("GET", mock_channel.stream_url),
            )
            mock_client = AsyncMock()
            mock_client.build_request = MagicMock(return_value=MagicMock())
            mock_client.send = AsyncMock(return_value=mock_response)
            client_getter.return_value = mock_client

            # Use token as query param instead of header
            response = client.get(f"/api/ersatztv/stream/comedy-classics?token={token}")

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/vnd.apple.mpegurl"

    def test_passes_token_to_rewriter(
        self, client: TestClient, auth_header: dict[str, str], mock_channel: EPGChannel
    ) -> None:
        """Token is passed to manifest rewriter for inclusion in segment URLs."""
        token = create_access_token({"sub": "testuser", "role": "viewer"})
        manifest = "#EXTM3U\nsegment.ts"

        with (
            patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel),
            patch("app.routers.ersatztv.ersatztv_client") as client_getter,
            patch("app.routers.ersatztv.rewrite_manifest") as mock_rewrite,
        ):
            mock_rewrite.return_value = "#EXTM3U\n/api/ersatztv/segments/encoded"
            mock_response = httpx.Response(
                200,
                text=manifest,
                headers={"content-type": "application/vnd.apple.mpegurl"},
                request=httpx.Request("GET", mock_channel.stream_url),
            )
            mock_client = AsyncMock()
            mock_client.build_request = MagicMock(return_value=MagicMock())
            mock_client.send = AsyncMock(return_value=mock_response)
            client_getter.return_value = mock_client

            client.get(f"/api/ersatztv/stream/comedy-classics?token={token}")

        # Verify token was passed to rewriter
        mock_rewrite.assert_called_once()
        call_kwargs = mock_rewrite.call_args
        assert call_kwargs.kwargs.get("token") == token


class TestHeadSegment:
    """Tests for HEAD /api/ersatztv/segments/{encoded_url} endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated HEAD request returns 401."""
        response = client.head("/api/ersatztv/segments/some-encoded-url")
        assert response.status_code == 401

    def test_returns_200_with_headers_only(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """HEAD request returns 200 with correct headers but no body."""
        encoded_url = "aHR0cDovLzE5Mi4xNjguNTAuMTA4Ojg0MDkvc2VnbWVudC50cw"

        with patch(
            "app.routers.ersatztv.decode_url",
            return_value="http://192.168.50.108:8409/iptv/session/8/live000010.ts",
        ):
            response = client.head(f"/api/ersatztv/segments/{encoded_url}", headers=auth_header)

        assert response.status_code == 200
        assert response.headers["content-type"] == "video/mp2t"
        assert response.content == b""  # No body for HEAD

    def test_rejects_non_ersatztv_url(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """HEAD request returns 400 when segment URL is not from ErsatzTV."""
        with patch(
            "app.routers.ersatztv.decode_url",
            return_value="http://malicious.com/segment.ts",
        ):
            response = client.head("/api/ersatztv/segments/malicious-encoded", headers=auth_header)

        assert response.status_code == 400

    def test_accepts_token_query_param(self, client: TestClient) -> None:
        """HEAD segment endpoint accepts token via query parameter."""
        token = create_access_token({"sub": "testuser", "role": "viewer"})
        encoded_url = "aHR0cDovLzE5Mi4xNjguNTAuMTA4Ojg0MDkvc2VnbWVudC50cw"

        with patch(
            "app.routers.ersatztv.decode_url",
            return_value="http://192.168.50.108:8409/iptv/session/8/live000010.ts",
        ):
            response = client.head(f"/api/ersatztv/segments/{encoded_url}?token={token}")

        assert response.status_code == 200


class TestGetSegment:
    """Tests for GET /api/ersatztv/segments/{encoded_url} endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Unauthenticated request returns 401."""
        response = client.get("/api/ersatztv/segments/some-encoded-url")
        assert response.status_code == 401

    def test_returns_segment_content(self, client: TestClient, auth_header: dict[str, str]) -> None:
        """Returns segment content from ErsatzTV."""
        segment_content = b"segment binary data"
        # Encode: http://192.168.50.108:8409/segment.ts
        encoded_url = "aHR0cDovLzE5Mi4xNjguNTAuMTA4Ojg0MDkvc2VnbWVudC50cw"

        with (
            patch(
                "app.routers.ersatztv.decode_url",
                return_value="http://192.168.50.108:8409/iptv/session/8/live000010.ts",
            ),
            patch("app.routers.ersatztv.ersatztv_client") as client_getter,
        ):
            mock_response = MagicMock()
            mock_response.is_redirect = False
            mock_response.headers = {"content-type": "video/mp2t"}
            mock_response.raise_for_status = MagicMock()

            async def aiter_bytes():
                yield segment_content

            mock_response.aiter_bytes = aiter_bytes
            mock_response.aclose = AsyncMock()
            mock_client = AsyncMock()
            mock_client.build_request = MagicMock(return_value=MagicMock())
            mock_client.send = AsyncMock(return_value=mock_response)
            client_getter.return_value = mock_client

            response = client.get(f"/api/ersatztv/segments/{encoded_url}", headers=auth_header)

        assert response.status_code == 200
        assert response.content == segment_content

    def test_rejects_non_ersatztv_url(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Returns 400 when segment URL is not from ErsatzTV."""
        with patch(
            "app.routers.ersatztv.decode_url",
            return_value="http://malicious.com/segment.ts",
        ):
            response = client.get("/api/ersatztv/segments/malicious-encoded", headers=auth_header)

        assert response.status_code == 400
        assert response.json()["detail"] == "Invalid segment URL"

    def test_rejects_same_host_other_port_without_upstream_request(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """Another service on the ErsatzTV machine is never contacted."""
        from urllib.parse import urlsplit

        from app.config import settings
        from app.services.ersatztv.hls_rewriter import HLSManifestRewriter

        base = urlsplit(settings.ersatztv_base_url)
        port = (base.port or {"http": 80, "https": 443}[base.scheme]) + 1
        url = f"{base.scheme}://{base.hostname}:{port}/iptv/session/8/live000010.ts"
        requests: list[httpx.Request] = []

        def upstream(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, content=b"secret", headers={"content-type": "text/html"})

        mock_upstream(ERSATZTV, upstream)
        response = client.get(
            f"/api/ersatztv/segments/{HLSManifestRewriter()._encode_url(url)}",
            headers=auth_header,
        )

        assert response.status_code == 400
        assert requests == []

    @pytest.mark.parametrize(
        "path",
        [
            "/api/channels",
            "/",
            "/iptv/xmltv.xml",
            "/iptv/channels.m3u",
            "/iptv/logos/abc123.jpg",
            "/iptv/channel/8.m3u8",
            "/iptv/session/../../api/channels",
            "/iptv/session/%2e%2e/%2e%2e/api/channels",
        ],
    )
    def test_rejects_non_streaming_path_without_upstream_request(
        self, client: TestClient, auth_header: dict[str, str], path: str
    ) -> None:
        """Only session segments are proxied; the rest of the host is never contacted."""
        from app.config import settings
        from app.services.ersatztv.hls_rewriter import HLSManifestRewriter

        url = settings.ersatztv_base_url.rstrip("/") + path
        with _upstream(200, b"<html>admin</html>", "text/html") as requests:
            response = client.get(
                f"/api/ersatztv/segments/{HLSManifestRewriter()._encode_url(url)}",
                headers=auth_header,
            )

        assert response.status_code == 400
        assert requests == []

    @pytest.mark.parametrize(
        ("upstream_type", "served_type"),
        [
            ("text/html; charset=utf-8", "video/mp2t"),
            ("application/json", "video/mp2t"),
            ("video/mp4", "video/mp4"),
            ("application/octet-stream", "application/octet-stream"),
        ],
    )
    def test_serves_only_media_types_with_security_headers(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        upstream_type: str,
        served_type: str,
    ) -> None:
        """A non-media upstream type is served as video/mp2t, never as a document."""
        from app.config import settings
        from app.services.ersatztv.hls_rewriter import HLSManifestRewriter

        url = settings.ersatztv_base_url.rstrip("/") + "/iptv/session/8/live000010.ts"
        with _upstream(200, b"segment", upstream_type) as requests:
            response = client.get(
                f"/api/ersatztv/segments/{HLSManifestRewriter()._encode_url(url)}",
                headers=auth_header,
            )

        assert response.status_code == 200
        assert len(requests) == 1
        assert response.headers["content-type"].split(";")[0] == served_type
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["content-security-policy"] == "default-src 'none'; sandbox"
        assert response.headers["access-control-allow-origin"] == "*"

    def test_accepts_token_query_param(self, client: TestClient) -> None:
        """Segment endpoint accepts token via query parameter for HLS playback."""
        token = create_access_token({"sub": "testuser", "role": "viewer"})
        segment_content = b"segment binary data"
        encoded_url = "aHR0cDovLzE5Mi4xNjguNTAuMTA4Ojg0MDkvc2VnbWVudC50cw"

        with (
            patch(
                "app.routers.ersatztv.decode_url",
                return_value="http://192.168.50.108:8409/iptv/session/8/live000010.ts",
            ),
            patch("app.routers.ersatztv.ersatztv_client") as client_getter,
        ):
            mock_response = MagicMock()
            mock_response.is_redirect = False
            mock_response.headers = {"content-type": "video/mp2t"}
            mock_response.raise_for_status = MagicMock()

            async def aiter_bytes():
                yield segment_content

            mock_response.aiter_bytes = aiter_bytes
            mock_response.aclose = AsyncMock()
            mock_client = AsyncMock()
            mock_client.build_request = MagicMock(return_value=MagicMock())
            mock_client.send = AsyncMock(return_value=mock_response)
            client_getter.return_value = mock_client

            # Use token as query param instead of header
            response = client.get(f"/api/ersatztv/segments/{encoded_url}?token={token}")

        assert response.status_code == 200
        assert response.content == segment_content

    def test_rejects_off_host_redirect(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """An off-host redirect hop is never fetched and the request fails."""
        # Encodes http://192.168.50.108:8409/iptv/session/8/live000010.ts
        encoded_url = "aHR0cDovLzE5Mi4xNjguNTAuMTA4Ojg0MDkvc2VnbWVudC50cw"

        with (
            patch(
                "app.routers.ersatztv.decode_url",
                return_value="http://192.168.50.108:8409/iptv/session/8/live000010.ts",
            ),
            patch("app.routers.ersatztv.ersatztv_client") as client_getter,
        ):
            # Upstream tries to bounce us to the cloud metadata endpoint.
            redirect_response = MagicMock()
            redirect_response.is_redirect = True
            redirect_response.headers = {"location": "http://169.254.169.254/latest/meta-data/"}
            redirect_response.url = httpx.URL(
                "http://192.168.50.108:8409/iptv/session/8/live000010.ts"
            )
            redirect_response.aclose = AsyncMock()

            requested_urls: list[str] = []

            def build_request(method: str, url: str, **kwargs: object) -> MagicMock:
                request = MagicMock()
                request.url = url
                return request

            async def send(request: MagicMock, stream: bool = False) -> MagicMock:
                requested_urls.append(str(request.url))
                return redirect_response

            mock_client = AsyncMock()
            mock_client.build_request = MagicMock(side_effect=build_request)
            mock_client.send = AsyncMock(side_effect=send)
            client_getter.return_value = mock_client

            response = client.get(f"/api/ersatztv/segments/{encoded_url}", headers=auth_header)

        assert response.status_code == 502
        # The metadata host must never have been contacted.
        assert all("169.254.169.254" not in url for url in requested_urls)

    def test_rejects_oversized_content_length(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        """A Content-Length above the cap fails with 502 before streaming starts."""
        # Encodes http://192.168.50.108:8409/iptv/session/8/live000010.ts
        encoded_url = "aHR0cDovLzE5Mi4xNjguNTAuMTA4Ojg0MDkvc2VnbWVudC50cw"

        with (
            patch(
                "app.routers.ersatztv.decode_url",
                return_value="http://192.168.50.108:8409/iptv/session/8/live000010.ts",
            ),
            patch("app.routers.ersatztv.ersatztv_client") as client_getter,
        ):
            mock_response = MagicMock()
            mock_response.is_redirect = False
            mock_response.headers = {
                "content-type": "video/mp2t",
                "content-length": str(64 * 1024 * 1024 + 1),
            }
            mock_response.raise_for_status = MagicMock()
            mock_response.aclose = AsyncMock()
            mock_client = AsyncMock()
            mock_client.build_request = MagicMock(return_value=MagicMock())
            mock_client.send = AsyncMock(return_value=mock_response)
            client_getter.return_value = mock_client

            response = client.get(f"/api/ersatztv/segments/{encoded_url}", headers=auth_header)

        assert response.status_code == 502
        assert response.json()["detail"] == "Segment too large"


class TestGetLogo:
    """Tests for GET /api/ersatztv/logos/{channel_id} endpoint."""

    def test_no_authentication_required(self, client: TestClient, mock_channel: EPGChannel) -> None:
        """Logo endpoint does not require authentication (browser img tags can't send headers)."""
        assert mock_channel.original_logo_url is not None
        logo_content = b"\x89PNG\r\n\x1a\nsynthetic-image-data"

        with (
            patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel),
            patch("app.routers.ersatztv.ersatztv_client") as client_getter,
        ):
            mock_response = httpx.Response(
                200,
                content=logo_content,
                headers={"content-type": "image/png"},
                request=httpx.Request("GET", mock_channel.original_logo_url),
            )
            mock_client = AsyncMock()
            mock_client.build_request = MagicMock(
                return_value=httpx.Request("GET", mock_channel.original_logo_url)
            )
            mock_client.send.return_value = mock_response
            client_getter.return_value = mock_client

            # No auth header - should still work
            response = client.get("/api/ersatztv/logos/comedy-classics")

        assert response.status_code == 200

    def test_returns_logo_image(self, client: TestClient, mock_channel: EPGChannel) -> None:
        """Returns logo image from ErsatzTV."""
        assert mock_channel.original_logo_url is not None
        logo_content = b"\x89PNG\r\n\x1a\nsynthetic-image-data"

        with (
            patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel),
            patch("app.routers.ersatztv.ersatztv_client") as client_getter,
        ):
            mock_response = httpx.Response(
                200,
                content=logo_content,
                headers={"content-type": "image/png"},
                request=httpx.Request("GET", mock_channel.original_logo_url),
            )
            mock_client = AsyncMock()
            mock_client.build_request = MagicMock(
                return_value=httpx.Request("GET", mock_channel.original_logo_url)
            )
            mock_client.send.return_value = mock_response
            client_getter.return_value = mock_client

            response = client.get("/api/ersatztv/logos/comedy-classics")

        assert response.status_code == 200
        assert response.content == logo_content
        assert response.headers["content-type"] == "image/png"

    def test_returns_404_when_channel_not_found(self, client: TestClient) -> None:
        """Returns 404 when channel not found."""
        with patch("app.routers.ersatztv.get_channel_by_id", return_value=None):
            response = client.get("/api/ersatztv/logos/nonexistent")

        assert response.status_code == 404
        assert response.json()["detail"] == "Channel not found"

    def test_returns_404_when_no_logo(self, client: TestClient) -> None:
        """Returns 404 when channel has no logo."""
        channel_no_logo = EPGChannel(
            id="no-logo",
            name="No Logo Channel",
            stream_url="http://192.168.50.108:8409/stream.m3u8",
            logo_url=None,
            original_logo_url=None,
        )

        with patch("app.routers.ersatztv.get_channel_by_id", return_value=channel_no_logo):
            response = client.get("/api/ersatztv/logos/no-logo")

        assert response.status_code == 404
        assert response.json()["detail"] == "No logo available"

    def test_repeat_requests_are_served_from_the_cache(
        self, client: TestClient, mock_channel: EPGChannel
    ) -> None:
        """C-06: one upstream fetch per logo, and browsers may keep it."""
        png = b"\x89PNG\r\n\x1a\nsynthetic-image-data"
        with (
            patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel),
            _upstream(200, png, "image/png") as requests,
        ):
            responses = [client.get("/api/ersatztv/logos/comedy-classics") for _ in range(5)]

        assert [r.status_code for r in responses] == [200] * 5
        assert all(r.content == png for r in responses)
        assert all(r.headers["cache-control"] == "public, max-age=3600" for r in responses)
        assert len(requests) == 1

    def test_a_changed_logo_url_is_fetched_again(
        self, client: TestClient, mock_channel: EPGChannel
    ) -> None:
        png = b"\x89PNG\r\n\x1a\nsynthetic-image-data"
        moved = mock_channel.model_copy(
            update={"original_logo_url": "http://192.168.50.108:8409/logos/comedy-2.png"}
        )
        with _upstream(200, png, "image/png") as requests:
            for channel in (mock_channel, moved):
                with patch("app.routers.ersatztv.get_channel_by_id", return_value=channel):
                    assert client.get("/api/ersatztv/logos/comedy-classics").status_code == 200

        assert [r.url.path for r in requests] == ["/logos/comedy.png", "/logos/comedy-2.png"]

    def test_upstream_404_is_a_remembered_404_with_cache_control(
        self, client: TestClient, mock_channel: EPGChannel
    ) -> None:
        with (
            patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel),
            _upstream(404, b"", "text/plain") as requests,
        ):
            responses = [client.get("/api/ersatztv/logos/comedy-classics") for _ in range(2)]

        assert [r.status_code for r in responses] == [404, 404]
        assert all("max-age=" in r.headers["cache-control"] for r in responses)
        assert len(requests) == 1

    def test_unreachable_ersatztv_logs_one_line_per_logo(
        self, client: TestClient, mock_channel: EPGChannel
    ) -> None:
        """H-07: an ErsatzTV restart is not one ERROR per logo request."""

        def refused(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("All connection attempts failed", request=request)

        mock_upstream(ERSATZTV, refused)
        output = StringIO()
        sink = logger.add(output, format="{level} | {message}", level="DEBUG")
        try:
            with patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel):
                responses = [client.get("/api/ersatztv/logos/comedy-classics") for _ in range(3)]
        finally:
            logger.remove(sink)

        assert [r.status_code for r in responses] == [503] * 3
        lines = [line for line in output.getvalue().splitlines() if "Logo " in line]
        assert lines == [
            "WARNING | Logo ersatztv:comedy-classics:http://192.168.50.108:8409/logos/comedy.png"
            " unavailable: All connection attempts failed"
        ]


class TestErsatzTVLogging:
    """Tests for ErsatzTV router logging."""

    def test_channels_logs_debug(
        self, client: TestClient, auth_header: dict[str, str], mock_channel: EPGChannel
    ) -> None:
        """GET /channels logs DEBUG level."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="DEBUG")

        try:
            with patch("app.routers.ersatztv.get_channels", return_value=[mock_channel]):
                client.get("/api/ersatztv/channels", headers=auth_header)

            log_output = output.getvalue()
            assert "DEBUG" in log_output
            assert "channel" in log_output.lower()
        finally:
            logger.remove(handler_id)

    def test_programmes_logs_debug_with_channel_id(
        self, client: TestClient, auth_header: dict[str, str], mock_programme: Programme
    ) -> None:
        """GET /programmes/{channel_id} logs DEBUG with channel_id."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="DEBUG")

        try:
            with patch(
                "app.routers.ersatztv.get_programmes_by_channel",
                return_value=[mock_programme],
            ):
                client.get("/api/ersatztv/programmes/comedy-classics", headers=auth_header)

            log_output = output.getvalue()
            assert "DEBUG" in log_output
            assert "comedy-classics" in log_output
        finally:
            logger.remove(handler_id)

    def test_stream_logs_debug(
        self, client: TestClient, auth_header: dict[str, str], mock_channel: EPGChannel
    ) -> None:
        """GET /stream/{channel_id} logs DEBUG level."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="DEBUG")

        try:
            with (
                patch("app.routers.ersatztv.get_channel_by_id", return_value=mock_channel),
                patch("app.routers.ersatztv.ersatztv_client") as client_getter,
                patch("app.routers.ersatztv.rewrite_manifest", return_value="#EXTM3U"),
            ):
                mock_response = MagicMock()
                mock_response.text = "#EXTM3U"
                mock_response.is_redirect = False
                mock_response.raise_for_status = MagicMock()
                mock_client = AsyncMock()
                mock_client.build_request = MagicMock(return_value=MagicMock())
                mock_client.send = AsyncMock(return_value=mock_response)
                client_getter.return_value = mock_client

                client.get("/api/ersatztv/stream/comedy-classics", headers=auth_header)

            log_output = output.getvalue()
            assert "DEBUG" in log_output
            assert "stream" in log_output.lower()
        finally:
            logger.remove(handler_id)

    def test_ersatztv_logging_uses_router_context(
        self, client: TestClient, auth_header: dict[str, str], mock_channel: EPGChannel
    ) -> None:
        """ErsatzTV logging uses logger.bind(router='ersatztv') context."""
        output = StringIO()
        handler_id = logger.add(output, format="{extra} | {message}", level="DEBUG")

        try:
            with patch("app.routers.ersatztv.get_channels", return_value=[mock_channel]):
                client.get("/api/ersatztv/channels", headers=auth_header)

            log_output = output.getvalue()
            assert "router" in log_output
            assert "ersatztv" in log_output
        finally:
            logger.remove(handler_id)


class TestErrorMapping:
    """Client errors are 400, non-HLS replies 502, outages 503 and bugs 500 (M-02)."""

    @pytest.mark.parametrize("encoded", ["A", "_w"])  # bad base64; not UTF-8
    def test_malformed_encoded_url_is_a_client_error(
        self, client: TestClient, auth_header: dict[str, str], encoded: str
    ) -> None:
        output = StringIO()
        sink = logger.add(output, format="{level} | {message}", level="INFO")
        try:
            with _upstream(200, b"", "video/mp2t") as requests:
                responses = [
                    client.get(f"/api/ersatztv/stream/8?url={encoded}", headers=auth_header),
                    client.head(f"/api/ersatztv/stream/8?url={encoded}", headers=auth_header),
                    client.get(f"/api/ersatztv/segments/{encoded}", headers=auth_header),
                    client.head(f"/api/ersatztv/segments/{encoded}", headers=auth_header),
                ]
        finally:
            logger.remove(sink)

        assert [r.status_code for r in responses] == [400] * 4
        assert responses[0].json()["detail"] == "Invalid stream URL"
        assert responses[2].json()["detail"] == "Invalid segment URL"
        assert requests == []
        assert "ERROR" not in output.getvalue()

    @pytest.mark.parametrize(
        "body,content_type,detail",
        [
            (b"<html>error</html>", "text/html", "Upstream is not an HLS manifest"),
            (b"not a manifest\n", "application/vnd.apple.mpegurl", "Invalid HLS manifest header"),
        ],
    )
    def test_non_hls_upstream_reply_is_a_bad_gateway(
        self,
        client: TestClient,
        auth_header: dict[str, str],
        body: bytes,
        content_type: str,
        detail: str,
    ) -> None:
        from app.config import settings
        from app.services.ersatztv.hls_rewriter import HLSManifestRewriter

        url = settings.ersatztv_base_url.rstrip("/") + "/iptv/session/8/hls.m3u8"
        encoded = HLSManifestRewriter()._encode_url(url)
        with _upstream(200, body, content_type) as requests:
            response = client.get(f"/api/ersatztv/stream/8?url={encoded}", headers=auth_header)

        assert response.status_code == 502
        assert response.json()["detail"] == detail
        assert len(requests) == 1  # not retried

    def test_oversized_manifest_is_a_bad_gateway(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        from app.config import settings
        from app.services.ersatztv.hls_rewriter import HLSManifestRewriter

        url = settings.ersatztv_base_url.rstrip("/") + "/iptv/session/8/hls.m3u8"
        encoded = HLSManifestRewriter()._encode_url(url)
        with (
            patch("app.services.ersatztv.hls_rewriter.MANIFEST_BYTES", 8),
            _upstream(200, b"#EXTM3U\n#EXTINF:4,\n", "application/vnd.apple.mpegurl"),
        ):
            response = client.get(f"/api/ersatztv/stream/8?url={encoded}", headers=auth_header)

        assert response.status_code == 502
        assert response.json()["detail"] == "Upstream body exceeds byte budget"

    def test_programming_error_is_a_500_with_a_traceback(
        self, client: TestClient, auth_header: dict[str, str]
    ) -> None:
        output = StringIO()
        sink = logger.add(output, format="{level} | {message}\n{exception}", level="INFO")
        try:
            with patch(
                "app.routers.ersatztv.get_programmes_by_channel", side_effect=KeyError("start")
            ):
                response = client.get("/api/ersatztv/programmes/ch1", headers=auth_header)
        finally:
            logger.remove(sink)

        assert response.status_code == 500
        logged = output.getvalue()
        assert "ERROR | Failed to get programmes for channel ch1" in logged
        assert "Traceback" in logged and "KeyError('start')" in logged
