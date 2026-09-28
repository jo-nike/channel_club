"""Periodic gauges for the process's own long-lived resources, as one log line.

Every GAUGES_INTERVAL_SECONDS an INFO line bound with event="gauges" carries
integer counts (sockets, presence, recorders, cast sessions, captures, media
budgets, open FDs, FFmpeg children), so Loki and Grafana can chart a held slot
or a slow leak without a /metrics endpoint. Totals only: no usernames, owners
or ids.
"""

import asyncio
import os
from contextlib import suppress
from pathlib import Path

from loguru import logger

from app.services import channel_state, presence
from app.services.cast import cast_service
from app.services.highlight import highlight_service
from app.services.media_limits import export_budget, process_budget, recorder_budget

log = logger.bind(service="gauges")

GAUGES_INTERVAL_SECONDS = 60

_PROC = Path("/proc")

_task: asyncio.Task[None] | None = None


def _open_fds() -> int | None:
    """Open file descriptors, or None where /proc/self/fd does not exist."""
    try:
        return len(os.listdir(_PROC / "self" / "fd"))
    except OSError:
        return None


def _ffmpeg_children() -> int | None:
    """Live ffmpeg processes whose parent is this process, or None without /proc."""
    if not (_PROC / "self").exists():
        return None
    pid = os.getpid()
    count = 0
    for entry in _PROC.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text()
        except OSError:
            continue  # Exited while we looked
        # "pid (comm) state ppid ...": comm may contain spaces, so split at the last ')'
        comm = stat[stat.find("(") + 1 : stat.rfind(")")]
        fields = stat[stat.rfind(")") + 2 :].split()
        if comm == "ffmpeg" and len(fields) > 1 and fields[1] == str(pid):
            count += 1
    return count


def collect_gauges() -> dict[str, int]:
    """Read every gauge from local state; never blocks or contacts an upstream."""
    running, idle = highlight_service.recorder_counts()
    captures = highlight_service.captures
    gauges = {
        "ws_connections": channel_state.get_connection_count(),
        "presence_entries": len(presence.get_active_users()),
        "recorders_running": running,
        "recorders_idle": idle,
        "cast_sessions": cast_service.session_count(),
        "captures": len(captures.captures),
        "capture_bytes": sum(capture.size for capture in captures.captures.values()),
        "download_tokens": len(captures.download_tokens),
        "budget_process": sum(process_budget.owners.values()),
        "budget_export": sum(export_budget.owners.values()),
        "budget_recorder": sum(recorder_budget.owners.values()),
    }
    open_fds = _open_fds()
    if open_fds is not None:
        gauges["open_fds"] = open_fds
    ffmpeg_children = _ffmpeg_children()
    if ffmpeg_children is not None:
        gauges["ffmpeg_children"] = ffmpeg_children
    return gauges


def log_gauges() -> None:
    """Write one gauges line."""
    log.bind(event="gauges", **collect_gauges()).info("Gauges")


async def _gauges_loop() -> None:
    while True:
        await asyncio.sleep(GAUGES_INTERVAL_SECONDS)
        try:
            log_gauges()
        except Exception as e:
            log.warning("Gauges collection failed: {!r}", e)


def start_gauges_task() -> None:
    """Start the gauges loop (lifespan startup)."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_gauges_loop())


async def stop_gauges_task() -> None:
    """Cancel and await the gauges loop (lifespan teardown)."""
    global _task
    task, _task = _task, None
    if task is not None and not task.done():
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def reset_gauges_task() -> None:
    """Forget the loop's task without awaiting it (tests: new event loop)."""
    global _task
    _task = None
