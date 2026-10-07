"""Mixed churn leaves every registry, budget, child process and descriptor where it started (J-03).

Each cleanup path has its own test; this one runs them interleaved through the
real WebSocket endpoint and the real recorder, cast and capture services, with
harmless `sleep` children standing in for FFmpeg, and then checks that nothing
was left behind. A dropped pop() or release on some new branch shows up here
instead of as a slow leak or stuck 429s in production.
"""

import asyncio
import gc
import json
import os
import signal
import subprocess
import time
from collections.abc import Sized
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from starlette.types import Message, Scope

from app.config import settings
from app.main import app
from app.models.channel import Channel
from app.models.websocket import ServerPong
from app.routers import websocket as websocket_router
from app.services import (
    cast,
    channel_state,
    chat,
    highlight,
    logo_proxy,
    presence,
    presence_broadcast,
    stream_sessions,
)
from app.services.auth import create_access_token
from app.services.cast import CastSession, cast_service
from app.services.ersatztv import xmltv_parser
from app.services.highlight import ChannelRecorder, highlight_service
from app.services.media_limits import (
    export_budget,
    process_budget,
    recorder_budget,
    upload_budget,
)

# Captured at import, before conftest swaps it for a no-op in every test
REAL_SCHEDULE = presence_broadcast.schedule_broadcast
REAL_POPEN = subprocess.Popen

SOCKET_CYCLES = 200
SERVICE_CYCLES = 12
# Descriptors other parts of the process (loguru, the loop's self-pipe) may open meanwhile
FD_TOLERANCE = 5


class FastAsyncio:
    """The asyncio module for the recorder and cast services, minus their startup waits.

    Both poll their FFmpeg every 0.5 s while it starts; the fake one is up at once.
    """

    def __getattr__(self, name: str) -> Any:
        return getattr(asyncio, name)

    @staticmethod
    async def sleep(delay: float, result: Any = None) -> Any:
        await asyncio.sleep(0)
        return result


def children() -> set[int]:
    """This process's child pids, zombies included, from /proc."""
    me = os.getpid()
    found = set()
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            stat = Path(f"/proc/{entry}/stat").read_text()
        except OSError:
            continue
        # The command name is parenthesised and may hold spaces; the ppid follows its state.
        if int(stat.rsplit(")", 1)[1].split()[1]) == me:
            found.add(int(entry))
    return found


def descriptors() -> int:
    return len(os.listdir("/proc/self/fd"))


class Conn:
    """A scripted client on the real /api/ws endpoint, through the whole ASGI app."""

    def __init__(self, token: str) -> None:
        self.inbox: asyncio.Queue[Message] = asyncio.Queue()
        self.received: list[dict] = []
        self.arrived = asyncio.Event()
        self.fail_sends = False
        self.stall = False
        self.inbox.put_nowait({"type": "websocket.connect"})
        self.push({"type": "auth", "token": token})
        scope: Scope = {
            "type": "websocket",
            "asgi": {"version": "3.0"},
            "scheme": "ws",
            "path": "/api/ws",
            "raw_path": b"/api/ws",
            "root_path": "",
            "query_string": b"",
            "headers": [(b"host", b"testserver")],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
            "subprotocols": [],
        }
        self.task = asyncio.create_task(app(scope, self.receive, self.send))

    def push(self, message: dict) -> None:
        self.inbox.put_nowait({"type": "websocket.receive", "text": json.dumps(message)})

    async def receive(self) -> Message:
        return await self.inbox.get()

    async def send(self, message: Message) -> None:
        if self.fail_sends:
            raise OSError("Connection reset by peer")
        if self.stall:
            await asyncio.Event().wait()
        if message["type"] == "websocket.send":
            self.received.append(json.loads(message["text"]))
            self.arrived.set()

    async def wait_for(self, kind: str) -> None:
        while not any(item["type"] == kind for item in self.received):
            self.arrived.clear()
            await asyncio.wait_for(self.arrived.wait(), 2)

    async def settle(self) -> None:
        """Wait until every message sent so far has been handled (a pong comes back)."""
        await self.wait_for("connection_ack")
        pongs = sum(item["type"] == "pong" for item in self.received)
        self.push({"type": "ping"})
        while sum(item["type"] == "pong" for item in self.received) <= pongs:
            self.arrived.clear()
            await asyncio.wait_for(self.arrived.wait(), 2)

    def close(self, code: int = 1000) -> None:
        self.inbox.put_nowait({"type": "websocket.disconnect", "code": code})

    async def ended(self) -> None:
        await asyncio.wait_for(asyncio.gather(self.task, return_exceptions=True), 2)


async def open_conn(account: str) -> Conn:
    conn = Conn(create_access_token({"sub": account, "role": "viewer"}))
    conn.push({"type": "set_nickname", "nickname": f"Nick {account}"})
    conn.push({"type": "channel_update", "channel": "News", "channelId": "n1"})
    await conn.settle()
    return conn


