"""Everyone who clips the same moment shares one snapshot: made once, hard-linked per owner."""

import asyncio
import json
import os
from io import StringIO
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from loguru import logger

from app.config import settings
from app.services.highlight import MAX_CAPTURES_PER_OWNER, ChannelRecorder, HighlightService
from app.services.media_limits import export_budget

SNAPSHOT = b"one snapshot of the moment"


class SlowRecorder(ChannelRecorder):
    """A running recorder whose capture takes a while, counting the snapshots it makes."""

    def __init__(self, segments: Path):
        super().__init__("channel-1", "http://fixture")
        self.segment_dir = segments
        self.process = MagicMock()
        self.process.poll.return_value = None
        self.snapshots = 0
        self.entered = asyncio.Event()
        close_segment(segments, "seg_000.ts")

    async def wait_for_current_segment(self) -> bool:
        return True

    async def capture(self, output: Path) -> float:
        self.snapshots += 1
        self.entered.set()
        await asyncio.sleep(0.2)
        output.write_bytes(SNAPSHOT)
        return 1_000.0 + self.snapshots


def close_segment(segments: Path, name: str) -> None:
    (segments / name).write_bytes(name.encode())
    listed = segments / "segments.txt"
    previous = listed.read_text() if listed.exists() else ""
    listed.write_text(f"{previous}{name}\n")


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "highlight_enabled", True)
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path / "highlights"))
    segments = tmp_path / "segments"
    segments.mkdir()
    service = HighlightService()
    service._recorders["channel-1"] = SlowRecorder(segments)
    with patch("app.services.highlight.media_duration", AsyncMock(return_value=30.0)):
        yield service
    assert not export_budget.owners
    assert not service.captures.in_flight


def recorder(service: HighlightService) -> SlowRecorder:
    recorder = service._recorders["channel-1"]
    assert isinstance(recorder, SlowRecorder)
    return recorder


def capture_dirs() -> list[Path]:
    root = Path(settings.highlight_temp_dir) / "captures"
    return list(root.iterdir()) if root.exists() else []


async def press(service: HighlightService, owners: list[str]) -> list[asyncio.Task]:
    """Each owner presses a moment after the last, so every press time is its own."""
    tasks = []
    for owner in owners:
        tasks.append(asyncio.create_task(service.create_capture("channel-1", owner=owner)))
        await asyncio.sleep(0.01)
    return tasks


async def test_five_owners_of_the_same_moment_share_one_snapshot(service):
    output = StringIO()
    handler = logger.add(output, format="{message}", serialize=True, level="INFO")
    try:
        owners = [f"local:viewer-{n}" for n in range(5)]
        results = await asyncio.gather(*await press(service, owners))
    finally:
        logger.remove(handler)
    captures = [capture for capture, error in results if error is None and capture is not None]
    assert len(captures) == 5
    assert recorder(service).snapshots == 1
    assert len({capture.id for capture in captures}) == 5
    assert len({capture.pressed_at for capture in captures}) == 5
    assert [capture.owner for capture in captures] == owners
    assert {(capture.size, capture.duration, capture.ends_at) for capture in captures} == {
        (len(SNAPSHOT), 30.0, 1_001.0)
    }
    assert all(capture.path.read_bytes() == SNAPSHOT for capture in captures)
    assert captures[0].path.stat().st_nlink == 5
    # Every owner is counted as the leader is; the four who linked say so.
    records = [json.loads(line)["record"] for line in output.getvalue().splitlines()]
    ready = [r["extra"] for r in records if r["extra"].get("event") == "highlight.capture_ready"]
    assert sorted(extra["shared"] for extra in ready) == [False, True, True, True, True]

    for capture in captures[:2]:
        await service.delete_capture(capture.id, capture.owner)
    for capture in captures[2:]:
        kept = service.get_capture(capture.id, capture.owner)
        assert kept is not None and kept.path.read_bytes() == SNAPSHOT
    for capture in captures[2:]:
        await service.delete_capture(capture.id, capture.owner)
    assert capture_dirs() == []


