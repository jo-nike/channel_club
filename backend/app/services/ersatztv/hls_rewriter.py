"""HLS Manifest Rewriter for ErsatzTV.

Rewrites HLS manifests to proxy all segment URLs through backend.
This prevents exposing internal ErsatzTV URLs to clients.

Story: 7.5 - HLS Proxy Service
"""

import base64
from urllib.parse import urljoin

import httpx
from loguru import logger

from app.config import settings
from app.services.ersatztv.epg_service import get_channel_by_id

# Module-level logger with service context
log = logger.bind(service="ersatztv")


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

        # Build query string with token if provided
        token_qs = f"?token={token}" if token else ""

        for line in lines:
            stripped = line.strip()

            # Preserve empty lines
            if not stripped:
                rewritten.append(line)
                continue

            # Skip comments/tags (lines starting with #)
            if stripped.startswith("#"):
                rewritten.append(line)
                continue

            # Resolve relative URL to absolute
            if stripped.startswith("http://") or stripped.startswith("https://"):
                absolute_url = stripped
            else:
                absolute_url = urljoin(base_url, stripped)

            # Check if this is a nested m3u8 (variant playlist)
            if stripped.endswith(".m3u8"):
                # Rewrite to stream proxy endpoint with channel_id
                encoded = self._encode_url(absolute_url)
                # Use channel_id or placeholder for nested playlists
                cid = channel_id or "_nested"
                proxied = f"{self.stream_proxy_url}/{cid}?url={encoded}"
                if token:
                    proxied += f"&token={token}"
            else:
                # Segment URL - encode for segment proxy
                encoded = self._encode_url(absolute_url)
                proxied = f"{self.proxy_base_url}/{encoded}{token_qs}"

            log.debug("Manifest rewrite: {}... -> {}...", stripped[:40], proxied[:50])
            rewritten.append(proxied)

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
            log.error("Failed to decode segment URL: {}", e)
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


async def get_stream_manifest(channel_id: str) -> str:
    """Fetch and rewrite HLS manifest for a channel.

    Args:
        channel_id: Channel identifier

    Returns:
        Rewritten manifest content with proxied URLs

    Raises:
        ValueError: If channel not found or URL invalid
    """
    channel = get_channel_by_id(channel_id)
    if channel is None:
        raise ValueError(f"Channel not found: {channel_id}")

    stream_url = channel.stream_url

    # Validate URL is from ErsatzTV
    if not stream_url.startswith(settings.ersatztv_base_url):
        raise ValueError(f"Stream URL is not from ErsatzTV: {stream_url}")

    async with httpx.AsyncClient() as client:
        response = await client.get(stream_url, timeout=30)
        response.raise_for_status()
        manifest_content = response.text

    # Rewrite manifest with stream URL as base
    return rewrite_manifest(manifest_content, stream_url)


async def get_segment(encoded_url: str) -> tuple[bytes, str]:
    """Fetch a segment from ErsatzTV.

    Args:
        encoded_url: Base64-encoded segment URL

    Returns:
        Tuple of (segment content, content-type)

    Raises:
        ValueError: If URL invalid or not from ErsatzTV
    """
    # Decode the URL
    segment_url = decode_url(encoded_url)

    # Validate URL is from ErsatzTV
    if not segment_url.startswith(settings.ersatztv_base_url):
        raise ValueError(f"Segment URL is not from ErsatzTV: {segment_url}")

    async with httpx.AsyncClient() as client:
        response = await client.get(segment_url, timeout=60)
        response.raise_for_status()
        content = response.content
        content_type = response.headers.get("content-type", "video/mp2t")

    return content, content_type
