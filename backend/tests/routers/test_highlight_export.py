"""Immutable preview contract with real generated local media and HTTP requests."""

import shutil
import subprocess
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.models.auth import TokenPayload
from app.routers.auth_deps import get_current_user
from app.routers.highlight import router
from app.services.media_limits import export_budget


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


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg required for real media regression")
@pytest.mark.parametrize(
    "format,start,end,expected",
    [("mp4", None, None, "red"), ("mp4", 1, 2, "green"), ("webm", 1, 2, "green")],
)
def test_export_uses_original_preview_frames_after_live_source_advances(
    client, tmp_path, format, start, end, expected
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
    preview = live.read_bytes()
    live.write_bytes(b"new live frames after the user spends time trimming")
    query = {"format": format}
    if start is not None:
        query.update(start_time=start, end_time=end)
    response = client.post(
        "/api/highlight/export",
        params=query,
        content=preview,
        headers={"Content-Type": "video/mp4"},
    )
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


def test_preview_limits_and_auth_precede_encoder(client, monkeypatch):
    monkeypatch.setattr(settings, "media_export_max_bytes", 4)
    with patch("app.routers.highlight.encode_file") as encode:
        assert (
            client.post(
                "/api/highlight/export", content=b"12345", headers={"Content-Type": "video/mp4"}
            ).status_code
            == 413
        )
        assert (
            client.post(
                "/api/highlight/export", content=b"", headers={"Content-Type": "video/mp4"}
            ).status_code
            == 400
        )
        assert (
            client.post(
                "/api/highlight/export", content=b"123", headers={"Content-Type": "text/plain"}
            ).status_code
            == 415
        )
        assert (
            client.post(
                "/api/highlight/export?start_time=nan",
                content=b"123",
                headers={"Content-Type": "video/mp4"},
            ).status_code
            == 422
        )
        encode.assert_not_called()
