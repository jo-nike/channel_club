"""Tests for HLS manifest rewriter.

Story: 7.5 - HLS Proxy Service
"""

from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import urlsplit

import httpx
import pytest

from app.config import settings
from app.services.ersatztv.hls_rewriter import (
    HLSManifestRewriter,
    UpstreamProtocolError,
    decode_url,
    fetch_ersatztv,
    get_segment,
    get_stream_manifest,
    is_ersatztv_media_url,
    is_ersatztv_url,
    rewrite_manifest,
    segment_media_type,
)

# Sample HLS content for testing
SAMPLE_MANIFEST = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:6.000,
segment-001.ts
#EXTINF:6.000,
segment-002.ts
"""

SAMPLE_MASTER = """#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000
video/1080p.m3u8
"""

SAMPLE_MASTER_MULTIPLE_VARIANTS = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
video/1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
video/720p.m3u8
"""


class TestHLSManifestRewriter:
    """Tests for HLSManifestRewriter class."""

    def test_rewriter_creation(self):
        """HLSManifestRewriter can be instantiated."""
        rewriter = HLSManifestRewriter()
        assert rewriter.proxy_base_url == "/api/ersatztv/segments"
        assert rewriter.stream_proxy_url == "/api/ersatztv/stream"

    def test_rewriter_custom_proxy_url(self):
        """HLSManifestRewriter accepts custom proxy base URL."""
        rewriter = HLSManifestRewriter(proxy_base_url="/custom/segments")
        assert rewriter.proxy_base_url == "/custom/segments"


class TestRewriteManifest:
    """Tests for manifest rewriting functionality."""

    def test_rewrite_manifest_preserves_tags(self):
        """Rewriter preserves HLS tags."""
        result = rewrite_manifest(SAMPLE_MANIFEST, "http://example.com/")
        assert "#EXTM3U" in result
        assert "#EXT-X-VERSION:3" in result
        assert "#EXT-X-TARGETDURATION:6" in result
        assert "#EXTINF:6.000," in result

    def test_rewrite_manifest_proxies_segments(self):
        """Rewriter proxies segment URLs."""
        result = rewrite_manifest(SAMPLE_MANIFEST, "http://example.com/")
        assert "/api/ersatztv/segments/" in result
        # Original segment names should NOT appear in output
        assert "segment-001.ts\n" not in result
        assert "segment-002.ts\n" not in result

    def test_rewrite_manifest_handles_nested_m3u8(self):
        """Rewriter proxies nested variant playlists."""
        result = rewrite_manifest(SAMPLE_MASTER, "http://example.com/")
        # Without channel_id, uses _nested placeholder
        assert "/api/ersatztv/stream/_nested?url=" in result
        # Original m3u8 reference should NOT appear in output
        assert "video/1080p.m3u8\n" not in result

    def test_rewrite_manifest_handles_nested_m3u8_with_channel_id(self):
        """Rewriter includes channel_id in nested playlist URLs when provided."""
        result = rewrite_manifest(SAMPLE_MASTER, "http://example.com/", channel_id="test-channel")
        assert "/api/ersatztv/stream/test-channel?url=" in result

    def test_rewrite_manifest_handles_multiple_variants(self):
        """Rewriter handles multiple variant playlists."""
        result = rewrite_manifest(SAMPLE_MASTER_MULTIPLE_VARIANTS, "http://example.com/")
        lines = result.strip().split("\n")
        stream_urls = [line for line in lines if "/api/ersatztv/stream/_nested?url=" in line]
        assert len(stream_urls) == 2

    def test_rewrite_manifest_resolves_relative_urls(self):
        """Rewriter resolves relative URLs to absolute before encoding."""
        result = rewrite_manifest(SAMPLE_MANIFEST, "http://example.com/channel/")
        # The encoded URLs should contain the full absolute path
        for line in result.split("\n"):
            if line.startswith("/api/ersatztv/segments/"):
                encoded = line.replace("/api/ersatztv/segments/", "")
                decoded = decode_url(encoded)
                assert decoded.startswith("http://example.com/channel/")

    def test_rewrite_manifest_handles_absolute_urls(self):
        """Rewriter handles already-absolute URLs in manifest."""
        manifest = """#EXTM3U
#EXT-X-VERSION:3
#EXTINF:6.000,
http://cdn.example.com/segment-001.ts
"""
        result = rewrite_manifest(manifest, "http://example.com/")
        assert "/api/ersatztv/segments/" in result
        # Verify the encoded URL decodes to the absolute URL
        for line in result.split("\n"):
            if line.startswith("/api/ersatztv/segments/"):
                encoded = line.replace("/api/ersatztv/segments/", "")
                decoded = decode_url(encoded)
                assert decoded == "http://cdn.example.com/segment-001.ts"

    def test_rewrite_manifest_preserves_empty_lines(self):
        """Rewriter preserves empty lines in manifest."""
        manifest = """#EXTM3U

#EXT-X-VERSION:3

#EXTINF:6.000,
segment-001.ts
"""
        result = rewrite_manifest(manifest, "http://example.com/")
        assert "\n\n" in result

    def test_rewrite_manifest_includes_token_in_segment_urls(self):
        """Rewriter includes token in segment URLs when provided."""
        result = rewrite_manifest(SAMPLE_MANIFEST, "http://example.com/", token="my-jwt-token")
        # Check that segment URLs include the token as query param
        for line in result.split("\n"):
            if line.startswith("/api/ersatztv/segments/"):
                assert "?token=my-jwt-token" in line

    def test_rewrite_manifest_includes_token_in_nested_m3u8_urls(self):
        """Rewriter includes token in nested m3u8 URLs when provided."""
        result = rewrite_manifest(SAMPLE_MASTER, "http://example.com/", token="my-jwt-token")
        # Check that nested m3u8 URLs include the token
        for line in result.split("\n"):
            if "/api/ersatztv/stream?url=" in line:
                assert "&token=my-jwt-token" in line

    def test_rewrite_manifest_no_token_when_not_provided(self):
        """Rewriter does not add token query params when token is None."""
        result = rewrite_manifest(SAMPLE_MANIFEST, "http://example.com/")
        # Check that no token query params are present
        assert "?token=" not in result
        assert "&token=" not in result