async def test_followers_of_a_finished_snapshot_need_no_export_slot(service, monkeypatch):
    monkeypatch.setattr(settings, "media_export_limit", 1)
    first, error = await service.create_capture("channel-1", owner="local:viewer")
    assert error is None and first is not None
    # An unrelated export holds the only slot.
    with export_budget.slot("plex:9"):
        results = await asyncio.wait_for(
            asyncio.gather(*await press(service, ["plex:1", "plex:2"])), 2
        )
    assert all(error is None and capture is not None for capture, error in results)
    assert recorder(service).snapshots == 1
    await service.captures.clear()


async def test_followers_of_a_leader_who_left_still_get_a_capture(service):
    leader = asyncio.create_task(service.create_capture("channel-1", owner="plex:1"))
    await recorder(service).entered.wait()
    followers = await press(service, ["plex:2", "plex:3"])
    leader.cancel()
    results = await asyncio.wait_for(asyncio.gather(*followers), 2)
    with pytest.raises(asyncio.CancelledError):
        await leader
    assert all(error is None and capture is not None for capture, error in results)
    # One of the followers made the snapshot again, and the other linked to it.
    assert recorder(service).snapshots == 2
    assert len(capture_dirs()) == 2
    await service.captures.clear()


async def test_a_follower_who_leaves_does_not_stop_the_snapshot(service):
    leader, follower, other = await press(service, ["plex:1", "plex:2", "plex:3"])
    follower.cancel()
    results = await asyncio.wait_for(asyncio.gather(leader, other), 2)
    assert all(error is None and capture is not None for capture, error in results)
    assert recorder(service).snapshots == 1
    await service.captures.clear()


async def test_a_newly_closed_segment_makes_a_new_snapshot(service):
    first, _ = await service.create_capture("channel-1", owner="plex:1")
    close_segment(recorder(service).segment_dir or Path(), "seg_001.ts")
    second, _ = await service.create_capture("channel-1", owner="plex:2")
    assert first is not None and second is not None
    assert first.snapshot_key != second.snapshot_key
    assert recorder(service).snapshots == 2
    assert first.path.stat().st_nlink == second.path.stat().st_nlink == 1
    await service.captures.clear()


async def test_shared_captures_count_toward_the_owners_limit(service):
    made = []
    for _ in range(MAX_CAPTURES_PER_OWNER + 1):
        capture, _ = await service.create_capture("channel-1", owner="local:viewer")
        assert capture is not None
        made.append(capture)
    assert recorder(service).snapshots == 1
    # The oldest (the one that made the snapshot) went; the links to it still play.
    assert service.get_capture(made[0].id, "local:viewer") is None
    assert all(capture.path.read_bytes() == SNAPSHOT for capture in made[1:])
    assert len(capture_dirs()) == MAX_CAPTURES_PER_OWNER
    await service.captures.clear()


async def test_clear_forgets_snapshots_in_flight(service):
    leader = asyncio.create_task(service.create_capture("channel-1", owner="plex:1"))
    await recorder(service).entered.wait()
    assert service.captures.in_flight
    await service.captures.clear()
    assert not service.captures.in_flight
    capture, error = await leader
    assert error is None and capture is not None
    await service.captures.clear()


async def test_a_reused_ring_name_is_a_new_moment(service):
    segments = recorder(service).segment_dir or Path()
    first, _ = await service.create_capture("channel-1", owner="plex:1")
    # The ring wraps: the same name closes again with a later mtime.
    stat = (segments / "seg_000.ts").stat()
    os.utime(segments / "seg_000.ts", ns=(stat.st_atime_ns, stat.st_mtime_ns + 10**9))
    second, _ = await service.create_capture("channel-1", owner="plex:2")
    assert first is not None and second is not None
    assert recorder(service).snapshots == 2
    await service.captures.clear()
