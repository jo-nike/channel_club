"""HLS Manifest Rewriter for ErsatzTV.

Rewrites HLS manifests to proxy all segment URLs through backend.
This prevents exposing internal ErsatzTV URLs to clients.

Story: 7.5 - HLS Proxy Service
"""

import base64
import re
from urllib.parse import quote, unquote, urlencode, urljoin, urlsplit

import httpx
from loguru import logger

from app.config import settings
from app.services.bounded_http import MANIFEST_BYTES, decoded_response, read_bounded

# Module-level logger with service context
log = logger.bind(service="ersatztv")

# Only these schemes may be proxied, and their implicit ports
_DEFAULT_PORTS = {"http": 80, "https": 443}


def is_ersatztv_url(url: str) -> bool:
    """Check that a URL points at the configured ErsatzTV server.

    A prefix check is not enough: "http://host:port@evil.example.com/x" starts
    with the configured base URL but resolves to evil.example.com, because
    "host:port" is parsed as userinfo. This compares the parsed scheme, host and
    port instead, and rejects any URL carrying a userinfo component.

    Args:
        url: Absolute URL to validate

    Returns:
        True if the URL targets the configured ErsatzTV server
    """
    try:
        target = urlsplit(url)
        base = urlsplit(settings.ersatztv_base_url)

        # Userinfo makes the real host ambiguous - never proxy it
        if target.username or target.password:
            return False
        if target.scheme not in _DEFAULT_PORTS or target.scheme != base.scheme:
            return False
        if not target.hostname or target.hostname != base.hostname:
            return False

        target_port = target.port or _DEFAULT_PORTS[target.scheme]
        base_port = base.port or _DEFAULT_PORTS[base.scheme]
    except ValueError:
        # Malformed netloc (bad port, unbalanced IPv6 brackets, ...)
        return False

    return target_port == base_port


# ErsatzTV's streaming output. Segments (and keys, init sections) live under a
# segmenter session; playlists are the channel playlist or a session's variant.
# Everything else on the host (XMLTV, the M3U, logos, /api, the web UI) is not
# reachable through the proxy.
_SEGMENT_PREFIXES = {("iptv", "session")}
_PLAYLIST_PREFIXES = {("iptv", "session"), ("iptv", "channel")}

# Media types a proxied segment may be served as; anything else becomes video/mp2t
SEGMENT_MEDIA_TYPES = frozenset(
    {
        "video/mp2t",
        "video/mp4",
        "video/iso.segment",
        "audio/aac",
        "audio/mp4",
        "application/octet-stream",
    }
)


def is_ersatztv_media_url(url: str, *, playlist: bool = False) -> bool:
    """Check that a URL is on ErsatzTV and inside its streaming paths.

    The path is percent-decoded before it is checked, and any dot segment,
    empty segment (duplicate slash), backslash or leftover percent sign is
    rejected rather than normalised, so "/iptv/session/../../api/x" and its
    encoded forms never pass.

    Args:
        url: Absolute URL to validate
        playlist: Allow playlist paths (session and channel) instead of the
            segment paths (session only)

    Returns:
        True if the URL targets an allowed ErsatzTV streaming path
    """
    if not is_ersatztv_url(url):
        return False
    path = unquote(urlsplit(url).path)
    if "%" in path or "\\" in path or not path.startswith("/"):
        return False
    parts = path[1:].split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return False
    prefixes = _PLAYLIST_PREFIXES if playlist else _SEGMENT_PREFIXES
    return len(parts) > 2 and (parts[0], parts[1]) in prefixes


def segment_media_type(content_type: str | None) -> str:
    """Return the upstream media type if it is a segment type, else video/mp2t."""
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    return mime if mime in SEGMENT_MEDIA_TYPES else "video/mp2t"


class UpstreamProtocolError(ValueError):
    """ErsatzTV answered with something other than HLS, or redirected off its paths."""


async def fetch_ersatztv(
    client: httpx.AsyncClient,
    url: str,
    *,
    stream: bool = False,
    max_redirects: int = 5,
) -> httpx.Response:
    """GET ``url``, following redirects only while every hop stays on ErsatzTV.

    The client MUST be created with ``follow_redirects=False``. httpx's own
    redirect following would connect to whatever a hop points at, reopening the
    SSRF that :func:`is_ersatztv_url` closes. This validates every hop before
    connecting to it, including the streaming-path rule of
    :func:`is_ersatztv_media_url`: playlist paths for a manifest fetch
    (``stream=False``), segment paths for a streamed fetch.

    Args:
        client: httpx client created with ``follow_redirects=False``
        url: Absolute URL to fetch; validated against the ErsatzTV allowlist
        stream: If True, fetch a segment and return with the response body
            still open (the caller owns closing it); if False, fetch a manifest
        max_redirects: Maximum number of on-host redirect hops to follow

    Returns:
        The final, non-redirect response.

    Raises:
        ValueError: If ``url`` itself is not an allowed ErsatzTV URL.
        UpstreamProtocolError: If a redirect leaves the allowed ErsatzTV paths,
            the redirect limit is exceeded, or a manifest reply is not HLS or
            exceeds its byte budget.
    """
    for hop in range(max_redirects + 1):
        if not is_ersatztv_media_url(url, playlist=not stream):
            if hop:
                raise UpstreamProtocolError("Redirect target is not from ErsatzTV")
            raise ValueError(f"URL is not from ErsatzTV: {url}")
        response = await client.send(client.build_request("GET", url), stream=True)
        if response.is_redirect and "location" in response.headers:
            location = str(response.url.join(response.headers["location"]))
            await response.aclose()
            url = location
            continue
        if not stream:
            # Cold-start errors commonly have JSON/HTML bodies. Preserve the
            # HTTP error so the route can retry; never parse it as a manifest.
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError:
                await response.aclose()
                raise
            mime = response.headers.get("content-type", "").split(";", 1)[0].lower()
            if mime and mime not in {
                "application/vnd.apple.mpegurl",
                "application/x-mpegurl",
                "audio/mpegurl",
                "audio/x-mpegurl",
                "text/plain",
                "application/octet-stream",
            }:
                await response.aclose()
                raise UpstreamProtocolError("Upstream is not an HLS manifest")
            try:
                body = await read_bounded(response, MANIFEST_BYTES)
            except ValueError as e:
                raise UpstreamProtocolError(str(e)) from e
            if (
                response.is_success
                and body.strip()
                and not body.removeprefix(b"\xef\xbb\xbf").startswith(b"#EXTM3U")
            ):
                raise UpstreamProtocolError("Invalid HLS manifest header")
            return decoded_response(response, body)
        return response
    raise UpstreamProtocolError("Too many upstream redirects")


