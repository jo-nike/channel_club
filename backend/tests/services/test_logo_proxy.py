"""MEDIA-09: trust origins and raster bytes, including every redirect."""

from io import StringIO

import httpx
import pytest
from loguru import logger

from app.config import settings
from app.services.logo_proxy import (
    LogoCache,
    LogoNotFoundError,
    LogoUnavailableError,
    fetch_logo,
)


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


PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 30


@pytest.mark.asyncio
async def test_own_origin_replaces_the_ersatztv_allowlist(monkeypatch):
    """A caller's fixed origin is the only trusted one: ErsatzTV origins are refused."""
    monkeypatch.setattr(settings, "ersatztv_base_url", "http://source")
    monkeypatch.setattr(settings, "ersatztv_logo_origins", ["https://cdn.test"])

    def upstream(req):
        pytest.fail("off-origin logo requested")

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        for url in ["http://source/logo", "https://cdn.test/logo", "http://evil.invalid/logo"]:
            with pytest.raises(ValueError, match="Untrusted"):
                await fetch_logo(client, url, trusted_origins=["http://dispatcharr.test:9191"])


@pytest.mark.asyncio
async def test_dispatcharr_origin_is_not_trusted_by_default(monkeypatch):
    """The ErsatzTV logo route keeps its own allowlist; Dispatcharr is only added per call."""
    monkeypatch.setattr(settings, "ersatztv_base_url", "http://source")
    monkeypatch.setattr(settings, "dispatcharr_url", "http://dispatcharr.test:9191")

    def upstream(req):
        pytest.fail("off-origin logo requested")

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        with pytest.raises(ValueError, match="Untrusted"):
            await fetch_logo(client, "http://dispatcharr.test:9191/api/channels/logos/1/cache/")


@pytest.mark.asyncio
async def test_headers_never_follow_a_redirect_off_the_trusted_origin():
    """An API key sent to the trusted origin is not replayed to a redirect target elsewhere."""
    requests: list[httpx.Request] = []

    def upstream(req):
        requests.append(req)
        return httpx.Response(302, headers={"location": "http://evil.invalid/steal"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        with pytest.raises(ValueError, match="Untrusted"):
            await fetch_logo(
                client,
                "http://dispatcharr.test:9191/api/channels/logos/1/cache/",
                trusted_origins=["http://dispatcharr.test:9191"],
                headers={"Authorization": "ApiKey secret"},
            )
    assert [str(r.url) for r in requests] == [
        "http://dispatcharr.test:9191/api/channels/logos/1/cache/"
    ]


@pytest.mark.asyncio
async def test_headers_reach_the_trusted_origin():
    seen: list[str | None] = []

    def upstream(req):
        seen.append(req.headers.get("authorization"))
        return httpx.Response(200, headers={"content-type": "image/png"}, content=PNG)

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as client:
        result = await fetch_logo(
            client,
            "http://dispatcharr.test:9191/api/channels/logos/1/cache/",
            trusted_origins=["http://dispatcharr.test:9191"],
            headers={"Authorization": "ApiKey secret"},
        )
    assert result == (PNG, "image/png")
    assert seen == ["ApiKey secret"]


class TestLogoCache:
    """The shared logo cache is bounded by bytes and drops the least recently used first."""

    def test_evicts_least_recently_used_over_the_byte_budget(self) -> None:
        cache = LogoCache(max_bytes=25)
        cache.store("a", b"a" * 10, "image/png")
        cache.store("b", b"b" * 10, "image/png")
        assert cache.cached("a") is not None  # a is now the most recently used
        cache.store("c", b"c" * 10, "image/png")

        assert cache.cached("b") is None
        assert cache.cached("a") == (b"a" * 10, "image/png")
        assert cache.cached("c") == (b"c" * 10, "image/png")

    def test_expired_logo_is_not_served(self) -> None:
        cache = LogoCache(ttl=-1)
        cache.store("a", b"a" * 10, "image/png")
        assert cache.cached("a") is None

    def test_clear_drops_only_the_prefix(self) -> None:
        cache = LogoCache()
        cache.store("dispatcharr:1", b"a", "image/png")
        cache.store("ersatztv:1:http://x/logo.png", b"b", "image/png")
        cache.clear("dispatcharr:")
        assert cache.cached("dispatcharr:1") is None
        assert cache.cached("ersatztv:1:http://x/logo.png") is not None

    @pytest.mark.asyncio
    async def test_concurrent_misses_share_one_fetch(self) -> None:
        import asyncio

        cache = LogoCache()
        calls = 0

        async def fetch() -> tuple[bytes, str]:
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.01)
            return b"png", "image/png"

        results = await asyncio.gather(*(cache.get("k", fetch, not_found_ttl=60) for _ in range(5)))
        assert results == [(b"png", "image/png")] * 5
        assert calls == 1

    @pytest.mark.asyncio
    async def test_upstream_404_is_remembered_until_its_ttl(self, monkeypatch) -> None:
        now = [1000.0]
        monkeypatch.setattr("app.services.logo_proxy.time.monotonic", lambda: now[0])
        cache = LogoCache()
        calls = 0

        async def missing() -> tuple[bytes, str]:
            nonlocal calls
            calls += 1
            request = httpx.Request("GET", "http://source/logo")
            response = httpx.Response(404, request=request)
            raise httpx.HTTPStatusError("404", request=request, response=response)

        for _ in range(2):
            with pytest.raises(LogoNotFoundError):
                await cache.get("k", missing, not_found_ttl=300)
        assert calls == 1

        now[0] += 300
        with pytest.raises(LogoNotFoundError):
            await cache.get("k", missing, not_found_ttl=300)
        assert calls == 2

    @pytest.mark.asyncio
    async def test_failure_logs_once_per_logo_until_it_recovers(self, monkeypatch) -> None:
        now = [1000.0]
        monkeypatch.setattr("app.services.logo_proxy.time.monotonic", lambda: now[0])
        cache = LogoCache(failure_ttl=60)
        state = {"down": True}

        async def fetch() -> tuple[bytes, str]:
            if state["down"]:
                raise httpx.ConnectError("All connection attempts failed")
            return b"png", "image/png"

        output = StringIO()
        sink = logger.add(output, level="DEBUG", format="{level}|{message}")
        try:
            for _ in range(3):  # two memo windows, three requests in each
                for _ in range(3):
                    with pytest.raises(LogoUnavailableError):
                        await cache.get("k", fetch, not_found_ttl=60)
                now[0] += 60
            state["down"] = False
            assert await cache.get("k", fetch, not_found_ttl=60) == (b"png", "image/png")
            cache.clear()
            state["down"] = True
            with pytest.raises(LogoUnavailableError):
                await cache.get("k", fetch, not_found_ttl=60)
        finally:
            logger.remove(sink)

        levels = [line.split("|", 1)[0] for line in output.getvalue().splitlines()]
        assert levels == ["WARNING", "DEBUG", "DEBUG", "WARNING"]

    @pytest.mark.asyncio
    async def test_other_exceptions_pass_through_and_are_not_remembered(self) -> None:
        cache = LogoCache()
        calls = 0

        async def broken() -> tuple[bytes, str]:
            nonlocal calls
            calls += 1
            raise KeyError("bug")

        for _ in range(2):
            with pytest.raises(KeyError):
                await cache.get("k", broken, not_found_ttl=60)
        assert calls == 2
