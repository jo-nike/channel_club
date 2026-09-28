"""Tests for the capture preview link: GET /api/highlight/preview/{token}."""

import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.auth import create_access_token
from app.services.highlight import (
    CAPTURE_TTL_SECONDS,
    MAX_CAPTURES_PER_OWNER,
    Capture,
    ChannelRecorder,
    highlight_service,
)

CAPTURE_BYTES = b"0123456789abcdefghijklmnopqrstuvwxyz"


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def auth_header() -> dict[str, str]:
    token = create_access_token({"sub": "testuser", "role": "viewer"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def empty_store(tmp_path, monkeypatch):
    """Captures and their preview tokens live in the global store; start and end empty."""
    monkeypatch.setattr("app.services.highlight.settings.highlight_temp_dir", str(tmp_path))
    yield
    highlight_service.captures.captures.clear()
    highlight_service.captures.preview_tokens.clear()


def register(tmp_path: Path, capture_id: str, content: bytes = CAPTURE_BYTES) -> Capture:
    directory = tmp_path / "captures" / capture_id
    directory.mkdir(parents=True)
    path = directory / "snapshot.mp4"
    path.write_bytes(content)
    now = time.time()
    item = Capture(capture_id, "testuser", "channel-1", path, len(content), 12.5, now, now, now)
    highlight_service.captures.captures[capture_id] = item
    return item


def preview_url(client: TestClient, auth_header: dict[str, str], capture: Capture) -> str:
    with patch("app.routers.highlight.settings") as mock_settings:
        mock_settings.highlight_enabled = True
        with patch.object(
            highlight_service, "create_capture", AsyncMock(return_value=(capture, None))
        ):
            response = client.post("/api/highlight/channel-1/capture", headers=auth_header)
    assert response.status_code == 200
    return response.json()["previewUrl"]


def test_preview_url_carries_no_session_token_and_serves_ranges_anonymously(
    client: TestClient, auth_header: dict[str, str], tmp_path: Path
) -> None:
    capture = register(tmp_path, "synthetic-capture-0001")
    url = preview_url(client, auth_header, capture)
    assert url.startswith("/api/highlight/preview/")
    assert "eyJ" not in url and "." not in url and "?" not in url

    response = client.get(url)
    assert response.status_code == 200
    assert response.content == CAPTURE_BYTES
    assert response.headers["content-type"] == "video/mp4"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["cache-control"] == "private, no-store"
    assert "content-disposition" not in response.headers
    first = client.get(url, headers={"Range": "bytes=0-15"})
    assert first.status_code == 206
    assert first.content == CAPTURE_BYTES[:16]
    later = client.get(url, headers={"Range": "bytes=16-"})
    assert later.status_code == 206
    assert later.content == CAPTURE_BYTES[16:]


def test_a_repeat_issue_returns_the_same_token(
    client: TestClient, auth_header: dict[str, str], tmp_path: Path
) -> None:
    capture = register(tmp_path, "synthetic-capture-0001")
    url = preview_url(client, auth_header, capture)
    assert preview_url(client, auth_header, capture) == url
    token = url.removeprefix("/api/highlight/preview/")
    assert highlight_service.issue_preview_token(capture.id, "testuser") == token
    assert highlight_service.issue_preview_token(capture.id, "other") is None
    assert len(highlight_service.captures.preview_tokens) == 1


def test_one_capture_token_never_serves_another(
    client: TestClient, auth_header: dict[str, str], tmp_path: Path
) -> None:
    first = register(tmp_path, "synthetic-capture-000a", b"first capture")
    second = register(tmp_path, "synthetic-capture-000b", b"second capture")
    first_url = preview_url(client, auth_header, first)
    second_url = preview_url(client, auth_header, second)
    assert first_url != second_url
    assert client.get(first_url).content == b"first capture"
    assert client.get(second_url).content == b"second capture"


def test_deleting_the_capture_ends_its_preview(
    client: TestClient, auth_header: dict[str, str], tmp_path: Path
) -> None:
    capture = register(tmp_path, "synthetic-capture-0001")
    url = preview_url(client, auth_header, capture)
    assert (
        client.delete(f"/api/highlight/capture/{capture.id}", headers=auth_header).status_code
        == 204
    )
    assert highlight_service.captures.preview_tokens == {}
    response = client.get(url)
    assert response.status_code == 404
    assert response.json()["detail"] == "Capture not found"


def test_the_preview_ends_with_the_capture_ttl(
    client: TestClient,
    auth_header: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    capture = register(tmp_path, "synthetic-capture-0001")
    url = preview_url(client, auth_header, capture)
    assert client.get(url).status_code == 200
    issued = time.monotonic()
    monkeypatch.setattr(
        "app.services.highlight.monotonic", lambda: issued + CAPTURE_TTL_SECONDS + 1
    )
    assert client.get(url).status_code == 404


async def test_the_preview_ends_when_the_owner_clips_past_the_limit(
    client: TestClient, auth_header: dict[str, str]
) -> None:
    class WritingRecorder(ChannelRecorder):
        async def capture(self, output: Path) -> float:
            output.write_bytes(CAPTURE_BYTES)
            return 0.0

    recorder = WritingRecorder("synthetic", "http://fixture")
    with patch("app.services.highlight.media_duration", AsyncMock(return_value=5.0)):
        oldest = await highlight_service.captures.create(recorder, "testuser", "channel-1", 0.0)
        url = preview_url(client, auth_header, oldest)
        assert client.get(url).status_code == 200
        for _ in range(MAX_CAPTURES_PER_OWNER):
            await highlight_service.captures.create(recorder, "testuser", "channel-1", 0.0)
    assert highlight_service.get_capture(oldest.id, "testuser") is None
    assert client.get(url).status_code == 404


def test_unknown_and_malformed_tokens(client: TestClient, tmp_path: Path) -> None:
    register(tmp_path, "synthetic-capture-0001")
    assert client.get("/api/highlight/preview/unknown-token-000000").status_code == 404
    assert client.get("/api/highlight/preview/not!a!token").status_code == 422


def test_the_legacy_query_token_preview_still_serves(
    client: TestClient, auth_header: dict[str, str], tmp_path: Path
) -> None:
    capture = register(tmp_path, "synthetic-capture-0001")
    token = auth_header["Authorization"].removeprefix("Bearer ")
    response = client.get(f"/api/highlight/capture/{capture.id}?token={token}")
    assert response.status_code == 200
    assert response.content == CAPTURE_BYTES