class HLSManifestRewriter:
    """Rewrites HLS manifest files to proxy segment URLs."""

    def __init__(self, proxy_base_url: str = "/api/ersatztv/segments"):
        """Initialize the HLS manifest rewriter.

        Args:
            proxy_base_url: Base URL for proxied segment requests
        """
        self.proxy_base_url = proxy_base_url
        self.stream_proxy_url = "/api/ersatztv/stream"

    def rewrite_manifest(
        self,
        manifest_content: str,
        base_url: str,
        token: str | None = None,
        channel_id: str | None = None,
    ) -> str:
        """Rewrite HLS manifest to proxy all segment and variant URLs.

        Args:
            manifest_content: Raw .m3u8 manifest content
            base_url: Base URL for resolving relative paths
            token: Optional JWT token to include in rewritten URLs for auth
            channel_id: Channel ID to include in nested playlist URLs

        Returns:
            Rewritten manifest with proxied URLs
        """
        lines = manifest_content.split("\n")
        rewritten = []

        def proxy_uri(uri: str, playlist: bool | None = None) -> str:
            absolute = urljoin(base_url, uri)
            encoded = self._encode_url(absolute)
            if playlist is True or (
                playlist is None and urlsplit(absolute).path.lower().endswith(".m3u8")
            ):
                query = {"url": encoded}
                if token:
                    query["token"] = token
                cid = quote(channel_id or "_nested", safe="")
                return f"{self.stream_proxy_url}/{cid}?{urlencode(query)}"
            suffix = "?" + urlencode({"token": token}) if token else ""
            return f"{self.proxy_base_url}/{encoded}{suffix}"

        for line in lines:
            stripped = line.strip()
            if not stripped:
                rewritten.append(line)
            elif stripped.startswith("#"):
                # URI is a quoted HLS attribute (commas may appear inside it).
                # Some playlist attributes use extensionless provider URLs.
                playlist = stripped.split(":", 1)[0] in {
                    "#EXT-X-MEDIA",
                    "#EXT-X-I-FRAME-STREAM-INF",
                    "#EXT-X-RENDITION-REPORT",
                }
                rewritten.append(
                    re.sub(
                        r'(\bURI=")([^"]*)(")',
                        lambda match, playlist=playlist: (
                            match[1] + proxy_uri(match[2], playlist) + match[3]
                        ),
                        line,
                    )
                )
            else:
                rewritten.append(proxy_uri(stripped))

        return "\n".join(rewritten)

    def _encode_url(self, url: str) -> str:
        """Encode URL to URL-safe base64.

        Args:
            url: URL to encode

        Returns:
            URL-safe base64 encoded string without padding
        """
        encoded = base64.urlsafe_b64encode(url.encode("utf-8")).decode("utf-8")
        return encoded.rstrip("=")  # Remove padding for cleaner URLs

    @staticmethod
    def decode_url(encoded_url: str) -> str:
        """Decode URL from base64-encoded string.

        Args:
            encoded_url: Base64-encoded URL

        Returns:
            Original URL

        Raises:
            ValueError: If decoding fails
        """
        # Restore padding
        padding = 4 - (len(encoded_url) % 4)
        if padding != 4:
            encoded_url += "=" * padding

        try:
            return base64.urlsafe_b64decode(encoded_url).decode("utf-8")
        except Exception as e:
            # Malformed client input, answered 400 by the router
            log.debug("Failed to decode segment URL: {}", e)
            raise ValueError(f"Invalid encoded URL: {e}") from e


# Singleton instance
_rewriter = HLSManifestRewriter()


def rewrite_manifest(
    content: str,
    base_url: str,
    token: str | None = None,
    channel_id: str | None = None,
) -> str:
    """Convenience function to rewrite manifest.

    Args:
        content: Raw manifest content
        base_url: Base URL for resolving relative paths
        token: Optional JWT token to include in rewritten URLs for auth
        channel_id: Channel ID to include in nested playlist URLs

    Returns:
        Rewritten manifest with proxied URLs
    """
    return _rewriter.rewrite_manifest(content, base_url, token=token, channel_id=channel_id)


def decode_url(encoded_url: str) -> str:
    """Convenience function to decode URL.

    Args:
        encoded_url: Base64-encoded URL

    Returns:
        Original URL
    """
    return HLSManifestRewriter.decode_url(encoded_url)
