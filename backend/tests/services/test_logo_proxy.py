"""MEDIA-09: trust origins and raster bytes, including every redirect."""

import httpx
import pytest

from app.config import settings
from app.services.logo_proxy import fetch_logo


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url", ["http://evil.invalid/logo", "file:///tmp/private", "http://source@evil.invalid/logo"]
)
async def test_untrusted_logo_never_connects(monkeypatch, url):
    monkeypatch.setattr(settings, "ersatztv_base_url", "http://source")

    def upstream(req):
        pytest.fail("untrusted origin requested")

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        with pytest.raises(ValueError, match="Untrusted"):
            await fetch_logo(client, url)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mime,body",
    [
        ("text/html", b"<script>evil()</script>"),
        ("image/svg+xml", b'<svg onload="evil()"/>'),
        ("image/png", b"<script>evil()</script>"),
    ],
)
async def test_active_or_mislabeled_logo_rejected(monkeypatch, mime, body):
    monkeypatch.setattr(settings, "ersatztv_base_url", "http://source")
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(200, headers={"content-type": mime}, content=body)
        )
    ) as client:
        with pytest.raises(ValueError):
            await fetch_logo(client, "http://source/logo")


@pytest.mark.asyncio
async def test_every_redirect_origin_is_checked(monkeypatch):
    monkeypatch.setattr(settings, "ersatztv_base_url", "http://source")
    requests = []

    def upstream(req):
        requests.append(str(req.url))
        return httpx.Response(302, headers={"location": "http://evil.invalid/private"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        with pytest.raises(ValueError, match="Untrusted"):
            await fetch_logo(client, "http://source/logo")
    assert requests == ["http://source/logo"]


@pytest.mark.asyncio
async def test_explicit_trusted_raster_origin_works(monkeypatch):
    monkeypatch.setattr(settings, "ersatztv_logo_origins", ["https://cdn.test"])
    body = b"GIF89a" + b"\0" * 30
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda req: httpx.Response(200, headers={"content-type": "image/gif"}, content=body)
        )
    ) as client:
        assert await fetch_logo(client, "https://cdn.test/logo") == (body, "image/gif")
