"""GET /api/health/deps: coarse upstream readiness from local state only (H-03)."""

import asyncio
from datetime import UTC, datetime, timedelta
from time import monotonic

import httpx
import pytest

from app.config import settings
from app.main import app
from app.models.channel import GroupedChannelsResponse
from app.services import dispatcharr
from app.services.dispatcharr import DispatchrrUnavailableError, get_grouped_channels
from app.services.epg_service import get_epg_service
from app.services.http_clients import DISPATCHARR, ERSATZTV
from tests.http_helpers import mock_upstream


def _route_upstreams(monkeypatch: pytest.MonkeyPatch, respond) -> None:
    """Send the Dispatcharr and ErsatzTV clients through a MockTransport."""
    mock_upstream(DISPATCHARR, respond)
    mock_upstream(ERSATZTV, respond)


def _no_upstream_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"/api/health/deps contacted an upstream: {request.url}")

    _route_upstreams(monkeypatch, fail)


def _catalogue(fresh: bool = True) -> None:
    """Fill the grouped catalogue cache, fresh or expired, as if a fetch had succeeded."""
    cache = dispatcharr._grouped_cache
    cache._value = GroupedChannelsResponse()
    cache._has_value = True
    cache._fresh_until = monotonic() + (300 if fresh else -1)


# Captured at import, before a test routes httpx.AsyncClient to a fake upstream
_ASYNC_CLIENT = httpx.AsyncClient


async def _get_deps() -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with _ASYNC_CLIENT(transport=transport, base_url="http://test") as client:
        return await client.get("/api/health/deps")


async def test_failing_refreshes_report_failing_without_contacting_upstream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _route_upstreams(monkeypatch, lambda request: httpx.Response(403))
    assert (await get_epg_service().ensure_fresh()).error == "HTTP 403"
    with pytest.raises(DispatchrrUnavailableError):
        await get_grouped_channels()
    _no_upstream_calls(monkeypatch)

    response = await _get_deps()

    assert response.status_code == 200
    assert response.json() == {"epg": "failing", "epgLastSuccess": None, "dispatcharr": "failing"}


async def test_healthy_guide_and_catalogue_report_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    success = datetime(2026, 9, 28, 12, 0, tzinfo=UTC)
    guide = get_epg_service()
    guide._cache = {"synthetic": []}
    guide._cache_expires = datetime.now(UTC) + timedelta(hours=1)
    guide._last_success_at = success
    _catalogue()
    _no_upstream_calls(monkeypatch)

    response = await _get_deps()

    assert response.json() == {
        "epg": "ok",
        "epgLastSuccess": success.isoformat(),
        "dispatcharr": "ok",
    }


