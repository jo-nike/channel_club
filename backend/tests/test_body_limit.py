"""M-01: request bodies over the cap get 413 before routing, auth or JSON parsing."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.requests import Request as StarletteRequest
from starlette.types import Message

from app.config import settings
from app.main import app
from app.middleware.body_limit import BodySizeLimitMiddleware

LIMIT = settings.request_body_max_bytes
TOO_LARGE = {"detail": "Request body too large"}


@pytest.fixture
def body_reads(monkeypatch):
    """Record every time the app reads a request body."""
    calls: list[int] = []
    original = StarletteRequest.body

    async def body(self: StarletteRequest) -> bytes:
        calls.append(1)
        return await original(self)

    monkeypatch.setattr(StarletteRequest, "body", body)
    return calls


def chunks(total: int, size: int = 16 * 1024) -> Iterator[bytes]:
    for _ in range(total // size):
        yield b" " * size


def test_default_cap_is_64_kib():
    assert LIMIT == 64 * 1024


def test_anonymous_20_mib_declared_body_is_413_not_401_and_never_parsed(body_reads):
    # The header alone decides; the lazy body is a few bytes, never 20 MiB in memory.
    response = TestClient(app).put(
        "/api/settings",
        content=iter([b"{}"]),
        headers={"Content-Length": str(20 * 1024 * 1024), "Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json() == TOO_LARGE
    assert body_reads == []


def test_chunked_body_over_the_cap_is_413_not_401():
    response = TestClient(app).put(
        "/api/settings",
        content=chunks(LIMIT * 4),
        headers={"Content-Type": "application/json"},
    )
    assert "content-length" not in response.request.headers
    assert response.status_code == 413
    assert response.json() == TOO_LARGE


def test_small_body_reaches_the_app(body_reads):
    response = TestClient(app).put("/api/settings", json={"theme": "dark"})
    assert response.status_code == 401
    assert body_reads


def test_highlight_upload_is_not_capped_by_the_middleware():
    response = TestClient(app).post(
        "/api/highlight/upload",
        content=b" " * (LIMIT * 4),
        headers={"Content-Type": "video/mp4"},
    )
    assert response.status_code == 401


async def run_streamed(path: str, total: int) -> tuple[list[Message], int, int]:
    """Drive the middleware with a lazily streamed body; return what it sent,
    how many chunks it pulled and how many bytes the inner app saw."""
    size = 16 * 1024
    pulled = 0
    seen = 0

    inner = FastAPI()

    @inner.post("/{path:path}")
    async def consume(request: Request) -> dict[str, int]:
        nonlocal seen
        async for chunk in request.stream():
            seen += len(chunk)
        return {"seen": seen}

    async def receive() -> Message:
        nonlocal pulled
        pulled += 1
        more = pulled * size < total
        return {"type": "http.request", "body": b" " * size, "more_body": more}

    sent: list[Message] = []

    async def send(message: Message) -> None:
        sent.append(message)

    middleware = BodySizeLimitMiddleware(
        inner, max_bytes=LIMIT, exempt_paths=frozenset({"/api/highlight/upload"})
    )
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": b"",
        "headers": [(b"transfer-encoding", b"chunked")],
        "server": ("testserver", 80),
        "client": ("testclient", 50000),
    }
    await middleware(scope, receive, send)
    return sent, pulled, seen


async def test_streamed_body_stops_at_the_cap():
    sent, pulled, seen = await run_streamed("/api/feedback", total=1024 * 1024)
    assert sent[0]["status"] == 413
    # One chunk past the cap is pulled to notice it; the rest of the megabyte is not.
    assert pulled == LIMIT // (16 * 1024) + 1
    assert seen <= LIMIT


async def test_exempt_path_streams_past_the_cap():
    sent, _, seen = await run_streamed("/api/highlight/upload", total=LIMIT * 4)
    assert sent[0]["status"] == 200
    assert seen == LIMIT * 4


async def test_streamed_body_under_the_cap_passes():
    sent, _, seen = await run_streamed("/api/feedback", total=LIMIT)
    assert sent[0]["status"] == 200
    assert seen == LIMIT
