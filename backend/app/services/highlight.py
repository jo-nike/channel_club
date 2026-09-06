"""Highlight capture service using server-side FFmpeg recording.

This service manages FFmpeg processes that continuously record active streams
into a ring buffer of segments. When a user requests a highlight, the recent
segments are concatenated and returned as an MP4 file.

Architecture:
- One FFmpeg process per active channel (started on first viewer, stopped when idle)
- Segments stored in temp directory, cleaned up on stop
- Ring buffer maintains last N seconds (configurable via HIGHLIGHT_BUFFER_SECONDS)
"""

import asyncio
import os
import shutil
import signal
import subprocess
import tempfile
import time
from contextlib import suppress
from pathlib import Path

from loguru import logger

from app.config import settings
from app.models.channel import validate_channel_id
from app.services.media_export import encode_file, owned_thread
from app.services.media_limits import MediaCapacityError, export_budget, process_budget
from app.services.media_source import resolve_media_channel

log = logger.bind(service="highlight")


def remove_recording_directory(directory: Path) -> None:
    """Delete only strict descendants of the configured recording root."""
    root = Path(settings.highlight_temp_dir).resolve()
    resolved = directory.resolve()
    if resolved == root or not resolved.is_relative_to(root) or directory.is_symlink():
        log.warning("Refusing removal outside recording directory")
        return
    shutil.rmtree(directory)


