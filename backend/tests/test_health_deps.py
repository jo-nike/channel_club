"""GET /api/health/deps: coarse upstream readiness from local state only (H-03)."""

import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.main import app
from app.services.dispatcharr import DispatchrrUnavailableError, get_grouped_channels
from app.services.epg_service import get_epg_service


def _route_upstreams(monkeypatch: pytest.MonkeyPatch, respond) -> None:
    """Send every httpx client the services open through a MockTransport."""
    factory = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: factory(transport=httpx.MockTransport(respond), **kwargs),
    )


def _no_upstream_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"/api/health/deps contacted an upstream: {request.url}")

    _route_upstreams(monkeypatch, fail)


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
    _no_upstream_calls(monkeypatch)

    await asyncio.gather(*(_get_deps() for _ in range(10)))

    assert guide._refresh_task is None


def test_health_stays_static() -> None:
    """The Docker healthcheck's endpoint does not grow upstream state."""
    from fastapi.testclient import TestClient

    body = TestClient(app).get("/api/health").json()

    assert set(body) == {"status", "version", "buildId", "revision"}