class TestUrlEncodingDecoding:
    """Tests for URL encoding and decoding."""

    def test_url_encoding_roundtrip(self):
        """URL encoding/decoding preserves URL."""
        original = "http://192.168.50.108:8409/iptv/segment-12345.ts?token=abc"
        rewriter = HLSManifestRewriter()
        encoded = rewriter._encode_url(original)
        decoded = HLSManifestRewriter.decode_url(encoded)
        assert decoded == original

    def test_decode_url_handles_special_chars(self):
        """Decoding handles special characters in URLs."""
        url = "http://example.com/path?param=value&other=123"
        rewriter = HLSManifestRewriter()
        encoded = rewriter._encode_url(url)
        decoded = HLSManifestRewriter.decode_url(encoded)
        assert decoded == url

    def test_decode_url_handles_unicode(self):
        """Decoding handles unicode characters in URLs."""
        url = "http://example.com/path/日本語.ts"
        rewriter = HLSManifestRewriter()
        encoded = rewriter._encode_url(url)
        decoded = HLSManifestRewriter.decode_url(encoded)
        assert decoded == url

    def test_decode_url_convenience_function(self):
        """Convenience function decode_url works correctly."""
        original = "http://example.com/segment.ts"
        rewriter = HLSManifestRewriter()
        encoded = rewriter._encode_url(original)
        decoded = decode_url(encoded)
        assert decoded == original

    def test_decode_url_invalid_encoding_raises_error(self):
        """Decoding invalid base64 raises ValueError."""
        with pytest.raises(ValueError):
            decode_url("not-valid-base64!!!")

    def test_encode_url_removes_padding(self):
        """Encoded URLs have padding removed for cleaner URLs."""
        rewriter = HLSManifestRewriter()
        # Test a URL that would normally have padding
        encoded = rewriter._encode_url("http://a.com/x")
        assert "=" not in encoded

    def test_decode_url_restores_padding(self):
        """Decode handles URLs with missing padding."""
        rewriter = HLSManifestRewriter()
        # Encode and strip any padding manually
        original = "http://a.com/x"
        encoded = rewriter._encode_url(original)
        # Should work even without explicit padding
        decoded = decode_url(encoded)
        assert decoded == original


