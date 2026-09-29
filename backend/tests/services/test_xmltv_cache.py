"""One XMLTV cache behind both guides: stale-while-revalidate, backoff and health (D-06, N-01).

Every test runs against the Dispatcharr guide (EPGService) and the ErsatzTV guide.
"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta, tzinfo
from io import StringIO
from typing import Any, Self

import httpx
import pytest
from loguru import logger

from app.config import settings
from app.services import epg_service, xmltv_cache
from app.services.epg_service import EPGService, EPGServiceError
from app.services.ersatztv import xmltv_parser
from app.services.ersatztv.refresh import FeedUnavailableError
from app.services.http_clients import DISPATCHARR, ERSATZTV
from app.services.xmltv_cache import XmltvCache
from tests.http_helpers import mock_upstream


def _xmltv(title: str) -> str:
    now = datetime.now(UTC)
    start = (now - timedelta(minutes=30)).strftime("%Y%m%d%H%M%S")
    stop = (now + timedelta(minutes=30)).strftime("%Y%m%d%H%M%S")
    return (
        f'<tv><programme start="{start} +0000" stop="{stop} +0000" channel="ch1">'
        f"<title>{title}</title></programme></tv>"
    )


type Handler = Callable[[httpx.Request], httpx.Response | Awaitable[httpx.Response]]


class _Upstream:
    """The XMLTV upstream both guides fetch from; counts requests."""

    def __init__(self) -> None:
        self.handler: Handler = lambda request: httpx.Response(200, text=_xmltv("Show"))
        self.requests = 0

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests += 1
        response = self.handler(request)
        if isinstance(response, httpx.Response):
            return response
        return await response


@pytest.fixture
def upstream(monkeypatch: pytest.MonkeyPatch) -> _Upstream:
    upstream = _Upstream()
    # Each guide fetches through its upstream's shared client
    mock_upstream(DISPATCHARR, upstream)
    mock_upstream(ERSATZTV, upstream)
    return upstream


@pytest.fixture(params=["dispatcharr", "ersatztv"])
def source(request: pytest.FixtureRequest) -> tuple[XmltvCache[Any], type[Exception]]:
    """A guide cache and the error it raises with no data (conftest resets the ErsatzTV one)."""
    if request.param == "dispatcharr":
        return EPGService("http://dispatcharr.test"), EPGServiceError
    return xmltv_parser.guide, FeedUnavailableError


class _Clock:
    offset = timedelta(0)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> _Clock:
    """Move the cache's clock; a naive now() fails the test."""
    clock = _Clock()

    class _Datetime(datetime):
        @classmethod
        def now(cls, tz: tzinfo | None = None) -> Self:
            assert tz is not None, "the guide cache must use aware time"
            moved = datetime.now(tz) + clock.offset
            return cls.fromtimestamp(moved.timestamp(), tz)

    monkeypatch.setattr(xmltv_cache, "datetime", _Datetime)
    return clock


def _titles(programmes: list[Any]) -> list[str]:
    return [programme.title for programme in programmes]


async def _settle(cache: XmltvCache[Any]) -> None:
    if cache._refresh_task is not None:
        await cache._refresh_task


def _expire(cache: XmltvCache[Any]) -> None:
    cache._cache_expires = datetime.now(UTC) - timedelta(seconds=1)


async def test_readers_get_stale_data_at_once_while_a_refresh_hangs(
    source: tuple[XmltvCache[Any], type[Exception]], upstream: _Upstream
) -> None:
    cache, _ = source
    await cache.ensure_fresh()
    _expire(cache)
    release = asyncio.Event()

    async def hang(request: httpx.Request) -> httpx.Response:
        await release.wait()
        return httpx.Response(200, text=_xmltv("New Show"))

    upstream.handler = hang
    reads = [cache.programmes("ch1") for _ in range(10)]
    results = await asyncio.wait_for(asyncio.gather(*reads), 0.5)

    assert all(_titles(result) == ["Show"] for result in results)
    await asyncio.sleep(0)
    assert upstream.requests == 2  # the warm-up and one refresh
    release.set()
    await _settle(cache)
    assert _titles(await cache.programmes("ch1")) == ["New Show"]


async def test_failed_refreshes_back_off_30_60_120_240_seconds(
    source: tuple[XmltvCache[Any], type[Exception]], upstream: _Upstream, clock: _Clock
) -> None:
    cache, _ = source
    await cache.ensure_fresh()
    _expire(cache)
    attempts: list[int] = []

    def down(request: httpx.Request) -> httpx.Response:
        attempts.append(int(clock.offset.total_seconds()))
        raise httpx.ConnectError("refused")

    upstream.handler = down
    for second in range(600):  # one read a second for ten minutes
        clock.offset = timedelta(seconds=second)
        assert _titles(await cache.programmes("ch1")) == ["Show"]
        await _settle(cache)

    assert attempts == [0, 30, 90, 210, 450]


async def test_cold_failure_answers_fast_until_the_backoff_ends(
    source: tuple[XmltvCache[Any], type[Exception]], upstream: _Upstream, clock: _Clock
) -> None:
    cache, unavailable = source

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    upstream.handler = down
    for _ in range(3):
        with pytest.raises(unavailable):
            await cache.programmes("ch1")
    assert upstream.requests == 1

    clock.offset = timedelta(seconds=30)
    with pytest.raises(unavailable):
        await cache.programmes("ch1")
    assert upstream.requests == 2


