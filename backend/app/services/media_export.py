"""Isolated, bounded FFmpeg exports with owned cancellation and process reaping."""

import asyncio
import math
import os
import shutil
import signal
import tempfile
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from app.config import settings

# How long FFmpeg may run: a stream-copy remux, a re-encode, and an ffprobe.
REMUX_TIMEOUT_SECONDS = 30
TRANSCODE_TIMEOUT_SECONDS = 120
PROBE_TIMEOUT_SECONDS = 10


async def owned_thread(function, *args):
    """Cancellation waits for filesystem work before its workspace is removed."""
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise


def new_workspace(prefix: str) -> Path:
    """A private request directory under the recording root, so the startup sweep removes
    whatever a killed process leaves behind."""
    root = Path(settings.highlight_temp_dir) / "work"
    root.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=prefix, dir=root))


async def remove_workspace(directory: Path) -> None:
    """Recursive delete is filesystem-bound; it runs in a thread and survives cancellation."""
    await owned_thread(shutil.rmtree, directory, True)


@asynccontextmanager
async def workspace(prefix: str) -> AsyncIterator[Path]:
    """A request workspace removed off the loop on exit, error or cancellation."""
    directory = new_workspace(prefix)
    try:
        yield directory
    finally:
        await remove_workspace(directory)


async def reap(process: asyncio.subprocess.Process) -> None:
    """Kill the process group if it still runs, and return only once it has exited.

    A cancellation during the wait still waits for the exit before it propagates.
    """
    if process.returncode is None:
        with suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
    waiter = asyncio.ensure_future(process.wait())
    try:
        await asyncio.shield(waiter)
    except asyncio.CancelledError:
        await waiter
        raise


async def media_duration(source: Path) -> float:
    """Bounded local-only probe; cancellation reaps ffprobe before returning."""
    try:
        process = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-f",
            "matroska" if source.suffix == ".webm" else "mov",
            "-i",
            str(source),
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as exc:
        raise ValueError("Unable to read preview") from exc
    try:
        stdout, _ = await asyncio.wait_for(process.communicate(), PROBE_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        raise ValueError("Unable to read preview") from exc
    finally:
        await reap(process)
    if process.returncode != 0:
        raise ValueError("Unable to read preview")
    duration = float(stdout.strip())
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Preview duration is invalid")
    return duration


async def encode_file(
    source: Path,
    output: Path,
    format: str,
    start_time: float | None,
    end_time: float | None,
    *,
    concat: bool = False,
) -> Path:
    """Encode into `output` and return it; the caller streams or keeps the file."""
    if format not in ("mp4", "webm"):
        raise ValueError("Unsupported export format")
    trimmed = start_time is not None or end_time is not None
    if trimmed:
        if any(
            value is not None and (not math.isfinite(value) or value < 0)
            for value in (start_time, end_time)
        ):
            raise ValueError("Trim times must be finite and nonnegative")
        duration = await media_duration(source)
        start = start_time or 0
        end = duration if end_time is None else end_time
        if start >= end or end > duration + 0.001 or end - start < 0.099:
            raise ValueError("Select at least 0.1 seconds within the preview")
    trim = []
    if start_time is not None and start_time > 0:
        trim += ["-ss", str(start_time)]
    if end_time is not None:
        trim += ["-t", str(end_time - (start_time or 0))]
    codec = (
        ["-c", "copy", "-movflags", "+faststart"]
        if format == "mp4" and not trimmed
        else [
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-threads",
            "2",
            "-movflags",
            "+faststart",
        ]
        if format == "mp4"
        else [
            "-c:v",
            "libvpx-vp9",
            "-crf",
            "30",
            "-b:v",
            "0",
            "-c:a",
            "libopus",
            "-b:a",
            "128k",
            "-deadline",
            "realtime",
            "-cpu-used",
            "4",
            "-threads",
            "2",
        ]
    )
    # Only local files are accepted here: uploaded containers cannot fetch URLs.
    command = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-protocol_whitelist",
        "file",
        *(["-f", "concat", "-safe", "1"] if concat else ["-f", "mov"]),
        "-i",
        str(source),
        *trim,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        *codec,
        "-fs",
        str(settings.media_export_max_bytes),
        str(output),
    ]
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        # The clock starts once FFmpeg runs and waiting needs no worker thread, so a busy
        # executor can never make a finished encode look timed out.
        code = await asyncio.wait_for(
            process.wait(),
            TRANSCODE_TIMEOUT_SECONDS if trimmed or format == "webm" else REMUX_TIMEOUT_SECONDS,
        )
        if code != 0:
            raise ValueError("Failed to encode highlight")
        size = await owned_thread(lambda: output.stat().st_size)
        if size >= settings.media_export_max_bytes:
            raise ValueError("Highlight exceeds export size limit")
        return output
    finally:
        await reap(process)
