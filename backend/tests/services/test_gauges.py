"""The gauges log line: process-local resource counts as one JSON event (J-01)."""

import asyncio
import json
import os
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from loguru import logger

from app.services import channel_state, gauges, presence
from app.services.cast import cast_service
from app.services.highlight import highlight_service
from app.services.media_limits import export_budget, process_budget, recorder_budget, upload_budget

GAUGE_KEYS = {
    "ws_connections",
    "presence_entries",
    "recorders_running",
    "recorders_idle",
    "cast_sessions",
    "captures",
    "capture_bytes",
    "download_tokens",
    "budget_process",
    "budget_export",
    "budget_recorder",
}


@pytest.fixture
def known_registries(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fill every registry the gauges read with a known, owner-labelled state."""
    monkeypatch.setattr(channel_state, "_active_connections", {object(), object(), object()})
    monkeypatch.setattr(presence, "_active_users", {"c1": object(), "c2": object()})
    monkeypatch.setattr(
        highlight_service,
        "_recorders",
        {
            "ch1": SimpleNamespace(is_running=True),
            "ch2": SimpleNamespace(is_running=True),
            "ch3": SimpleNamespace(is_running=False),
        },
    )
    monkeypatch.setattr(cast_service, "_sessions", {"s1": object()})
    monkeypatch.setattr(
        highlight_service.captures,
        "captures",
        {"cap1": SimpleNamespace(size=1000), "cap2": SimpleNamespace(size=2500)},
    )
    monkeypatch.setattr(
        highlight_service.captures, "download_tokens", {"t1": object(), "t2": object()}
    )
    process_budget.owners.update({"synthetic-alice": 2, "synthetic-bob": 1})
    export_budget.owners.update({"synthetic-alice": 1})
    recorder_budget.owners.update({"system": 2})
    upload_budget.owners.update({"synthetic-bob": 1})


@pytest.mark.usefixtures("known_registries")
def test_one_tick_logs_one_json_line_with_the_counts() -> None:
    output = StringIO()
    handler = logger.add(output, format="{message}", serialize=True, level="INFO")
    try:
        gauges.log_gauges()
    finally:
        logger.remove(handler)

    lines = output.getvalue().splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])["record"]
    assert record["level"]["name"] == "INFO"
    extra = record["extra"]
    assert extra["event"] == "gauges"
    assert {key: extra[key] for key in GAUGE_KEYS} == {
        "ws_connections": 3,
        "presence_entries": 2,
        "recorders_running": 2,
        "recorders_idle": 1,
        "cast_sessions": 1,
        "captures": 2,
        "capture_bytes": 3500,
        "download_tokens": 2,
        "budget_process": 3,
        "budget_export": 1,
        "budget_recorder": 2,
    }
    if Path("/proc/self/fd").exists():
        assert isinstance(extra["open_fds"], int) and extra["open_fds"] > 0
        assert extra["ffmpeg_children"] == 0
    assert set(extra) <= GAUGE_KEYS | {"event", "service", "open_fds", "ffmpeg_children"}
    assert "synthetic-" not in lines[0]


def _fake_proc(root: Path, processes: dict[int, str]) -> None:
    """A /proc with self/fd and one stat file per pid, given as 'pid (comm) S ppid ...'."""
    (root / "self" / "fd").mkdir(parents=True)
    for fd in range(4):
        (root / "self" / "fd" / str(fd)).touch()
    for pid, stat in processes.items():
        (root / str(pid)).mkdir()
        (root / str(pid) / "stat").write_text(stat)


def test_counts_only_ffmpeg_children_of_this_process(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    me = os.getpid()
    _fake_proc(
        tmp_path,
        {
            101: f"101 (ffmpeg) S {me} 1 1 0",
            102: f"102 (ffmpeg) S {me} 1 1 0",
            103: "103 (ffmpeg) S 1 1 1 0",  # Someone else's
            104: f"104 (ffprobe) S {me} 1 1 0",
            105: f"105 (odd (name)) S {me} 1 1 0",
        },
    )
    monkeypatch.setattr(gauges, "_PROC", tmp_path)

    collected = gauges.collect_gauges()

    assert collected["ffmpeg_children"] == 2
    assert collected["open_fds"] == 4


def test_skips_proc_gauges_where_proc_does_not_exist(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(gauges, "_PROC", tmp_path / "missing")

    collected = gauges.collect_gauges()

    assert "open_fds" not in collected
    assert "ffmpeg_children" not in collected
    assert set(collected) == GAUGE_KEYS


async def test_loop_logs_every_interval_and_stops(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gauges, "GAUGES_INTERVAL_SECONDS", 0.01)
    ticks = asyncio.Event()
    monkeypatch.setattr(gauges, "log_gauges", ticks.set)

    gauges.start_gauges_task()
    task = gauges._task
    await asyncio.wait_for(ticks.wait(), timeout=1)
    await gauges.stop_gauges_task()

    assert task is not None and task.cancelled()
    assert gauges._task is None


def test_app_lifespan_starts_and_stops_the_gauges_loop() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    with (
        patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
        patch("app.services.gauges.start_gauges_task") as start,
        patch("app.services.gauges.stop_gauges_task", new=AsyncMock()) as stop,
    ):
        with TestClient(app):
            start.assert_called_once_with()
            stop.assert_not_awaited()
        stop.assert_awaited_once_with()
