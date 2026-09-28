"""The shared catalogue lookup and its cache-only peek (media_source)."""

import asyncio
from datetime import datetime, timedelta
from time import monotonic

import httpx
import pytest

from app.models.channel import Channel, GroupedChannelsResponse
from app.models.ersatztv import EPGChannel
from app.services import dispatcharr, media_source
from app.services.ersatztv import m3u_parser
from app.services.media_source import CatalogueMatch, peek_catalogue_channel

TSN = Channel(id="42", name="TSN 5", streamUrl="http://streams/42", guideId="tsn5")
CARTOONS = EPGChannel(id="etv-2", name="Cartoons", streamUrl="http://etv/2.m3u8")


def _grouped(fresh: bool = True) -> None:
    cache = dispatcharr._grouped_cache
    cache._value = GroupedChannelsResponse(ungrouped=[TSN])
    cache._has_value = True
    cache._fresh_until = monotonic() + (300 if fresh else -1)


def _m3u(fresh: bool = True) -> None:
    fetched = datetime.now() - timedelta(seconds=0 if fresh else 2 * m3u_parser.CACHE_TTL_SECONDS)
    m3u_parser._cache["channels"] = [CARTOONS]
    m3u_parser._cache["timestamp"] = fetched
    m3u_parser._cache["last_successful_fetch"] = fetched


@pytest.fixture(autouse=True)
def no_upstream(monkeypatch: pytest.MonkeyPatch) -> None:
    """Any upstream request fails the test."""

    def fail(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"the peek contacted an upstream: {request.url}")

    factory = httpx.AsyncClient
    monkeypatch.setattr(
        dispatcharr.httpx,
        "AsyncClient",
        lambda **kwargs: factory(transport=httpx.MockTransport(fail), **kwargs),
    )

    def no_feed(url: str) -> httpx.Response:
        pytest.fail(f"the peek fetched a feed: {url}")

    monkeypatch.setattr(m3u_parser, "fetch_feed", no_feed)


async def test_peek_never_fetches_or_schedules_even_when_expired() -> None:
    _grouped(fresh=False)
    _m3u(fresh=False)

    assert peek_catalogue_channel("42") == CatalogueMatch(TSN, complete=True)
    assert peek_catalogue_channel("etv-2").ersatztv
    assert peek_catalogue_channel("nope") == CatalogueMatch(None, complete=True)
    await asyncio.sleep(0)

    assert dispatcharr._grouped_cache._task is None


def test_peek_finds_an_ersatztv_channel_as_resolve_builds_it() -> None:
    _grouped()
    _m3u()

    match = peek_catalogue_channel("etv-2")

    assert match == CatalogueMatch(
        Channel(id="etv-2", name="Cartoons", streamUrl="http://etv/2.m3u8", guideId="etv-2"),
        complete=True,
        ersatztv=True,
    )


@pytest.mark.parametrize("loaded", ["neither", "dispatcharr only", "ersatztv only"])
def test_peek_is_incomplete_while_a_catalogue_never_loaded(loaded: str) -> None:
    if loaded == "dispatcharr only":
        _grouped()
    if loaded == "ersatztv only":
        _m3u()

    assert peek_catalogue_channel("nope") == CatalogueMatch(None, complete=False)


def test_peek_finds_a_dispatcharr_channel_before_ersatztv_loads() -> None:
    _grouped()

    assert peek_catalogue_channel("42") == CatalogueMatch(TSN, complete=True)


async def test_lookup_without_ersatztv_never_asks_it(monkeypatch: pytest.MonkeyPatch) -> None:
    """The suggestion lookup: the grouped catalogue only."""
    _grouped()

    async def lookup(*args: object) -> None:
        pytest.fail("ErsatzTV was asked")

    monkeypatch.setattr(media_source, "run_feed_lookup", lookup)

    match = await media_source.find_catalogue_channel("etv-2", ersatztv=False)

    assert match == CatalogueMatch(None, complete=True)
