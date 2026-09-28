"""Logo metadata can reference only explicitly trusted raster-image origins."""

import asyncio
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Mapping, Sequence
from urllib.parse import urlsplit

import httpx
from loguru import logger

from app.config import settings
from app.services.bounded_http import LOGO_BYTES, read_bounded

log = logger.bind(service="logo_proxy")

# Browsers keep a served logo this long; an upstream 404 more briefly
LOGO_CACHE_CONTROL = "public, max-age=3600"
LOGO_NOT_FOUND_CACHE_CONTROL = "public, max-age=300"


def _origin(url: str) -> tuple[str, str, int] | None:
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return None
        if parsed.username is not None or parsed.password is not None:
            return None
        return (
            parsed.scheme,
            parsed.hostname,
            parsed.port or (443 if parsed.scheme == "https" else 80),
        )
    except ValueError:
        return None


def allowed_logo_url(url: str, trusted_origins: Sequence[str] | None = None) -> bool:
    """Only the ErsatzTV origins by default; a caller with its own fixed origin
    passes it as `trusted_origins`, which replaces (never extends) that list."""
    origin = _origin(url)
    if trusted_origins is None:
        trusted_origins = [settings.ersatztv_base_url, *settings.ersatztv_logo_origins]
    return origin is not None and origin in {_origin(value) for value in trusted_origins}


def raster_type(body: bytes) -> str:
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        return "image/webp"
    raise ValueError("Logo must be a PNG, JPEG, GIF or WebP image")


async def fetch_logo(
    client: httpx.AsyncClient,
    url: str,
    *,
    trusted_origins: Sequence[str] | None = None,
    headers: Mapping[str, str] | None = None,
) -> tuple[bytes, str]:
    """Fetch a raster logo, checking every hop's origin against the allowlist.

    `headers` (e.g. an API key) go only to the trusted origins, since a redirect
    is followed only when its target passes the same check.
    """
    for _ in range(6):
        if not allowed_logo_url(url, trusted_origins):
            raise ValueError("Untrusted logo origin")
        response = await client.send(client.build_request("GET", url, headers=headers), stream=True)
        try:
            if response.is_redirect and "location" in response.headers:
                url = str(response.url.join(response.headers["location"]))
                continue
            response.raise_for_status()
            claimed = response.headers.get("content-type", "").split(";", 1)[0].lower()
            if claimed not in {
                "image/png",
                "image/jpeg",
                "image/gif",
                "image/webp",
                "application/octet-stream",
            }:
                raise ValueError("Unsafe logo content type")
            body = await read_bounded(response, LOGO_BYTES)
            actual = raster_type(body)
            if claimed not in {actual, "application/octet-stream"}:
                raise ValueError("Logo content type does not match its bytes")
            return body, actual
        finally:
            await response.aclose()
    raise ValueError("Too many logo redirects")


class LogoNotFoundError(Exception):
    """The upstream answered 404 for this logo (remembered for not_found_ttl)."""


class LogoUnavailableError(Exception):
    """The logo could not be fetched as a raster image (remembered briefly)."""


