"""Isolated, bounded FFmpeg exports with owned cancellation and process reaping."""

import asyncio
import os
import signal
import subprocess
from contextlib import suppress
from pathlib import Path

from app.config import settings


async def owned_thread(function, *args):
    """Cancellation waits for filesystem work before its workspace is removed."""
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        await task
        raise


async def encode_file(
    source: Path,
    output: Path,
    format: str,
    start_time: float | None,
    end_time: float | None,
    *,
    concat: bool = False,
) -> bytes:
    trim = []
    if start_time is not None and start_time > 0:
        trim += ["-ss", str(start_time)]
    if end_time is not None:
        trim += ["-t", str(end_time - (start_time or 0))]
    codec = (
        ["-c", "copy", "-movflags", "+faststart"]
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
        *codec,
        "-fs",
        str(settings.media_export_max_bytes),
        str(output),
    ]
    process = subprocess.Popen(
        command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True
    )
    waiter = asyncio.create_task(asyncio.to_thread(process.wait))
    try:
        code = await asyncio.wait_for(asyncio.shield(waiter), 120 if format == "webm" else 30)
        if code != 0:
            raise ValueError("Failed to encode highlight")
        size = await owned_thread(lambda: output.stat().st_size)
        if size >= settings.media_export_max_bytes:
            raise ValueError("Highlight exceeds export size limit")
        return await owned_thread(output.read_bytes)
    finally:
        if process.poll() is None:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
        await asyncio.shield(waiter)