async def socket_cycle(index: int) -> None:
    kind = index % 6
    account = f"viewer{index % 7}"
    if kind == 0:
        # A normal close
        conn = await open_conn(account)
        conn.close(1001)
        await conn.ended()
    elif kind in (1, 2):
        # Two sockets for one account, closed in either order
        first, second = await open_conn(account), await open_conn(account)
        order = (first, second) if kind == 1 else (second, first)
        for conn in order:
            conn.close()
            await conn.ended()
    elif kind == 3:
        # A send that raises: the broadcast drops the socket and cancels its endpoint
        conn = await open_conn(account)
        conn.fail_sends = True
        await channel_state.broadcast(ServerPong(type="pong"))
        await conn.ended()
    elif kind == 4:
        # A stalled peer: the broadcast times out on it, and its close times out too
        conn = await open_conn(account)
        conn.stall = True
        await channel_state.broadcast(ServerPong(type="pong"))
        await conn.ended()
    else:
        # The handler task cancelled from outside
        conn = await open_conn(account)
        conn.task.cancel()
        await conn.ended()


async def recorder_cycle(index: int) -> None:
    channel_id = f"rec{index % 3}"
    kind = index % 4
    if kind == 3:
        # FFmpeg missing: the start fails and releases its slot
        ffmpeg_missing[0] = True
        try:
            assert not await highlight_service.start_recording(channel_id, "http://fixture")
        finally:
            ffmpeg_missing[0] = False
        highlight_service.clear_start_backoff()
        return
    assert await highlight_service.start_recording(channel_id, "http://fixture")
    if kind == 1:
        # FFmpeg died: the next start replaces the dead recorder
        process = highlight_service._recorders[channel_id].process
        assert process is not None
        os.killpg(process.pid, signal.SIGKILL)
        await asyncio.to_thread(process.wait)
        assert await highlight_service.start_recording(channel_id, "http://fixture")
    await capture_cycle(channel_id, index)
    if kind == 2:
        await highlight_service.stop_all()
    else:
        await highlight_service.stop_recording(channel_id)


async def capture_cycle(channel_id: str, index: int) -> None:
    # Two presses of the same moment share one snapshot; one account then clips past its limit.
    moment[0] = index
    results = await asyncio.gather(
        highlight_service.create_capture(channel_id, "local:a"),
        highlight_service.create_capture(channel_id, "local:b"),
    )
    assert all(capture is not None for capture, _ in results)
    for _ in range(highlight.MAX_CAPTURES_PER_OWNER):
        moment[0] += 1000
        capture, _ = await highlight_service.create_capture(channel_id, "local:a")
        assert capture is not None
        assert highlight_service.issue_download_token(capture.id, "local:a")
        assert highlight_service.issue_preview_token(capture.id, "local:a")
    if index % 2:
        await highlight_service.captures.sweep(
            highlight.monotonic() + highlight.CAPTURE_TTL_SECONDS + 1
        )


async def cast_cycle(index: int) -> None:
    kind = index % 4
    owner = f"local:caster{index % 2}"
    if kind == 3:
        # FFmpeg missing: the session is never kept and its slot is released
        ffmpeg_missing[0] = True
        try:
            session = await cast_service.create_session("c1", "http://fixture", "mpegts", owner)
        finally:
            ffmpeg_missing[0] = False
        assert session is None
        return
    session = await cast_service.create_session(
        "c1", "http://fixture", "mpegts", owner, follows_live=kind != 0
    )
    assert session is not None
    if kind == 0:
        assert await cast_service.stop_session(session["session_id"], owner)
    elif kind == 1:
        # Follows Live to another channel, then stops with Live
        await cast_service.follow_live(
            Channel(id="c2", name="Two", stream_url="http://fixture/2", guide_id="guide-c2")
        )
        await cast_service.follow_live(None)
    else:
        await cast_service.stop_all()


# The newest closed segment's mtime the stubbed recorders report: presses see one moment
moment = [0]
# Whether the fake FFmpeg fails to spawn, as when the binary is missing
ffmpeg_missing = [False]


def fake_ffmpeg(cmd: list[str], **kwargs: Any) -> subprocess.Popen:
    if ffmpeg_missing[0]:
        raise FileNotFoundError("ffmpeg")
    return REAL_POPEN(
        ["sleep", "10"],
        stdout=subprocess.DEVNULL,
        stderr=kwargs.get("stderr", subprocess.DEVNULL),
        start_new_session=True,
    )