class ChannelRecorder:
    """Manages FFmpeg recording for a single channel."""

    def __init__(self, channel_id: str, stream_url: str):
        self.channel_id = channel_id
        self.stream_url = stream_url
        self.process: subprocess.Popen | None = None
        self.segment_dir: Path | None = None
        self.started_at: float = 0
        self.last_activity: float = 0  # Last time this channel was polled
        self._lock = asyncio.Lock()

    def touch(self) -> None:
        """Update last activity timestamp (called on status poll)."""
        self.last_activity = time.time()

    @property
    def is_running(self) -> bool:
        """Check if FFmpeg process is running."""
        return self.process is not None and self.process.poll() is None

    async def start(self) -> bool:
        """Start FFmpeg recording process.

        Returns:
            True if started successfully, False otherwise.
        """
        async with self._lock:
            if self.is_running:
                log.debug("Recorder already running for channel {}", self.channel_id)
                return True

            # Create segment directory
            validate_channel_id(self.channel_id)
            root = Path(settings.highlight_temp_dir)
            root.mkdir(parents=True, exist_ok=True)
            self.segment_dir = Path(tempfile.mkdtemp(prefix="recorder-", dir=root))

            # Build FFmpeg command for HLS segment recording
            # Uses segment muxer to create rolling segments
            segment_pattern = str(self.segment_dir / "seg_%03d.ts")
            segment_list = str(self.segment_dir / "segments.txt")

            cmd = [
                "ffmpeg",
                "-y",  # Overwrite output files
                "-hide_banner",
                "-loglevel",
                "warning",
                "-reconnect",
                "1",
                "-reconnect_streamed",
                "1",
                "-reconnect_delay_max",
                "5",
                "-protocol_whitelist",
                "http,https,tcp,tls,crypto",
                "-i",
                self.stream_url,
                "-c",
                "copy",  # No re-encoding - copy codec
                "-f",
                "segment",
                "-segment_time",
                str(settings.highlight_segment_seconds),
                "-segment_list",
                segment_list,
                "-segment_list_type",
                "flat",
                "-segment_list_size",
                str((settings.highlight_buffer_seconds // settings.highlight_segment_seconds) + 1),
                "-segment_wrap",
                str(
                    (settings.highlight_buffer_seconds // settings.highlight_segment_seconds) + 2
                ),  # Number of segments to keep before wrapping
                "-reset_timestamps",
                "1",
                segment_pattern,
            ]

            log.info(
                "Starting FFmpeg recorder for channel {} with {} second buffer",
                self.channel_id,
                settings.highlight_buffer_seconds,
            )
            log.debug("FFmpeg command: {}", " ".join(cmd))

            started = False
            try:
                self.process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,  # Safe from worker threads; no undrained pipes
                )
                self.started_at = time.time()
                self.last_activity = time.time()

                # Give FFmpeg a moment to start and check it's running
                await asyncio.sleep(0.5)
                if not self.is_running:
                    stderr = f"exit status {self.process.returncode}"
                    log.error("FFmpeg failed to start for channel {}: {}", self.channel_id, stderr)
                    return False

                log.info(
                    "FFmpeg recorder started for channel {} (PID: {})",
                    self.channel_id,
                    self.process.pid,
                )
                started = True
                return True

            except FileNotFoundError:
                log.error("FFmpeg not found - highlight feature requires FFmpeg to be installed")
                return False
            except Exception as e:
                log.error("Failed to start FFmpeg for channel {}: {}", self.channel_id, e)
                return False
            finally:
                if not started:
                    await self._stop_locked()

    async def stop(self) -> None:
        """Stop FFmpeg recording and cleanup."""
        async with self._lock:
            await self._stop_locked()

    async def _stop_locked(self) -> None:
        """Stop resources while the recorder lifecycle lock is held."""
        if self.process:
            log.info(
                "Stopping FFmpeg recorder for channel {} (PID: {})",
                self.channel_id,
                self.process.pid,
            )
            process = self.process

            # Signal and reap in a thread pool to avoid blocking the event
            # loop - a stalled FFmpeg can ignore SIGTERM for the full timeout
            def terminate_process() -> None:
                # Send SIGTERM to process group
                os.killpg(os.getpgid(process.pid), 15)  # SIGTERM
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(os.getpgid(process.pid), 9)  # SIGKILL
                    process.wait()

            try:
                await asyncio.to_thread(terminate_process)
            except ProcessLookupError:
                pass  # Process already dead
            except Exception as e:
                log.warning("Error stopping FFmpeg process: {}", e)
            finally:
                self.process = None

        # Cleanup segment directory
        if self.segment_dir and self.segment_dir.exists():
            try:
                # Recursive delete is filesystem-bound - keep it off the loop
                await asyncio.to_thread(remove_recording_directory, self.segment_dir)
                log.debug("Cleaned up segment directory for channel {}", self.channel_id)
            except Exception as e:
                log.warning("Failed to cleanup segments for channel {}: {}", self.channel_id, e)
            finally:
                self.segment_dir = None

    def get_buffer_seconds(self) -> float:
        """Get how many seconds of content are actually in the buffer.

        Uses segment file modification times to determine the real time span
        of recorded content, rather than wall-clock time since process start.
        This accounts for FFmpeg startup delay and stream interruptions.
        """
        if not self.is_running or not self.segment_dir:
            return 0

        try:
            seg_files = sorted(
                self.segment_dir.glob("seg_*.ts"),
                key=lambda p: p.stat().st_mtime,
            )
            if not seg_files:
                return 0

            # Buffer span = time from oldest segment to now,
            # capped at the configured buffer max
            oldest_mtime = seg_files[0].stat().st_mtime
            span = time.time() - oldest_mtime
            return min(span, settings.highlight_buffer_seconds)
        except OSError:
            # Fallback to wall-clock if file inspection fails
            elapsed = time.time() - self.started_at
            return min(elapsed, settings.highlight_buffer_seconds)

    def _snapshot(self, workspace: Path) -> Path:
        """Copy completed segments while producer is paused and lifecycle locked."""
        if not self.segment_dir or not self.process:
            raise ValueError("Recorder not running")
        producer_pid = self.process.pid
        os.killpg(producer_pid, signal.SIGSTOP)
        try:
            _, status = os.waitpid(producer_pid, os.WUNTRACED)
            if not os.WIFSTOPPED(status):
                raise ValueError("Recorder exited while capturing highlight")
            segment_list = self.segment_dir / "segments.txt"
            entries = segment_list.read_text().splitlines()
            if not entries:
                raise ValueError("No segments recorded yet")
            capacity = settings.highlight_buffer_seconds // settings.highlight_segment_seconds + 2
            # The next ring index is being written and must never enter a snapshot.
            last = Path(entries[-1]).name
            current = f"seg_{(int(last[4:7]) + 1) % capacity:03d}.ts"
            names = list(dict.fromkeys(reversed(entries)))[:capacity]
            paths = []
            for entry in reversed(names):
                name = Path(entry).name
                if name != current and name.startswith("seg_") and name.endswith(".ts"):
                    path = self.segment_dir / name
                    if path.is_file() and not path.is_symlink():
                        paths.append(path)
            paths.sort(key=lambda path: path.stat().st_mtime)
            cutoff = time.time() - settings.highlight_buffer_seconds
            paths = [path for path in paths if path.stat().st_mtime >= cutoff]
            if not paths:
                raise ValueError("No recent segments available")
            if sum(path.stat().st_size for path in paths) > settings.media_export_max_bytes:
                raise ValueError("Highlight exceeds export size limit")
            names = []
            for index, path in enumerate(paths):
                name = f"input_{index:03d}.ts"
                shutil.copyfile(path, workspace / name)
                names.append(name)
            concat = workspace / "concat.txt"
            concat.write_text("".join(f"file '{name}'\n" for name in names))
            return concat
        finally:
            with suppress(ProcessLookupError):
                os.killpg(producer_pid, signal.SIGCONT)

    async def save_highlight(
        self,
        format: str = "mp4",
        start_time: float | None = None,
        end_time: float | None = None,
    ) -> tuple[bytes | None, str | None]:
        """Export private copied inputs; producer stop/wrap cannot change them."""
        with tempfile.TemporaryDirectory(prefix="highlight-export-") as directory:
            workspace = Path(directory)
            try:
                async with self._lock:
                    if not self.is_running or not self.segment_dir:
                        return None, "Recorder not running"
                    concat = await owned_thread(self._snapshot, workspace)
                video = await encode_file(
                    concat,
                    workspace / f"highlight.{format}",
                    format,
                    start_time,
                    end_time,
                    concat=True,
                )
                return video, None
            except TimeoutError:
                return None, "Highlight creation timed out"
            except (OSError, ValueError) as exc:
                log.warning("Highlight export failed: {}", exc)
                return None, str(exc)


# Idle timeout for recordings - stop if no status polls for this duration.
# With always-on polling from the frontend, this is a safety net for
# edge cases like browser tab closure or network disconnects.
RECORDER_IDLE_TIMEOUT = 120


class HighlightService:
    """Manages channel recorders and provides highlight capture functionality."""

    def __init__(self):
        self._recorders: dict[str, ChannelRecorder] = {}
        self._owners: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task | None = None

    def start_idle_cleanup_task(self) -> None:
        """Start background task to clean up idle recorders."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._idle_cleanup_loop())
            log.debug("Started idle recorder cleanup task")

    def stop_idle_cleanup_task(self) -> None:
        """Stop the background cleanup task."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            self._cleanup_task = None
            log.debug("Stopped idle recorder cleanup task")

    async def _idle_cleanup_loop(self) -> None:
        """Background loop that periodically cleans up idle recorders."""
        while True:
            try:
                await asyncio.sleep(10)  # Check every 10 seconds
                await self._cleanup_idle_recorders()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.warning("Error in idle cleanup loop: {}", e)

    async def _cleanup_idle_recorders(self) -> None:
        """Stop recorders that haven't been polled recently."""
        now = time.time()
        idle_channels: list[str] = []

        # Find idle recorders (without holding lock during iteration)
        for channel_id, recorder in list(self._recorders.items()):
            if not recorder.is_running:
                idle_channels.append(channel_id)
            elif recorder.last_activity > 0:
                idle_time = now - recorder.last_activity
                if idle_time > RECORDER_IDLE_TIMEOUT:
                    idle_channels.append(channel_id)
                    log.debug(
                        "Channel {} idle for {:.1f}s, marking for cleanup",
                        channel_id,
                        idle_time,
                    )

        # Stop idle recorders
        for channel_id in idle_channels:
            log.info("Stopping idle recorder for channel {} (no viewers)", channel_id)
            await self.stop_recording(channel_id)

    def cleanup_orphan_processes(self) -> None:
        """Kill any orphan FFmpeg processes from previous runs.

        When uvicorn reloads, FFmpeg processes may survive because they run in
        their own process groups. This method finds and kills them on startup.
        """
        highlight_dir = settings.highlight_temp_dir
        killed = 0

        try:
            # Find FFmpeg processes that reference our highlight directory
            result = subprocess.run(
                ["pgrep", "-f", f"ffmpeg.*{highlight_dir}"],
                capture_output=True,
                text=True,
            )

            if result.returncode == 0 and result.stdout.strip():
                pids = result.stdout.strip().split("\n")
                for pid_str in pids:
                    try:
                        pid = int(pid_str.strip())
                        # Kill the process group to ensure children are also killed
                        try:
                            os.killpg(os.getpgid(pid), 15)  # SIGTERM
                            killed += 1
                            log.debug("Killed orphan FFmpeg process {}", pid)
                        except ProcessLookupError:
                            pass  # Process already dead
                        except PermissionError:
                            log.warning("No permission to kill process {}", pid)
                    except ValueError:
                        continue

                if killed:
                    log.info("Killed {} orphan FFmpeg processes", killed)

        except FileNotFoundError:
            # pgrep not available - skip this cleanup
            log.debug("pgrep not available, skipping orphan process cleanup")
        except Exception as e:
            log.warning("Failed to cleanup orphan processes: {}", e)

    def cleanup_stale_segments(self) -> None:
        """Remove any stale segment directories from previous runs.

        Called at startup to clean up orphaned files from crashes or unclean shutdowns.
        Also kills any orphan FFmpeg processes that may have survived a reload.
        """
        # First kill any orphan FFmpeg processes
        self.cleanup_orphan_processes()

        temp_dir = Path(settings.highlight_temp_dir)
        if not temp_dir.exists():
            return

        try:
            removed = 0
            for item in temp_dir.iterdir():
                if item.is_dir():
                    remove_recording_directory(item)
                    removed += 1
            if removed:
                log.info("Cleaned up {} stale segment directories", removed)
        except Exception as e:
            log.warning("Failed to cleanup stale segments: {}", e)

    async def start_recording(
        self, channel_id: str, stream_url: str, owner: str = "system"
    ) -> bool:
        """Start recording a channel (if not already recording).

        Args:
            channel_id: Unique channel identifier.
            stream_url: URL of the stream to record.

        Returns:
            True if recorder is running (started or already running). False if
            optional recording cannot start, including when capacity is full.
        """
        if not settings.highlight_enabled:
            log.debug("Highlight feature disabled, not starting recorder")
            return False

        if channel_id in self._recorders and self._recorders[channel_id].is_running:
            return True
        # Reserve before any awaited work: overload never queues behind startup.
        try:
            process_budget.acquire(owner)
        except MediaCapacityError:
            # Recording is optional; normal status polling and channel changes
            # must continue while cast/recorder jobs occupy the available slots.
            log.debug("Highlight recording deferred for {}: capacity full", channel_id)
            return False
        retained = False
        recorder = None
        try:
            source = await resolve_media_channel(channel_id)
            async with self._lock:
                if channel_id in self._recorders:
                    existing = self._recorders[channel_id]
                    if existing.is_running:
                        return True
                    await existing.stop()
                    process_budget.release(self._owners.pop(channel_id, "system"))
                    del self._recorders[channel_id]
                recorder = ChannelRecorder(channel_id, source.channel.stream_url)
                if await recorder.start():
                    self._recorders[channel_id] = recorder
                    self._owners[channel_id] = owner
                    retained = True
                    return True
                return False
        finally:
            if not retained:
                if recorder is not None:
                    await recorder.stop()
                process_budget.release(owner)

    async def stop_recording(self, channel_id: str) -> None:
        """Stop recording a channel.

        Args:
            channel_id: Channel to stop recording.
        """
        async with self._lock:
            if channel_id in self._recorders:
                await self._recorders[channel_id].stop()
                del self._recorders[channel_id]
                process_budget.release(self._owners.pop(channel_id, "system"))

    async def stop_all(self) -> None:
        """Stop all recorders (for shutdown)."""
        async with self._lock:
            for channel_id, recorder in self._recorders.items():
                await recorder.stop()
                process_budget.release(self._owners.pop(channel_id, "system"))
            self._recorders.clear()

    def get_status(self, channel_id: str) -> dict:
        """Get recording status for a channel.

        Also updates last_activity timestamp to keep recording alive.

        Returns:
            Status dict with recording state and buffer info.
        """
        if not settings.highlight_enabled:
            return {"enabled": False, "recording": False, "bufferSeconds": 0}

        if channel_id not in self._recorders:
            return {"enabled": True, "recording": False, "bufferSeconds": 0}

        recorder = self._recorders[channel_id]
        # Touch to keep recording alive while being polled
        recorder.touch()
        return {
            "enabled": True,
            "recording": recorder.is_running,
            "bufferSeconds": recorder.get_buffer_seconds(),
            "maxBufferSeconds": settings.highlight_buffer_seconds,
        }

    async def save_highlight(
        self,
        channel_id: str,
        format: str = "mp4",
        start_time: float | None = None,
        end_time: float | None = None,
        owner: str = "system",
    ) -> tuple[bytes | None, str | None]:
        """Save highlight for a channel.

        Args:
            channel_id: Channel to save highlight for.
            format: Output format - "mp4" or "webm"
            start_time: Optional start time in seconds for trimming
            end_time: Optional end time in seconds for trimming

        Returns:
            Tuple of (video_bytes, error_message).
        """
        if not settings.highlight_enabled:
            return None, "Highlight feature is disabled"

        if channel_id not in self._recorders:
            return None, "No recording active for this channel"

        if format not in ("mp4", "webm"):
            return None, f"Invalid format: {format}. Use 'mp4' or 'webm'"

        recorder = self._recorders[channel_id]
        with export_budget.slot(owner):
            return await recorder.save_highlight(
                format=format, start_time=start_time, end_time=end_time
            )


# Global service instance
highlight_service = HighlightService()
