"""Regression tests for media authority and filesystem boundaries."""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.models.auth import TokenPayload
from app.models.channel import SetChannelRequest
from app.routers.auth_deps import get_current_user
from app.routers.highlight import router
from app.services.highlight import ChannelRecorder, remove_recording_directory


@pytest.mark.parametrize("identifier", ["", " ", ".", "..", "/tmp/victim", "a/../b", "a\\b"])
def test_channel_json_rejects_paths(identifier):
    with pytest.raises(ValueError):
        SetChannelRequest(id=identifier, name="test", streamUrl="http://unused", guideId="test")


@pytest.mark.parametrize("identifier", ["%2e", "%2e%2e", "%20"])
def test_actual_status_route_rejects_paths(identifier):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(
        sub="test", role="viewer", exp=datetime(2099, 1, 1, tzinfo=UTC)
    )
    with TestClient(app) as client, patch("subprocess.Popen") as spawn:
        assert client.get(f"/api/highlight/status/{identifier}").status_code == 422
        spawn.assert_not_called()


@pytest.mark.asyncio
async def test_malicious_recorder_cleanup_preserves_sibling(tmp_path, monkeypatch):
    root = tmp_path / "recordings"
    root.mkdir()
    sentinel = tmp_path / "sentinel"
    sentinel.write_text("keep")
    monkeypatch.setattr(settings, "highlight_temp_dir", str(root))
    for directory in [root, root / "..", tmp_path]:
        recorder = ChannelRecorder("safe", "http://unused")
        recorder.segment_dir = directory
        await recorder.stop()
        assert sentinel.read_text() == "keep"
    link = root / "link"
    link.symlink_to(tmp_path, target_is_directory=True)
    remove_recording_directory(link)
    assert sentinel.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("startup", ["success", "dead", "cancel", "missing"])
async def test_startup_lifecycle_uses_opaque_directory_and_cleans(tmp_path, monkeypatch, startup):
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    recorder = ChannelRecorder("normal-id", "http://unused")
    process = MagicMock()
    process.poll.return_value = 0 if startup == "dead" else None
    sleep = AsyncMock(side_effect=asyncio.CancelledError if startup == "cancel" else None)
    with (
        patch(
            "subprocess.Popen",
            side_effect=FileNotFoundError if startup == "missing" else None,
            return_value=process,
        ),
        patch("asyncio.sleep", sleep),
        patch("os.killpg"),
        patch("os.getpgid"),
    ):
        if startup == "cancel":
            with pytest.raises(asyncio.CancelledError):
                await recorder.start()
        else:
            assert await recorder.start() is (startup == "success")
        if startup == "success":
            assert recorder.segment_dir is not None
            assert recorder.segment_dir.name.startswith("recorder-")
            process.poll.return_value = 1
            await recorder.stop()
    assert not list(tmp_path.iterdir())


@pytest.mark.asyncio
@pytest.mark.parametrize("identifier", ["", " ", "unknown"])
async def test_unresolved_source_never_spawns(identifier, monkeypatch):
    from fastapi import HTTPException

    from app.services.highlight import HighlightService

    monkeypatch.setattr(settings, "highlight_enabled", True)
    with (
        patch("app.services.media_source.get_channel_by_id", return_value=None),
        patch("app.services.media_source.get_lineup", AsyncMock(return_value=[])),
        patch("subprocess.Popen") as spawn,
    ):
        with pytest.raises(HTTPException):
            await HighlightService().start_recording(
                identifier, "http://off-catalog.invalid/private"
            )
        spawn.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["dispatcharr", "ersatz"])
async def test_resolved_source_replaces_client_url(provider, monkeypatch):
    from app.models.channel import Channel
    from app.services.highlight import HighlightService

    channel = Channel(
        id="valid", name="catalog", streamUrl="http://catalog.invalid/source", guideId="v"
    )
    monkeypatch.setattr(settings, "highlight_enabled", True)
    with (
        patch(
            "app.services.media_source.get_channel_by_id",
            return_value=channel if provider == "ersatz" else None,
        ),
        patch("app.services.media_source.get_lineup", AsyncMock(return_value=[channel])),
        patch.object(ChannelRecorder, "start", AsyncMock(return_value=True)),
    ):
        service = HighlightService()
        assert await service.start_recording("valid", "http://off-catalog.invalid/private")
        assert service._recorders["valid"].stream_url == channel.stream_url
        await service.stop_all()