class TestNestedPlaylistHandling:
    """Tests for nested playlist handling (AC: #3)."""

    def test_m3u8_urls_use_stream_proxy(self):
        """M3U8 URLs are rewritten to use stream proxy endpoint."""
        result = rewrite_manifest(SAMPLE_MASTER, "http://example.com/")
        for line in result.split("\n"):
            if "m3u8" in line.lower() or ".m3u8" in line:
                # This should NOT be a raw m3u8 reference
                assert line.startswith("/api/ersatztv/stream/_nested?url=")

    def test_ts_segments_use_segment_proxy(self):
        """TS segment URLs are rewritten to use segment proxy endpoint."""
        result = rewrite_manifest(SAMPLE_MANIFEST, "http://example.com/")
        for line in result.split("\n"):
            if line.startswith("/api/ersatztv/"):
                # Segments should use segments endpoint, not stream
                assert line.startswith("/api/ersatztv/segments/")
                assert "stream" not in line

    def test_complex_nested_structure(self):
        """Handles complex nested HLS structure."""
        complex_manifest = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
streams/1080p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000
streams/720p/playlist.m3u8
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000
iframes/iframe.m3u8
"""
        result = rewrite_manifest(complex_manifest, "http://example.com/")
        # All m3u8 references should use stream proxy (with _nested placeholder)
        stream_proxy_count = result.count("/api/ersatztv/stream/_nested?url=")
        assert stream_proxy_count == 3


class TestGetStreamManifest:
    """Tests for get_stream_manifest helper function."""

    @pytest.mark.asyncio
    async def test_get_stream_manifest_fetches_and_rewrites(self):
        """get_stream_manifest fetches manifest and rewrites it."""
        mock_channel = MagicMock()
        mock_channel.stream_url = "http://192.168.50.108:8409/iptv/channel/1.m3u8"

        mock_response = httpx.Response(
            200, text=SAMPLE_MANIFEST, request=httpx.Request("GET", mock_channel.stream_url)
        )

        with (
            patch(
                "app.services.ersatztv.hls_rewriter.get_channel_by_id",
                return_value=mock_channel,
            ),
            patch("app.services.ersatztv.hls_rewriter.settings") as mock_settings,
            patch("app.services.ersatztv.hls_rewriter.httpx.AsyncClient") as mock_client_class,
        ):
            mock_settings.ersatztv_base_url = "http://192.168.50.108:8409"
            mock_client = AsyncMock()
            mock_client.build_request = MagicMock(return_value=mock_response.request)
            mock_client.send = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client_class.return_value = mock_client

            result = await get_stream_manifest("channel1")

            assert "#EXTM3U" in result
            assert "/api/ersatztv/segments/" in result

    @pytest.mark.asyncio
    async def test_get_stream_manifest_channel_not_found(self):
        """get_stream_manifest raises error if channel not found."""
        with (
            patch(
                "app.services.ersatztv.hls_rewriter.get_channel_by_id",
                return_value=None,
            ),
            pytest.raises(ValueError, match="Channel not found"),
        ):
            await get_stream_manifest("nonexistent")

    @pytest.mark.asyncio
    async def test_get_stream_manifest_validates_url(self):
        """get_stream_manifest validates URL is from ErsatzTV."""
        mock_channel = MagicMock()
        mock_channel.stream_url = "http://malicious.com/stream.m3u8"

        with (
            patch(
                "app.services.ersatztv.hls_rewriter.get_channel_by_id",
                return_value=mock_channel,
            ),
            patch("app.services.ersatztv.hls_rewriter.settings") as mock_settings,
        ):
            mock_settings.ersatztv_base_url = "http://192.168.50.108:8409"
            with pytest.raises(ValueError, match="not from ErsatzTV"):
                await get_stream_manifest("channel1")


class TestGetSegment:
    """Tests for get_segment helper function."""

    @pytest.mark.asyncio
    async def test_get_segment_fetches_content(self):
        """get_segment decodes URL and fetches segment."""
        rewriter = HLSManifestRewriter()
        original_url = "http://192.168.50.108:8409/iptv/session/1/segment-001.ts"
        encoded = rewriter._encode_url(original_url)

        mock_response = httpx.Response(
            200,
            content=b"fake-segment-data",
            headers={"content-type": "video/mp2t"},
            request=httpx.Request("GET", original_url),
        )

        with (
            patch("app.services.ersatztv.hls_rewriter.settings") as mock_settings,
            patch("app.services.ersatztv.hls_rewriter.httpx.AsyncClient") as mock_client_class,
        ):
            mock_settings.ersatztv_base_url = "http://192.168.50.108:8409"
            mock_client = AsyncMock()
            mock_client.build_request = MagicMock(return_value=mock_response.request)
            mock_client.send = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client_class.return_value = mock_client

            content, content_type = await get_segment(encoded)

            assert content == b"fake-segment-data"
            assert content_type == "video/mp2t"

    @pytest.mark.asyncio
    async def test_get_segment_validates_url(self):
        """get_segment rejects URLs not from ErsatzTV."""
        rewriter = HLSManifestRewriter()
        malicious_url = "http://evil.com/segment.ts"
        encoded = rewriter._encode_url(malicious_url)

        with patch("app.services.ersatztv.hls_rewriter.settings") as mock_settings:
            mock_settings.ersatztv_base_url = "http://192.168.50.108:8409"

            with pytest.raises(ValueError, match="not from ErsatzTV"):
                await get_segment(encoded)

    @pytest.mark.asyncio
    async def test_get_segment_invalid_encoding(self):
        """get_segment raises error for invalid base64."""
        with pytest.raises(ValueError):
            await get_segment("not-valid-base64!!!")


def _allowlist_cases() -> list[tuple[str, bool]]:
    """URLs around the configured ErsatzTV origin, built from settings."""
    base = urlsplit(settings.ersatztv_base_url)
    assert base.hostname
    default_port = {"http": 80, "https": 443}[base.scheme]
    port = base.port or default_port
    host = base.hostname
    other_scheme = "https" if base.scheme == "http" else "http"
    path = "/iptv/session/8/live000010.ts"
    return [
        (f"{base.scheme}://{host}:{port}{path}", True),
        (f"{base.scheme}://{host}:{port + 1}{path}", False),
        # Implicit port: accepted only when the configured port is the default
        (f"{base.scheme}://{host}{path}", port == default_port),
        (f"{other_scheme}://{host}:{port}{path}", False),
        (f"ftp://{host}:{port}{path}", False),
        (f"{base.scheme}://user@{host}:{port}{path}", False),
        (f"{base.scheme}://user:pass@{host}:{port}{path}", False),
        (f"{base.scheme}://{host}:{port}@evil.example.com{path}", False),
    ]


class TestIsErsatztvUrl:
    """The allowlist compares exact scheme, host and port, and rejects userinfo."""

    @pytest.mark.parametrize(("url", "allowed"), _allowlist_cases())
    def test_allowlist(self, url: str, allowed: bool) -> None:
        assert is_ersatztv_url(url) is allowed


def _media_path_cases() -> list[tuple[str, bool, bool]]:
    """(path, allowed as segment, allowed as playlist) on the configured origin."""
    return [
        ("/iptv/session/8/live000010.ts", True, True),
        ("/iptv/session/8/hls.m3u8", True, True),
        ("/iptv/channel/8.m3u8?mode=segmenter", False, True),
        ("/iptv/xmltv.xml", False, False),
        ("/iptv/channels.m3u", False, False),
        ("/iptv/logos/abc123.jpg", False, False),
        ("/iptv/session/", False, False),
        ("/iptv/session", False, False),
        ("/api/channels", False, False),
        ("/", False, False),
        ("", False, False),
        ("/iptv/session/../../api/x", False, False),
        ("/iptv/session/8/../../../api/x", False, False),
        ("/iptv/session/%2e%2e/%2e%2e/api/x", False, False),
        ("/iptv/session/..%2f..%2fapi/x", False, False),
        ("/iptv/session/%252e%252e/api/x", False, False),
        ("/iptv/session/8/..\\..\\api", False, False),
        ("/iptv/session//8/live000010.ts", False, False),
        ("//iptv/session/8/live000010.ts", False, False),
        ("/iptv/session/./8/live000010.ts", False, False),
        ("/IPTV/session/8/live000010.ts", False, False),
    ]


class TestIsErsatztvMediaUrl:
    """Only ErsatzTV's streaming session and channel playlist paths pass."""

    @pytest.mark.parametrize(("path", "segment", "playlist"), _media_path_cases())
    def test_paths(self, path: str, segment: bool, playlist: bool) -> None:
        url = settings.ersatztv_base_url.rstrip("/") + path
        assert is_ersatztv_media_url(url) is segment
        assert is_ersatztv_media_url(url, playlist=True) is playlist

    def test_other_host_rejected_even_on_session_path(self) -> None:
        assert not is_ersatztv_media_url("http://evil.example.com/iptv/session/8/live000010.ts")


