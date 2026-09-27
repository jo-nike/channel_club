"""Immutable capture contract with real generated local media and HTTP requests."""

import asyncio
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.config import settings
from app.models.auth import TokenPayload
from app.routers import highlight as highlight_router
from app.routers.auth_deps import get_current_user
from app.routers.highlight import export_preview, router
from app.services.highlight import Capture, highlight_service
from app.services.media_limits import export_budget

CAPTURE_ID = "synthetic-capture-0001"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "highlight_enabled", True)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(
        sub="viewer", role="viewer", exp=datetime(2099, 1, 1, tzinfo=UTC)
    )
    with TestClient(app) as client:
        yield client
    assert not export_budget.owners


@pytest.fixture
def register():
    """Place a capture in the store for a test and drop it afterwards."""
    registered = []

    def add(path, owner="viewer", capture_id=CAPTURE_ID):
        now = time.time()
        capture = Capture(
            capture_id, owner, "channel-1", path, path.stat().st_size, 2, now, now, now
        )
        highlight_service.captures.captures[capture_id] = capture
        registered.append(capture_id)
        return capture_id

    yield add
    for capture_id in registered:
        highlight_service.captures.captures.pop(capture_id, None)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg required for real media regression")
@pytest.mark.parametrize(
    "format,start,end,expected",
    [("mp4", None, None, "red"), ("mp4", 1, 2, "green"), ("webm", 1, 2, "green")],
)
def test_export_uses_original_capture_frames_after_live_source_advances(
    client, tmp_path, register, format, start, end, expected
):
    live = tmp_path / "live.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=red:s=32x32:r=4:d=1",
            "-f",
            "lavfi",
            "-i",
            "color=green:s=32x32:r=4:d=1",
            "-filter_complex",
            "[0:v][1:v]concat=n=2:v=1:a=0",
            "-c:v",
            "libx264",
            "-g",
            "1",
            "-pix_fmt",
            "yuv420p",
            str(live),
        ],
        check=True,
        timeout=15,
    )
    snapshot = tmp_path / "snapshot.mp4"
    shutil.copyfile(live, snapshot)
    capture = register(snapshot)
    live.write_bytes(b"new live frames after the user spends time trimming")
    query = {"capture": capture, "format": format}
    if start is not None:
        query.update(start_time=start, end_time=end)
    response = client.post("/api/highlight/export", params=query)
    assert response.status_code == 200, response.text
    result = tmp_path / f"result.{format}"
    result.write_bytes(response.content)
    rgb = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(result),
            "-frames:v",
            "1",
            "-vf",
            "scale=1:1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=15,
    ).stdout
    red, green, blue = rgb
    assert (red > green + 40) if expected == "red" else (green > red + 40)
    assert blue < 30


def test_capture_lookup_and_validation_precede_encoder(client, tmp_path, register):
    snapshot = tmp_path / "snapshot.mp4"
    snapshot.write_bytes(b"mp4")
    foreign = register(snapshot, owner="someone-else", capture_id="foreign-capture-0001")
    with patch("app.routers.highlight.encode_file") as encode:
        assert client.post("/api/highlight/export").status_code == 422
        assert client.post("/api/highlight/export?capture=../etc").status_code == 422
        assert client.post("/api/highlight/export?capture=unknown-capture-0001").status_code == 404
        assert client.post(f"/api/highlight/export?capture={foreign}").status_code == 404
        assert (
            client.post(f"/api/highlight/export?capture={foreign}&start_time=nan").status_code
            == 422
        )
        assert (
            client.post(
                f"/api/highlight/export?capture={foreign}&start_time=2&end_time=1"
            ).status_code
            == 400
        )
        encode.assert_not_called()


class BrowserRequest(Request):
    """A request whose client is still waiting until `leave` is set."""

    def __init__(self, leave: asyncio.Event):
        super().__init__({"type": "http", "method": "POST", "headers": []})
        self.leave = leave

    async def is_disconnected(self) -> bool:
        return self.leave.is_set()


def viewer() -> TokenPayload:
    return TokenPayload(sub="viewer", role="viewer", exp=datetime(2099, 1, 1, tzinfo=UTC))


@pytest.fixture
def encoder(monkeypatch):
    """Stand in for FFmpeg with a harmless child that runs until it is killed."""
    monkeypatch.setattr(settings, "highlight_enabled", True)
    monkeypatch.setattr(highlight_router, "DISCONNECT_POLL_SECONDS", 0.01)
    real_popen = subprocess.Popen
    children: list[subprocess.Popen] = []

    def launch(_command, **kwargs):
        child = real_popen([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
        children.append(child)
        return child

    with patch("subprocess.Popen", launch):
        yield children
    for child in children:
        if child.poll() is None:
            child.kill()
            child.wait()


async def test_export_stops_the_encoder_when_the_browser_cancels(tmp_path, register, encoder):
    snapshot = tmp_path / "snapshot.mp4"
    snapshot.write_bytes(b"mp4")
    capture = register(snapshot)
    leave = asyncio.Event()
    export = asyncio.create_task(
        export_preview(
            BrowserRequest(leave),
            capture=capture,
            format="webm",
            start_time=None,
            end_time=None,
            user=viewer(),
        )
    )
    for _ in range(200):
        if encoder:
            break
        await asyncio.sleep(0.01)
    await asyncio.sleep(0.05)
    assert encoder[0].poll() is None and export_budget.owners["viewer"] == 1

    leave.set()
    with pytest.raises(HTTPException) as closed:
        await asyncio.wait_for(export, 5)
    assert closed.value.status_code == 499
    assert encoder[0].poll() is not None
    assert not export_budget.owners


async def test_export_returns_the_encode_while_the_browser_waits(tmp_path, register, monkeypatch):
    monkeypatch.setattr(settings, "highlight_enabled", True)
    monkeypatch.setattr(highlight_router, "DISCONNECT_POLL_SECONDS", 0.01)
    snapshot = tmp_path / "snapshot.mp4"
    snapshot.write_bytes(b"mp4")
    capture = register(snapshot)

    async def slow_encode(*_args: object) -> bytes:
        await asyncio.sleep(0.05)
        return b"encoded clip"

    with patch("app.routers.highlight.encode_file", slow_encode):
        response = await export_preview(
            BrowserRequest(asyncio.Event()),
            capture=capture,
            format="mp4",
            start_time=1,
            end_time=2,
            user=viewer(),
        )
    assert response.body == b"encoded clip"
    assert not export_budget.owners
