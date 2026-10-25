"""Captures and media slots belong to an account, not a username a Plex account can share."""

import asyncio
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI

from app.config import settings
from app.routers import highlight as highlight_router
from app.routers.highlight import router
from app.services.auth import create_access_token
from app.services.highlight import Capture, highlight_service
from app.services.media_limits import export_budget, upload_budget

# The shared local viewer login and a Plex account whose username is also "viewer"
CLAIMS = {"local": {}, "plex": {"plex_id": "1"}}
KEYS = {"local": "local:viewer", "plex": "plex:1"}
LOCAL, PLEX = "local", "plex"


@pytest.fixture
async def client(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "highlight_enabled", True)
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path))
    monkeypatch.setattr(settings, "media_export_limit", 2)
    monkeypatch.setattr(settings, "media_export_per_user", 1)
    monkeypatch.setattr(settings, "media_upload_limit", 2)
    monkeypatch.setattr(settings, "media_upload_per_user", 1)
    monkeypatch.setattr(highlight_router, "DISCONNECT_POLL_SECONDS", 0.01)
    app = FastAPI()
    app.include_router(router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app), base_url="http://test"
    ) as client:
        yield client
    highlight_service.captures.captures.clear()
    highlight_service.captures.download_tokens.clear()
    highlight_service.captures.preview_tokens.clear()
    assert not export_budget.owners and not upload_budget.owners


def token(account: str) -> str:
    return create_access_token({"sub": "viewer", "role": "viewer", **CLAIMS[account]})


def auth(account: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token(account)}"}


def register(tmp_path: Path, owner: str, capture_id: str) -> str:
    path = tmp_path / capture_id / "snapshot.mp4"
    path.parent.mkdir()
    path.write_bytes(b"mp4")
    now = time.time()
    highlight_service.captures.captures[capture_id] = Capture(
        capture_id, owner, "channel-1", path, 3, 2, now, now, now
    )
    return capture_id


async def encoded(_source: Path, output: Path, *_args: object) -> Path:
    output.write_bytes(b"encoded clip")
    return output


@pytest.mark.parametrize("owner,intruder", [(LOCAL, PLEX), (PLEX, LOCAL)])
async def test_a_capture_is_only_its_accounts(client, tmp_path, owner, intruder):
    capture = register(tmp_path, KEYS[owner], "synthetic-capture-0001")
    with patch("app.routers.highlight.encode_file", encoded):
        for account, status in [(intruder, 404), (owner, 200)]:
            path = f"/api/highlight/capture/{capture}"
            assert (await client.get(path, headers=auth(account))).status_code == status
            link = await client.post(f"{path}/download-token", headers=auth(account))
            assert link.status_code == status
            export = await client.post(
                f"/api/highlight/export?capture={capture}", headers=auth(account)
            )
            assert export.status_code == status
            preview = highlight_service.issue_preview_token(capture, KEYS[account])
            assert (preview is not None) == (status == 200)


async def test_local_and_plex_viewers_hold_separate_export_slots(client, tmp_path):
    register(tmp_path, "local:viewer", "synthetic-capture-0001")
    register(tmp_path, "plex:1", "synthetic-capture-0002")
    started, release = asyncio.Event(), asyncio.Event()

    async def encode(source: Path, output: Path, *args: object) -> Path:
        if source.parent.name == "synthetic-capture-0001":
            started.set()
            await release.wait()
        return await encoded(source, output, *args)

    with patch("app.routers.highlight.encode_file", encode):
        local = asyncio.create_task(
            client.post("/api/highlight/export?capture=synthetic-capture-0001", headers=auth(LOCAL))
        )
        await asyncio.wait_for(started.wait(), 5)
        assert export_budget.owners == {"local:viewer": 1}
        plex = await asyncio.wait_for(
            client.post("/api/highlight/export?capture=synthetic-capture-0002", headers=auth(PLEX)),
            5,
        )
        assert plex.status_code == 200
        release.set()
        assert (await local).status_code == 200


async def test_local_and_plex_viewers_hold_separate_upload_slots(client, monkeypatch):
    monkeypatch.setattr(settings, "zipline_enabled", True)
    monkeypatch.setattr(settings, "zipline_url", "https://zipline.test")
    monkeypatch.setattr(settings, "zipline_token", "synthetic-secret")
    started, release = asyncio.Event(), asyncio.Event()
    uploaded = {"url": "https://cdn.test/c.mp4", "name": "c.mp4"}

    async def upload(*_args):
        if not started.is_set():
            started.set()
            await release.wait()
        return uploaded

    def post(account: str):
        return client.post(
            "/api/highlight/upload",
            content=b"preview",
            headers={**auth(account), "Content-Type": "video/mp4"},
        )

    with (
        patch("app.routers.highlight.upload_clip", upload),
        patch("app.routers.highlight.media_duration", new_callable=AsyncMock, return_value=2),
    ):
        local = asyncio.create_task(post(LOCAL))
        await asyncio.wait_for(started.wait(), 5)
        assert upload_budget.owners == {"local:viewer": 1}
        plex = await asyncio.wait_for(post(PLEX), 5)
        assert plex.status_code == 200
        release.set()
        assert (await local).status_code == 200