class TestSegmentMediaType:
    """Segments are served only as media types; anything else becomes video/mp2t."""

    @pytest.mark.parametrize(
        ("upstream", "served"),
        [
            ("video/mp2t", "video/mp2t"),
            ("video/MP4; charset=binary", "video/mp4"),
            ("video/iso.segment", "video/iso.segment"),
            ("audio/aac", "audio/aac"),
            ("audio/mp4", "audio/mp4"),
            ("application/octet-stream", "application/octet-stream"),
            ("text/html; charset=utf-8", "video/mp2t"),
            ("application/json", "video/mp2t"),
            ("image/svg+xml", "video/mp2t"),
            (None, "video/mp2t"),
            ("", "video/mp2t"),
        ],
    )
    def test_media_type(self, upstream: str | None, served: str) -> None:
        assert segment_media_type(upstream) == served


class TestFetchErsatztvPathRule:
    """fetch_ersatztv applies the streaming-path rule to the URL and every hop."""

    @pytest.mark.asyncio
    async def test_redirect_to_disallowed_path_is_never_fetched(self) -> None:
        base = settings.ersatztv_base_url.rstrip("/")
        requests: list[str] = []

        def upstream(request: httpx.Request) -> httpx.Response:
            requests.append(request.url.path)
            return httpx.Response(302, headers={"location": "/api/channels"})

        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            with pytest.raises(UpstreamProtocolError, match="not from ErsatzTV"):
                await fetch_ersatztv(client, f"{base}/iptv/session/8/live000010.ts", stream=True)

        assert requests == ["/iptv/session/8/live000010.ts"]

    @pytest.mark.asyncio
    async def test_channel_playlist_is_not_a_segment(self) -> None:
        requests: list[httpx.Request] = []

        def upstream(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, content=b"#EXTM3U\n")

        url = settings.ersatztv_base_url.rstrip("/") + "/iptv/channel/8.m3u8"
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
            with pytest.raises(ValueError, match="not from ErsatzTV"):
                await fetch_ersatztv(client, url, stream=True)
            assert (await fetch_ersatztv(client, url)).content == b"#EXTM3U\n"

        assert len(requests) == 1
