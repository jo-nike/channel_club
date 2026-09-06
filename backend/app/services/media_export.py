"""Isolated, bounded FFmpeg exports with owned cancellation and process reaping."""

import asyncio
import math
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


async def media_duration(source: Path) -> float:
    """Bounded local-only probe; cancellation owns the worker until it exits."""

    def probe():
        result = subprocess.run(
            [
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
            ],
            capture_output=True,
            timeout=10,
            check=True,
        )
        duration = float(result.stdout.strip())
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("Preview duration is invalid")
        return duration

    try:
        return await owned_thread(probe)
    except (subprocess.SubprocessError, OSError) as exc:
        raise ValueError("Unable to read preview") from exc


async def encode_file(
    source: Path,
    output: Path,
    format: str,
    start_time: float | None,
    end_time: float | None,
    *,
    concat: bool = False,
) -> bytes:
    if format not in ("mp4", "webm"):
        raise ValueError("Unsupported export format")
    trimmed = start_time is not None or end_time is not None
    if trimmed:
        if any(
            value is not None and (not math.isfinite(value) or value < 0)
            for value in (start_time, end_time)
        ):
            raise ValueError("Trim times must be finite and nonnegative")
        if concat:
            # Segment manifests have no reliable container duration. Normalize the
            # immutable snapshot first, then trim against that same MP4 timeline.
            normalized = output.with_name("snapshot.mp4")
            await encode_file(source, normalized, "mp4", None, None, concat=True)
            return await encode_file(normalized, output, format, start_time, end_time)
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
    process = subprocess.Popen(
        command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True
    )
    waiter = asyncio.create_task(asyncio.to_thread(process.wait))
    try:
        code = await asyncio.wait_for(
            asyncio.shield(waiter), 120 if trimmed or format == "webm" else 30
        )
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
