# Story 7.5: HLS Proxy Service

Status: review

## Story

As the system,
I want to proxy HLS streams through the backend,
so that ErsatzTV URLs are not exposed to clients.

## Acceptance Criteria

1. **Manifest rewriting**: `rewrite_manifest(manifest_content)` rewrites segment URLs to use `/api/ersatztv/segments/{encoded_url}`
2. **URL decoding**: `decode_url(encoded_url)` returns the original ErsatzTV segment URL
3. **Nested playlists**: HLS streams with nested variant playlists (master.m3u8 -> variant.m3u8) have all URLs proxied correctly

## Tasks / Subtasks

- [x] Task 1: Create HLS rewriter service (AC: #1, #2)
  - [x] Create `backend/app/services/ersatztv/hls_rewriter.py`
  - [x] Implement `HLSManifestRewriter` class
  - [x] Implement `rewrite_manifest(content, base_url)` method
  - [x] Implement `encode_url(url)` using URL-safe base64
  - [x] Implement `decode_url(encoded_url)` with padding restoration
- [x] Task 2: Handle nested playlists (AC: #3)
  - [x] Detect `.m3u8` URLs in manifest (variant playlists)
  - [x] Rewrite nested m3u8 URLs to use stream proxy endpoint
  - [x] Preserve HLS tags and metadata lines
- [x] Task 3: Add helper functions
  - [x] Implement `get_stream_manifest(channel_id)` to fetch and rewrite manifest
  - [x] Implement `get_segment(encoded_url)` to fetch actual segment
- [x] Task 4: Write tests
  - [x] Test manifest rewriting preserves HLS structure
  - [x] Test URL encoding/decoding roundtrip
  - [x] Test nested playlist handling

## Dev Notes

### Architecture Compliance

- **Service location**: `backend/app/services/ersatztv/hls_rewriter.py`
- **URL encoding**: Use URL-safe base64 to avoid path traversal issues
- **Streaming**: Segments should be streamed, not buffered (for large files)
- **Logging**: Use `loguru` logger

### Technical Implementation

**Service structure** (`backend/app/services/ersatztv/hls_rewriter.py`):
```python
"""HLS Manifest Rewriter for ErsatzTV

Rewrites HLS manifests to proxy all segment URLs through backend.
This prevents exposing internal ErsatzTV URLs to clients.

Story: 7.5 - HLS Proxy Service
"""
import base64
import re
from urllib.parse import urljoin
from loguru import logger


class HLSManifestRewriter:
    """Rewrites HLS manifest files to proxy segment URLs"""

    def __init__(self, proxy_base_url: str = "/api/ersatztv/segments"):
        self.proxy_base_url = proxy_base_url
        self.stream_proxy_url = "/api/ersatztv/stream"

    def rewrite_manifest(self, manifest_content: str, base_url: str) -> str:
        """
        Rewrite HLS manifest to proxy all segment and variant URLs.

        Args:
            manifest_content: Raw .m3u8 manifest content
            base_url: Base URL for resolving relative paths

        Returns:
            Rewritten manifest with proxied URLs
        """
        lines = manifest_content.split('\n')
        rewritten = []

        for line in lines:
            stripped = line.strip()

            # Skip empty lines and comments/tags
            if not stripped or stripped.startswith('#'):
                rewritten.append(line)
                continue

            # Resolve relative URL to absolute
            if stripped.startswith('http://') or stripped.startswith('https://'):
                absolute_url = stripped
            else:
                absolute_url = urljoin(base_url, stripped)

            # Check if this is a nested m3u8 (variant playlist)
            if stripped.endswith('.m3u8'):
                # Rewrite to stream proxy endpoint
                encoded = self._encode_url(absolute_url)
                proxied = f"{self.stream_proxy_url}?url={encoded}"
            else:
                # Segment URL - encode for segment proxy
                encoded = self._encode_url(absolute_url)
                proxied = f"{self.proxy_base_url}/{encoded}"

            logger.debug(f"Rewriting: {stripped[:40]}... -> {proxied[:50]}...")
            rewritten.append(proxied)

        return '\n'.join(rewritten)

    def _encode_url(self, url: str) -> str:
        """Encode URL to URL-safe base64"""
        encoded = base64.urlsafe_b64encode(url.encode('utf-8')).decode('utf-8')
        return encoded.rstrip('=')  # Remove padding for cleaner URLs

    @staticmethod
    def decode_url(encoded_url: str) -> str:
        """
        Decode URL from base64-encoded string.

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
            encoded_url += '=' * padding

        try:
            return base64.urlsafe_b64decode(encoded_url).decode('utf-8')
        except Exception as e:
            logger.error(f"Failed to decode URL: {e}")
            raise ValueError(f"Invalid encoded URL: {e}")


# Singleton instance
_rewriter = HLSManifestRewriter()


def rewrite_manifest(content: str, base_url: str) -> str:
    """Convenience function to rewrite manifest"""
    return _rewriter.rewrite_manifest(content, base_url)


def decode_url(encoded_url: str) -> str:
    """Convenience function to decode URL"""
    return HLSManifestRewriter.decode_url(encoded_url)
```

### HLS Manifest Structure

ErsatzTV HLS manifests follow this structure:

**Master Playlist** (channel.m3u8):
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=5000000
video/1080p.m3u8
```

**Variant Playlist** (1080p.m3u8):
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-MEDIA-SEQUENCE:12345
#EXTINF:6.000,
segment-12345.ts
#EXTINF:6.000,
segment-12346.ts
```

### Reference from Prototype

Port from `/home/jon/Code/iptv_viewer/app/streaming/hls_rewriter.py`:
- URL-safe base64 encoding/decoding
- Line-by-line manifest processing
- Preserves HLS tags and metadata

### Project Structure Notes

New files:
- `backend/app/services/ersatztv/hls_rewriter.py` (new)
- `backend/app/services/ersatztv/hls_rewriter_test.py` (new)

### Testing Requirements

```python
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

def test_rewrite_manifest_preserves_tags():
    """Rewriter preserves HLS tags"""
    result = rewrite_manifest(SAMPLE_MANIFEST, "http://example.com/")
    assert "#EXTM3U" in result
    assert "#EXT-X-TARGETDURATION:6" in result

def test_rewrite_manifest_proxies_segments():
    """Rewriter proxies segment URLs"""
    result = rewrite_manifest(SAMPLE_MANIFEST, "http://example.com/")
    assert "/api/ersatztv/segments/" in result
    assert "segment-001.ts" not in result

def test_rewrite_manifest_handles_nested_m3u8():
    """Rewriter proxies nested variant playlists"""
    result = rewrite_manifest(SAMPLE_MASTER, "http://example.com/")
    assert "/api/ersatztv/stream?url=" in result

def test_url_encoding_roundtrip():
    """URL encoding/decoding preserves URL"""
    original = "http://192.168.50.108:8409/iptv/segment-12345.ts?token=abc"
    rewriter = HLSManifestRewriter()
    encoded = rewriter._encode_url(original)
    decoded = HLSManifestRewriter.decode_url(encoded)
    assert decoded == original

def test_decode_url_handles_special_chars():
    """Decoding handles special characters in URLs"""
    url = "http://example.com/path?param=value&other=123"
    rewriter = HLSManifestRewriter()
    encoded = rewriter._encode_url(url)
    decoded = HLSManifestRewriter.decode_url(encoded)
    assert decoded == url
```

### Security Considerations

- **URL validation**: Decoded URLs should be validated before fetching
- **Only allow ErsatzTV base URL**: Reject URLs not starting with `settings.ersatztv_base_url`
- **Timeout on segment fetch**: Use reasonable timeout to prevent hanging

### References

- [Source: /home/jon/Code/iptv_viewer/app/streaming/hls_rewriter.py] - Prototype HLS rewriter
- [Source: backend/app/services/dispatcharr.py] - Existing proxy pattern
- [Source: _bmad-output/project-context.md] - Service layer patterns

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- Used standard `logging` module instead of `loguru` to match existing codebase patterns

### Completion Notes List

- Implemented `HLSManifestRewriter` class with manifest rewriting and URL encoding/decoding
- Added security validation to only accept URLs from configured ErsatzTV base URL
- Implemented async helper functions `get_stream_manifest()` and `get_segment()` for API use
- All 25 unit tests pass covering manifest rewriting, URL encoding/decoding, nested playlists, and security validation
- Full test suite (225 tests) passes with no regressions
- Exported all public functions via `__init__.py`

### File List

- `backend/app/services/ersatztv/hls_rewriter.py` (new)
- `backend/app/services/ersatztv/__init__.py` (modified - added exports)
- `backend/tests/services/ersatztv/test_hls_rewriter.py` (new)

### Change Log

- 2026-01-03: Initial implementation of HLS Proxy Service (Story 7.5)