def fake_cast_ffmpeg(cmd: list[str]) -> subprocess.Popen:
    if ffmpeg_missing[0]:
        raise FileNotFoundError("ffmpeg")
    # A new inode each time, so a switch sees the playlist rewritten
    playlist = Path(cmd[-1])
    draft = playlist.with_suffix(".tmp")
    draft.write_text("#EXTM3U\n")
    draft.replace(playlist)
    return REAL_POPEN(
        ["sleep", "10"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


@pytest.fixture
def churn(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Real services and presence broadcasts, fake FFmpeg, no upstreams."""
    monkeypatch.setattr(presence_broadcast, "schedule_broadcast", REAL_SCHEDULE)
    monkeypatch.setattr(presence_broadcast, "BROADCAST_DEBOUNCE_SECONDS", 0)
    monkeypatch.setattr(presence_broadcast, "_pending", None)
    monkeypatch.setattr(channel_state, "BROADCAST_SEND_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(settings, "chat_enabled", True)
    monkeypatch.setattr(settings, "highlight_enabled", True)
    monkeypatch.setattr(settings, "highlight_temp_dir", str(tmp_path / "highlights"))
    monkeypatch.setattr(settings, "cast_temp_dir", str(tmp_path / "cast"))
    monkeypatch.setattr(highlight, "asyncio", FastAsyncio())
    monkeypatch.setattr(cast, "asyncio", FastAsyncio())
    monkeypatch.setattr(highlight.subprocess, "Popen", fake_ffmpeg)
    monkeypatch.setattr(CastSession, "_spawn", staticmethod(fake_cast_ffmpeg))
    source = SimpleNamespace(channel=SimpleNamespace(stream_url="http://fixture"))
    monkeypatch.setattr(highlight, "resolve_media_channel", AsyncMock(return_value=source))
    monkeypatch.setattr(highlight, "media_duration", AsyncMock(return_value=5.0))

    async def capture(self: ChannelRecorder, output: Path) -> float:
        # The stubbed remux: yields once, so a second press of the moment finds it in flight
        await asyncio.sleep(0)
        output.write_bytes(b"snapshot")
        return time.time()

    monkeypatch.setattr(ChannelRecorder, "capture", capture)
    monkeypatch.setattr(ChannelRecorder, "wait_for_current_segment", AsyncMock(return_value=True))
    monkeypatch.setattr(
        ChannelRecorder,
        "_newest_listed_segment_stamp",
        lambda self: ("seg_000.ts", moment[0]),
    )


async def drain() -> None:
    """Let broadcasts and background closes still running finish."""
    for _ in range(50):
        pending = [*presence_broadcast._tasks, *channel_state._failed_closes]
        if not pending:
            return
        await asyncio.wait_for(asyncio.gather(*pending, return_exceptions=True), 2)


async def run_everything(socket_cycles: int, service_cycles: int) -> None:
    for index in range(socket_cycles):
        await socket_cycle(index)
    for index in range(service_cycles):
        await recorder_cycle(index)
        await cast_cycle(index)
    await drain()


def leftovers() -> dict[str, object]:
    """Every registry and budget that must be empty once all churn has ended."""
    registries: dict[str, Sized] = {
        "websocket._nickname_map": websocket_router._nickname_map,
        "channel_state._active_connections": channel_state._active_connections,
        "channel_state._connection_owners": channel_state._connection_owners,
        "channel_state._failed_closes": channel_state._failed_closes,
        "presence._active_users": presence._active_users,
        "presence._watches": presence._watches,
        "presence._stale_closes": presence._stale_closes,
        "presence_broadcast._tasks": presence_broadcast._tasks,
        "chat._sends_in_flight": chat._sends_in_flight,
        "highlight._recorders": highlight_service._recorders,
        "highlight._owners": highlight_service._owners,
        "captures.captures": highlight_service.captures.captures,
        "captures.download_tokens": highlight_service.captures.download_tokens,
        "captures.preview_tokens": highlight_service.captures.preview_tokens,
        "captures.in_flight": highlight_service.captures.in_flight,
        "cast._sessions": cast_service._sessions,
        "cast._owners": cast_service._owners,
        "stream_sessions._sessions": stream_sessions._sessions,
        "logo_proxy._flights": logo_proxy.LOGO_CACHE._flights,
    }
    for budget in (process_budget, recorder_budget, export_budget, upload_budget):
        registries[f"{budget.kind}_budget.owners"] = budget.owners
        registries[f"{budget.kind}_budget._waiters"] = budget._waiters
    left: dict[str, object] = {name: items for name, items in registries.items() if len(items)}
    if xmltv_parser.guide._refresh_task is not None:
        left["xmltv guide refresh task"] = xmltv_parser.guide._refresh_task
    # Recorder, capture, workspace and cast directories all hold files while in use
    for root in (settings.highlight_temp_dir, settings.cast_temp_dir):
        files = [path for path in Path(root).rglob("*") if path.is_file()]
        if files:
            left[root] = files
    return left


@pytest.mark.usefixtures("churn")
async def test_mixed_churn_returns_every_registry_and_budget_to_baseline() -> None:
    # One warm-up round, so lazily created descriptors (the thread pool, the app's
    # middleware stack) are in the baseline rather than counted as a leak
    await run_everything(12, 4)
    assert leftovers() == {}
    gc.collect()
    baseline_children = children()
    baseline_fds = descriptors()

    await run_everything(SOCKET_CYCLES, SERVICE_CYCLES)

    assert leftovers() == {}
    assert children() - baseline_children == set()
    fds = descriptors()
    if fds > baseline_fds + FD_TOLERANCE:
        # Closed transports and pipes can wait on the collector and a loop turn
        gc.collect()
        await asyncio.sleep(0.1)
        fds = descriptors()
    assert fds <= baseline_fds + FD_TOLERANCE