async def test_first_failure_of_an_outage_is_an_error_and_repeats_are_debug(
    source: tuple[XmltvCache[Any], type[Exception]], upstream: _Upstream, clock: _Clock
) -> None:
    cache, _ = source
    await cache.ensure_fresh()

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    upstream.handler = down
    output = StringIO()
    sink = logger.add(output, level="DEBUG", format="{level}|{message}")
    try:
        for _ in range(3):
            clock.offset += timedelta(days=1)  # past the TTL and any backoff
            await cache.programmes("ch1")
            await _settle(cache)
    finally:
        logger.remove(sink)

    failures = [line for line in output.getvalue().splitlines() if "Failed to refresh" in line]
    assert [line.split("|", 1)[0] for line in failures] == ["ERROR", "DEBUG", "DEBUG"]
    assert "serving stale data, next retry in 30s" in failures[0]


async def test_health_reports_a_stale_guide_and_the_next_retry(
    source: tuple[XmltvCache[Any], type[Exception]], upstream: _Upstream, clock: _Clock
) -> None:
    cache, _ = source
    health = cache.get_health()
    assert not health.online
    assert health.programme_count == 0

    await cache.ensure_fresh()
    health = cache.get_health()
    assert health.online and not health.stale
    assert (health.channel_count, health.programme_count) == (1, 1)
    assert health.last_success_at is not None
    assert health.error is None and health.next_retry_at is None

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    upstream.handler = down
    clock.offset = cache._cache_ttl + timedelta(seconds=1)
    health = await cache.ensure_fresh()
    assert health.online and health.stale
    assert health.error == "connection failed"
    assert health.next_retry_at is not None

    upstream.handler = lambda request: httpx.Response(200, text=_xmltv("Show"))
    clock.offset += timedelta(seconds=30)
    health = await cache.ensure_fresh()
    assert not health.stale and health.error is None and health.next_retry_at is None


def _raise(error: Exception) -> Handler:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error

    return handler


@pytest.mark.parametrize(
    ("handler", "reason"),
    [
        (lambda request: httpx.Response(403), "HTTP 403"),
        (_raise(httpx.ConnectError("refused")), "connection failed"),
        (_raise(httpx.ReadTimeout("slow")), "timeout"),
        (_raise(httpx.RemoteProtocolError("reset")), "request failed"),
        (lambda request: httpx.Response(200, text="<tv><broken"), "invalid XMLTV"),
        (lambda request: httpx.Response(200, content=b"<tv>" + b" " * 8192), "feed too large"),
    ],
)
async def test_failures_report_one_short_reason(
    source: tuple[XmltvCache[Any], type[Exception]],
    upstream: _Upstream,
    monkeypatch: pytest.MonkeyPatch,
    handler: Handler,
    reason: str,
) -> None:
    cache, _ = source
    monkeypatch.setattr(epg_service, "FEED_BYTES", 4 * 1024)
    monkeypatch.setattr(xmltv_parser, "FEED_BYTES", 4 * 1024)
    upstream.handler = handler

    health = await cache.ensure_fresh()

    assert health.online is False
    assert health.error == reason
    dumped = health.model_dump_json()
    assert "dispatcharr.test" not in dumped and "192.168." not in dumped


async def test_ttl_is_measured_in_aware_time(
    source: tuple[XmltvCache[Any], type[Exception]], upstream: _Upstream, clock: _Clock
) -> None:
    """The fake clock refuses naive now(); moving it is all that expires the guide."""
    cache, _ = source
    await cache.ensure_fresh()
    assert cache._cache_expires is not None
    assert cache._cache_expires.utcoffset() == timedelta(0)

    clock.offset = cache._cache_ttl - timedelta(seconds=1)
    assert cache._is_cache_valid()
    clock.offset = cache._cache_ttl + timedelta(seconds=1)
    assert not cache._is_cache_valid()


def test_the_ersatztv_guide_keeps_five_minutes() -> None:
    assert xmltv_parser.guide._cache_ttl == timedelta(minutes=5)


type Unset = tuple[XmltvCache[Any], type[Exception], Callable[[], None]]


@pytest.fixture(params=["dispatcharr", "ersatztv"])
def unset(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> Unset:
    """A guide cache following the settings, its source with no address, and a way to set one."""
    if request.param == "dispatcharr":
        monkeypatch.setattr(settings, "dispatcharr_url", "")
        return (
            EPGService(),
            EPGServiceError,
            lambda: monkeypatch.setattr(settings, "dispatcharr_url", "http://dispatcharr.test"),
        )
    monkeypatch.setattr(settings, "ersatztv_base_url", "")
    return (
        xmltv_parser.guide,
        FeedUnavailableError,
        lambda: monkeypatch.setattr(settings, "ersatztv_base_url", "http://ersatztv.test"),
    )


async def test_a_source_with_no_address_is_not_fetched(unset: Unset, upstream: _Upstream) -> None:
    """Nothing to fetch is no failure: nothing is tried, logged or backed off from."""
    cache, unavailable, _ = unset
    output = StringIO()
    sink = logger.add(output, level="DEBUG", format="{level}|{message}")
    try:
        await cache.ensure_fresh()
        await cache.check_health()
        await _settle(cache)
        for _ in range(3):
            with pytest.raises(unavailable):
                await cache.programmes("ch1")
    finally:
        logger.remove(sink)

    health = cache.get_health()
    assert health.last_attempt_at is None
    assert health.next_retry_at is None
    assert health.error == "not set up"
    assert "Failed to refresh" not in output.getvalue()


async def test_a_source_given_an_address_is_fetched_at_once(
    unset: Unset, upstream: _Upstream
) -> None:
    cache, unavailable, give_address = unset
    with pytest.raises(unavailable):
        await cache.programmes("ch1")

    give_address()

    assert _titles(await cache.programmes("ch1")) == ["Show"]
    assert cache.get_health().error is None