async def test_expired_guide_with_failing_refreshes_reports_stale(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guide = get_epg_service()
    guide._cache = {"synthetic": []}
    guide._cache_expires = datetime.now(UTC) - timedelta(seconds=1)
    guide._last_success_at = datetime.now(UTC) - timedelta(hours=2)
    guide._last_error = "HTTP 403"
    guide._retry_at = datetime.now(UTC) + timedelta(seconds=30)
    _catalogue()
    _no_upstream_calls(monkeypatch)

    response = await _get_deps()

    body = response.json()
    assert body["epg"] == "stale"
    assert "HTTP 403" not in response.text
    assert set(body) == {"epg", "epgLastSuccess", "dispatcharr"}


class _SlowGuide:
    """A guide upstream that answers after a delay and counts requests."""

    def __init__(self) -> None:
        self.requests = 0
        self.release = asyncio.Event()

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests += 1
        await self.release.wait()
        return httpx.Response(503)


async def test_an_expired_guide_starts_one_refresh_without_waiting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """On an idle app, deps polls are what notice a failing guide refresh."""
    upstream = _SlowGuide()
    _route_upstreams(monkeypatch, upstream)
    guide = get_epg_service()
    guide._cache = {"synthetic": []}
    guide._cache_expires = datetime.now(UTC) - timedelta(seconds=1)
    _catalogue()

    responses = await asyncio.wait_for(asyncio.gather(*(_get_deps() for _ in range(10))), 1.0)

    assert {response.json()["epg"] for response in responses} == {"stale"}
    assert upstream.requests == 1
    upstream.release.set()
    assert guide._refresh_task is not None
    await guide._refresh_task
    assert guide.get_health().error == "HTTP 503"


@pytest.mark.parametrize("state", ["fresh", "backing off"])
async def test_a_fresh_or_backing_off_guide_starts_no_refresh(
    monkeypatch: pytest.MonkeyPatch, state: str
) -> None:
    guide = get_epg_service()
    guide._cache = {"synthetic": []}
    if state == "fresh":
        guide._cache_expires = datetime.now(UTC) + timedelta(hours=1)
    else:
        guide._cache_expires = datetime.now(UTC) - timedelta(seconds=1)
        guide._retry_at = datetime.now(UTC) + timedelta(seconds=30)
    _catalogue()
    _no_upstream_calls(monkeypatch)

    await asyncio.gather(*(_get_deps() for _ in range(10)))

    assert guide._refresh_task is None


def _fresh_guide() -> None:
    guide = get_epg_service()
    guide._cache = {"synthetic": []}
    guide._cache_expires = datetime.now(UTC) + timedelta(hours=1)


class _SlowCatalogue:
    """A Dispatcharr that answers after a delay and counts catalogue fetches."""

    def __init__(self, status: int = 200) -> None:
        self.fetches = 0
        self.status = status
        self.release = asyncio.Event()

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/channels/channels/":
            self.fetches += 1
        await self.release.wait()
        return httpx.Response(self.status, json=[])


async def test_an_expired_catalogue_starts_one_refresh_without_waiting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """On an idle app, deps polls are what notice a Dispatcharr outage."""
    monkeypatch.setattr(settings, "dispatcharr_api_key", "test-key")
    upstream = _SlowCatalogue()
    _route_upstreams(monkeypatch, upstream)
    _fresh_guide()
    _catalogue(fresh=False)

    responses = await asyncio.wait_for(asyncio.gather(*(_get_deps() for _ in range(10))), 1.0)

    assert {response.json()["dispatcharr"] for response in responses} == {"ok"}
    await asyncio.sleep(0)
    assert upstream.fetches == 1
    upstream.release.set()
    task = dispatcharr._grouped_cache._task
    assert task is not None
    await task
    assert dispatcharr._grouped_cache._fresh_until > monotonic()


@pytest.mark.parametrize("state", ["fresh", "refreshing", "recently failed"])
async def test_a_fresh_busy_or_failed_catalogue_starts_no_refresh(
    monkeypatch: pytest.MonkeyPatch, state: str
) -> None:
    _fresh_guide()
    cache = dispatcharr._grouped_cache
    _catalogue(fresh=state == "fresh")
    if state == "recently failed":
        cache._retry_after = monotonic() + 30
        cache._last_error = "HTTP 503"
    _no_upstream_calls(monkeypatch)

    if state == "refreshing":
        async with cache._lock:  # a foreground fetch holds the lock
            await asyncio.gather(*(_get_deps() for _ in range(10)))
    else:
        await asyncio.gather(*(_get_deps() for _ in range(10)))

    assert cache._task is None


async def test_a_failed_background_catalogue_refresh_reports_failing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "dispatcharr_api_key", "test-key")
    upstream = _SlowCatalogue(status=503)
    upstream.release.set()
    _route_upstreams(monkeypatch, upstream)
    _fresh_guide()
    _catalogue(fresh=False)

    assert (await _get_deps()).json()["dispatcharr"] == "ok"
    task = dispatcharr._grouped_cache._task
    assert task is not None
    await task

    assert (await _get_deps()).json()["dispatcharr"] == "failing"
    assert upstream.fetches == 1


def test_health_stays_static() -> None:
    """The Docker healthcheck's endpoint does not grow upstream state."""
    from fastapi.testclient import TestClient

    body = TestClient(app).get("/api/health").json()

    assert set(body) == {"status", "version", "buildId", "revision"}