class LogoCache:
    """Logos served by the unauthenticated logo routes, keyed by a string.

    Anyone can request a logo, so each is fetched at most once per TTL (one
    fetch at a time per key), a failure is remembered briefly and a 404 for
    longer, and the cache is bounded by total bytes (least recently used first).
    The first failure of a logo is logged at WARNING, repeats at DEBUG.
    """

    def __init__(
        self, *, ttl: float = 3600, failure_ttl: float = 60, max_bytes: int = 32 * 1024 * 1024
    ) -> None:
        self.ttl = ttl
        self.failure_ttl = failure_ttl
        self.max_bytes = max_bytes
        self._entries: OrderedDict[str, tuple[float, bytes, str]] = OrderedDict()
        self._bytes = 0
        self._failures: dict[str, float] = {}
        self._not_found: dict[str, float] = {}
        self._reported: set[str] = set()
        self._locks: dict[str, asyncio.Lock] = {}

    def cached(self, key: str) -> tuple[bytes, str] | None:
        """The cached logo, or None; raises for a remembered failure or 404."""
        entry = self._entries.get(key)
        if entry is not None:
            expires_at, body, content_type = entry
            if time.monotonic() < expires_at:
                self._entries.move_to_end(key)
                return body, content_type
            del self._entries[key]
            self._bytes -= len(body)
        now = time.monotonic()
        if now < self._not_found.get(key, 0.0):
            raise LogoNotFoundError(f"Logo {key} not found")
        if now < self._failures.get(key, 0.0):
            raise LogoUnavailableError(f"Logo {key} failed recently")
        return None

    def store(self, key: str, body: bytes, content_type: str) -> None:
        old = self._entries.pop(key, None)
        if old is not None:
            self._bytes -= len(old[1])
        self._entries[key] = (time.monotonic() + self.ttl, body, content_type)
        self._bytes += len(body)
        while self._bytes > self.max_bytes and self._entries:
            _, (_, evicted, _) = self._entries.popitem(last=False)
            self._bytes -= len(evicted)

    async def get(
        self,
        key: str,
        fetch: Callable[[], Awaitable[tuple[bytes, str]]],
        *,
        not_found_ttl: float,
    ) -> tuple[bytes, str]:
        """Serve `key` from the cache, or fetch it once for all concurrent callers.

        Raises:
            LogoNotFoundError: The upstream answered 404 (now or recently).
            LogoUnavailableError: The fetch failed (now or recently).
            Anything else `fetch` raises passes through and is not remembered.
        """
        cached = self.cached(key)
        if cached is not None:
            return cached
        async with self._locks.setdefault(key, asyncio.Lock()):
            # Another request may have fetched (or failed) while this one waited
            cached = self.cached(key)
            if cached is not None:
                return cached
            try:
                body, content_type = await fetch()
            except httpx.HTTPStatusError as e:
                if e.response.status_code != 404:
                    raise self._failed(key, e) from e
                self._not_found[key] = time.monotonic() + not_found_ttl
                self._report(key, "INFO", "not found upstream")
                raise LogoNotFoundError(f"Logo {key} not found") from e
            except (httpx.HTTPError, ValueError, TimeoutError) as e:
                raise self._failed(key, e) from e
        self._failures.pop(key, None)
        self._not_found.pop(key, None)
        self._reported.discard(key)
        self.store(key, body, content_type)
        return body, content_type

    def _failed(self, key: str, error: Exception) -> LogoUnavailableError:
        self._failures[key] = time.monotonic() + self.failure_ttl
        self._report(key, "WARNING", f"unavailable: {str(error) or type(error).__name__}")
        return LogoUnavailableError(f"Failed to fetch logo {key}: {error}")

    def _report(self, key: str, level: str, outcome: str) -> None:
        # One line per logo per outage; the retries after each memo expires are DEBUG
        log.log(level if key not in self._reported else "DEBUG", "Logo {} {}", key, outcome)
        self._reported.add(key)

    def clear(self, prefix: str = "") -> None:
        """Drop the logos, failures and 404s whose keys start with `prefix`."""
        for key in [key for key in self._entries if key.startswith(prefix)]:
            self._bytes -= len(self._entries.pop(key)[1])
        for memo in (self._failures, self._not_found):
            for key in [key for key in memo if key.startswith(prefix)]:
                del memo[key]
        self._reported = {key for key in self._reported if not key.startswith(prefix)}

    def reset(self) -> None:
        """Forget everything, including the locks (tests: new event loop)."""
        self.clear()
        self._locks.clear()


# One cache for the Dispatcharr and ErsatzTV logo routes
LOGO_CACHE = LogoCache()


def reset_logo_cache() -> None:
    """Empty the shared logo cache (tests)."""
    LOGO_CACHE.reset()
