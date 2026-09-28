"""Filesystem failures reach the viewer as a fixed message; the errno reaches the logs."""

import json
import time
from datetime import UTC, datetime
from io import StringIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from loguru import logger

from app.config import settings
from app.models.auth import TokenPayload
from app.routers.auth_deps import get_current_user
from app.routers.highlight import router
from app.services.highlight import Capture, highlight_service

DISK_FULL = OSError(28, "No space left on device", "/tmp/highlight-capture-abc/input_003.ts")


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "highlight_enabled", True)
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path / "highlights"))
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: TokenPayload(
        sub="viewer", role="viewer", exp=datetime(2099, 1, 1, tzinfo=UTC)
    )
    with TestClient(app) as client:
        yield client


def failures(records: list[dict]) -> list[dict]:
    return [r["extra"] for r in records if r["extra"].get("event") == "highlight.capture_failed"]


def test_a_full_disk_during_capture_names_no_server_path(client, monkeypatch):
    recorder = MagicMock()
    recorder.is_running = True
    recorder.wait_for_current_segment = AsyncMock(return_value=True)
    monkeypatch.setitem(highlight_service._recorders, "channel-1", recorder)
    with patch.object(highlight_service.captures, "create", AsyncMock(side_effect=DISK_FULL)):
        response = client.post("/api/highlight/channel-1/capture")
    assert response.status_code == 400
    assert response.json()["detail"] == "Could not save the clip on the server"
    assert "/tmp" not in response.text and "Errno" not in response.text


def test_capture_failure_log_carries_the_errno(client, monkeypatch):
    recorder = MagicMock()
    recorder.is_running = True
    recorder.wait_for_current_segment = AsyncMock(return_value=True)
    monkeypatch.setitem(highlight_service._recorders, "channel-1", recorder)
    output = StringIO()
    handler = logger.add(output, format="{message}", serialize=True, level="INFO")
    try:
        with patch.object(highlight_service.captures, "create", AsyncMock(side_effect=DISK_FULL)):
            client.post("/api/highlight/channel-1/capture")
    finally:
        logger.remove(handler)
    records = [json.loads(line)["record"] for line in output.getvalue().splitlines()]
    assert [(e["errno"], e["channel_id"]) for e in failures(records)] == [(28, "channel-1")]


def test_a_full_disk_during_export_names_no_server_path(client, tmp_path):
    snapshot = tmp_path / "snapshot.mp4"
    snapshot.write_bytes(b"mp4")
    now = time.time()
    capture = Capture(
        "synthetic-capture-0001", "viewer", "channel-1", snapshot, 3, 2, now, now, now
    )
    highlight_service.captures.captures[capture.id] = capture
    output = StringIO()
    handler = logger.add(output, format="{message}", serialize=True, level="INFO")
    try:
        with patch("app.routers.highlight.encode_file", AsyncMock(side_effect=DISK_FULL)):
            response = client.post(f"/api/highlight/export?capture={capture.id}")
    finally:
        logger.remove(handler)
        highlight_service.captures.captures.pop(capture.id, None)
    assert response.status_code == 400
    assert response.json()["detail"] == "Could not save the clip on the server"
    assert "/tmp" not in response.text
    records = [json.loads(line)["record"] for line in output.getvalue().splitlines()]
    assert [e["errno"] for e in failures(records)] == [28]


def test_authored_capture_errors_keep_their_text(client, monkeypatch):
    recorder = MagicMock()
    recorder.is_running = True
    recorder.wait_for_current_segment = AsyncMock(return_value=True)
    monkeypatch.setitem(highlight_service._recorders, "channel-1", recorder)
    authored = ValueError("No recent segments available")
    with patch.object(highlight_service.captures, "create", AsyncMock(side_effect=authored)):
        response = client.post("/api/highlight/channel-1/capture")
    assert response.status_code == 400
    assert response.json()["detail"] == "No recent segments available"
