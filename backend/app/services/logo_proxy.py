"""Logo metadata can reference only explicitly trusted raster-image origins."""

from urllib.parse import urlsplit

import httpx

from app.config import settings
from app.services.bounded_http import LOGO_BYTES, read_bounded


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


def allowed_logo_url(url: str) -> bool:
    origin = _origin(url)
    trusted = [settings.ersatztv_base_url, *settings.ersatztv_logo_origins]
    return origin is not None and origin in {_origin(value) for value in trusted}


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


async def fetch_logo(client: httpx.AsyncClient, url: str) -> tuple[bytes, str]:
    for _ in range(6):
        if not allowed_logo_url(url):
            raise ValueError("Untrusted logo origin")
        response = await client.send(client.build_request("GET", url), stream=True)
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
