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
import secrets
import shutil
import signal
import subprocess
import tempfile
import time
from contextlib import suppress
from dataclasses import dataclass, field, replace
from pathlib import Path

from loguru import logger

from app.config import settings
from app.logging_config import redact_credentials
from app.models.channel import validate_channel_id
from app.services import channel_state
from app.services.media_export import encode_file, media_duration, owned_thread, workspace
from app.services.media_limits import MediaCapacityError, export_budget, recorder_budget
from app.services.media_source import resolve_media_channel

log = logger.bind(service="highlight")


def monotonic() -> float:
    """The clock for ages and deadlines, which a host clock step must not move.

    Wall time stays where it is compared with file mtimes or shown to viewers.
    """
    return time.monotonic()


# A capture waits for the segment being written at the press to close, so the press is inside it.
# The wait is one segment plus slack, capped so a long configured segment cannot stall the editor.
TAIL_WAIT_SLACK_SECONDS = 2
TAIL_WAIT_CAP_SECONDS = 12
TAIL_POLL_SECONDS = 0.25

# FFmpeg gives up on a source that sends nothing for this long (three default segments), so a
# stalled upstream ends the process instead of leaving it "running" with no new segments.
RECORDER_RW_TIMEOUT_MICROSECONDS = 30_000_000

# FFmpeg's stderr file in the segment directory, and how much of its end a failed start logs.
STDERR_LOG_NAME = "ffmpeg.log"
STDERR_TAIL_BYTES = 500
# A recorder can run for days and some sources warn on every packet, so the sweep empties the
# file past this size; a failed start has read its tail long before.
STDERR_LOG_MAX_BYTES = 1024 * 1024

# After a failed recorder start, further starts for that channel wait: 30s, doubling to 5 minutes.
START_BACKOFF_BASE_SECONDS = 30
START_BACKOFF_MAX_SECONDS = 300

# Recorders are shared by everyone on a channel, so none is charged to the viewer who polled first.
RECORDER_OWNER = "recorder"
# With the recorder budget full, a start may evict the recorder unpolled longest if it has gone
# unpolled at least this long.
RECORDER_EVICT_UNPOLLED_SECONDS = 15


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
        self.last_activity: float = 0  # Last time this channel was polled (monotonic)
        # The newest segment mtime the stall watchdog saw, and when (monotonic) it changed
        self._newest_output: float = 0
        self._output_seen_at: float = 0
        self._lock = asyncio.Lock()

    def touch(self) -> None:
        """Update last activity timestamp (called on status poll)."""
        self.last_activity = monotonic()

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
                "-rw_timeout",
                str(RECORDER_RW_TIMEOUT_MICROSECONDS),
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
                # FFmpeg's reason for failing goes to a file, never an undrained pipe. Opened
                # for append, so after trim_stderr_log empties it the next write lands at the
                # start instead of at the old offset.
                with (self.segment_dir / STDERR_LOG_NAME).open("ab") as stderr:
                    self.process = subprocess.Popen(
                        cmd,
                        stdout=subprocess.DEVNULL,
                        stderr=stderr,
                        start_new_session=True,  # Safe from worker threads
                    )
                self.started_at = time.time()
                self.last_activity = monotonic()
                self._output_seen_at = self.last_activity

                # Give FFmpeg a moment to start and check it's running
                await asyncio.sleep(0.5)
                if not self.is_running:
                    stderr = f"exit status {self.process.returncode}"
                    # Read before the finally below removes the segment directory.
                    tail = self._stderr_tail()
                    if tail:
                        stderr = f"{stderr}: {tail}"
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

    def _stderr_tail(self) -> str:
        """The end of FFmpeg's stderr, redacted: its error lines echo the input URL."""
        if not self.segment_dir:
            return ""
        try:
            with (self.segment_dir / STDERR_LOG_NAME).open("rb") as file:
                file.seek(max(file.seek(0, os.SEEK_END) - STDERR_TAIL_BYTES, 0))
                tail = file.read()
        except OSError:
            return ""
        return str(redact_credentials(tail.decode("utf-8", "replace").strip()))

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

            # owned_thread waits out a cancellation, so a cancelled stop still
            # signals FFmpeg. The handle is dropped only once the terminate ran.
            try:
                await owned_thread(terminate_process)
            except ProcessLookupError:
                pass  # Process already dead
            except Exception as e:
                log.warning("Error stopping FFmpeg process: {}", e)
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

    def has_completed_segment(self) -> bool:
        """An active recorder can still be warming up its first usable segment."""
        if not self.is_running or not self.segment_dir:
            return False
        try:
            entries = (self.segment_dir / "segments.txt").read_text().splitlines()
            if not entries:
                return False
            name = Path(entries[-1]).name
            if not name.startswith("seg_") or not name.endswith(".ts"):
                return False
            path = self.segment_dir / name
            return (
                not path.is_symlink()
                and path.is_file()
                and path.stat().st_size > 0
                and path.stat().st_mtime >= time.time() - settings.highlight_buffer_seconds
            )
        except OSError:
            return False

    def trim_stderr_log(self) -> None:
        """Empty FFmpeg's stderr file once it passes STDERR_LOG_MAX_BYTES."""
        if not self.segment_dir:
            return
        path = self.segment_dir / STDERR_LOG_NAME
        with suppress(OSError):
            if path.stat().st_size > STDERR_LOG_MAX_BYTES:
                os.truncate(path, 0)

    def seconds_since_output(self) -> float:
        """How long since a new segment appeared, or since start before the first one.

        Segment mtimes are wall time, so they only tell whether output changed; the
        interval is timed on the monotonic clock, which a host clock step cannot move.
        """
        newest = 0.0
        if self.segment_dir:
            with suppress(OSError):
                newest = max(
                    (path.stat().st_mtime for path in self.segment_dir.glob("seg_*.ts")),
                    default=0.0,
                )
        now = monotonic()
        if newest != self._newest_output:
            self._newest_output = newest
            self._output_seen_at = now
        return now - self._output_seen_at

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
            span = time.time() - oldest_mtime + settings.highlight_segment_seconds
            return min(span, settings.highlight_buffer_seconds)
        except OSError:
            # Fallback to wall-clock if file inspection fails
            elapsed = time.time() - self.started_at
            return min(elapsed, settings.highlight_buffer_seconds)

    def _newest_listed_segment(self) -> str | None:
        """The segment muxer lists a segment only once it is closed."""
        if not self.segment_dir:
            return None
        try:
            entries = (self.segment_dir / "segments.txt").read_text().splitlines()
        except OSError:
            return None
        return entries[-1] if entries else None

    async def wait_for_current_segment(self) -> bool:
        """Wait, bounded, until the segment being written now is closed and listed.

        Returns False when the wait timed out (a stalled stream) or the recorder stopped;
        the capture then ends at the last closed segment, as before.
        """
        # The list is read in a worker thread, like the rest of the recorder's file I/O.
        listed = await asyncio.to_thread(self._newest_listed_segment)
        limit = min(
            settings.highlight_segment_seconds + TAIL_WAIT_SLACK_SECONDS, TAIL_WAIT_CAP_SECONDS
        )
        deadline = time.monotonic() + limit
        while time.monotonic() < deadline:
            await asyncio.sleep(TAIL_POLL_SECONDS)
            if not self.is_running:
                return False
            if await asyncio.to_thread(self._newest_listed_segment) != listed:
                return True
        log.info(
            "Capture on channel {} stopped waiting for a segment after {}s", self.channel_id, limit
        )
        return False

    def _snapshot(self, workspace: Path) -> tuple[Path, float]:
        """Copy completed segments while producer is paused and lifecycle locked.

        Returns the concat list and the wall-clock time the newest copied segment ends.
        """
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
            # The segment being written is left out, so the capture ends this long before the
            # snapshot. Captures first wait for the segment written at the press to close, so
            # this is near zero for them; highlight.capture_ready logs the gap to the press.
            ends_at = paths[-1].stat().st_mtime
            before_snapshot = time.time() - ends_at
            if sum(path.stat().st_size for path in paths) > settings.media_export_max_bytes:
                raise ValueError("Highlight exceeds export size limit")
            names = []
            for index, path in enumerate(paths):
                name = f"input_{index:03d}.ts"
                shutil.copyfile(path, workspace / name)
                names.append(name)
            concat = workspace / "concat.txt"
            concat.write_text("".join(f"file '{name}'\n" for name in names))
            log.bind(
                event="highlight.capture",
                channel_id=self.channel_id,
                segments=len(paths),
                ends_before_snapshot_seconds=round(before_snapshot, 2),
            ).info(
                "Highlight capture of {} segments ends {:.1f}s before the snapshot",
                len(paths),
                before_snapshot,
            )
            return concat, ends_at
        finally:
            with suppress(ProcessLookupError):
                os.killpg(producer_pid, signal.SIGCONT)

    async def capture(self, output: Path) -> float:
        """Remux the private snapshot into an immutable MP4 the editor streams by URL.

        Returns the wall-clock time the capture ends (its newest segment's mtime).
        """
        async with workspace("highlight-capture-") as directory:
            async with self._lock:
                if not self.is_running or not self.segment_dir:
                    raise ValueError("Recorder not running")
                concat, ends_at = await owned_thread(self._snapshot, directory)
            await encode_file(concat, output, "mp4", None, None, concat=True)
        return ends_at


# Idle timeout for recordings - stop if no status polls for this duration.
# With always-on polling from the frontend, this is a safety net for
# edge cases like browser tab closure or network disconnects.
RECORDER_IDLE_TIMEOUT = 120

# A polled recorder that has written no segment for 3 segment lengths, and at least this
# long (warm-up included), is stalled and gets stopped.
RECORDER_STALL_MIN_SECONDS = 30

# Captures outlive the editor session by a margin; closing the editor deletes them early.
CAPTURE_TTL_SECONDS = 15 * 60

# A download link only has to last until the browser follows it.
DOWNLOAD_TOKEN_TTL_SECONDS = 60

# One Plex account on a phone and a TV clips independently; the oldest capture goes past this.
MAX_CAPTURES_PER_OWNER = 3

# The recorder was stopped (idle sweep, eviction, shutdown) while a capture waited on it.
RECORDER_GONE_ERROR = "Live TV changed while clipping; press Clip again"

# Shown for any filesystem failure (a full disk, say) instead of its path-bearing text.
CLIP_SAVE_ERROR = "Could not save the clip on the server"


@dataclass(frozen=True)
class Capture:
    """An immutable snapshot held on disk for one owner."""

    id: str
    owner: str
    channel_id: str
    path: Path
    size: int
    duration: float
    created_at: float
    # Server time of the request, and the wall-clock time the capture's last frame was recorded:
    # the editor places the press at duration - (ends_at - pressed_at).
    pressed_at: float
    ends_at: float
    # created_at is shown to the viewer; the TTL is judged on the monotonic clock.
    created_mono: float = field(default_factory=lambda: monotonic())

    @property
    def expires_at(self) -> float:
        return self.created_at + CAPTURE_TTL_SECONDS

    def expired(self, now: float) -> bool:
        return self.created_mono + CAPTURE_TTL_SECONDS <= now


@dataclass(frozen=True)
class DownloadToken:
    """A single-use grant to download one owner's capture without their session token.

    After the first download it still serves Range requests until it expires, so the
    browser can resume an interrupted download.
    """

    capture_id: str
    owner: str
    expires_at: float  # monotonic
    redeemed: bool = False


@dataclass(frozen=True)
class PreviewGrant:
    """A reusable grant to stream one owner's capture: it lives exactly as long as the capture."""

    capture_id: str
    owner: str


class CaptureStore:
    """Server-held snapshots: the browser streams them by range instead of downloading."""

    def __init__(self):
        self.captures: dict[str, Capture] = {}
        self.download_tokens: dict[str, DownloadToken] = {}
        self.preview_tokens: dict[str, PreviewGrant] = {}

    async def create(
        self, recorder: ChannelRecorder, owner: str, channel_id: str, pressed_at: float
    ) -> Capture:
        root = Path(settings.highlight_temp_dir) / "captures"
        root.mkdir(parents=True, exist_ok=True)
        capture_id = secrets.token_urlsafe(16)
        directory = root / capture_id
        directory.mkdir(mode=0o700)
        path = directory / "snapshot.mp4"
        try:
            ends_at = await recorder.capture(path)
            duration = await media_duration(path)
            size = await owned_thread(lambda: path.stat().st_size)
        except BaseException:
            await asyncio.to_thread(remove_recording_directory, directory)
            raise
        # A few captures per owner bound disk use to a few export-sized files each.
        previous = [item for item in self.captures.values() if item.owner == owner]
        for oldest in previous[: max(len(previous) - MAX_CAPTURES_PER_OWNER + 1, 0)]:
            await self._remove(oldest)
        capture = Capture(
            capture_id,
            owner,
            channel_id,
            path,
            size,
            duration,
            time.time(),
            pressed_at,
            ends_at,
            monotonic(),
        )
        self.captures[capture_id] = capture
        log.bind(
            event="highlight.capture_ready",
            channel_id=channel_id,
            ends_after_press_seconds=round(ends_at - pressed_at, 2),
        ).info(
            "Capture {} ready for {} ({:.1f}s, {:.1f} KB), ends {:+.1f}s after the press",
            capture_id,
            owner,
            duration,
            size / 1024,
            ends_at - pressed_at,
        )
        return capture

    def get(self, capture_id: str, owner: str) -> Capture | None:
        """Foreign or expired captures are indistinguishable from unknown ones."""
        capture = self.captures.get(capture_id)
        if capture is None or capture.owner != owner or capture.expired(monotonic()):
            return None
        return capture

    def issue_download_token(self, capture_id: str, owner: str) -> str | None:
        """A plain link for the browser's download manager, which cannot send the JWT header.

        Keeps the session token out of the URL, download history and proxy logs.
        """
        if self.get(capture_id, owner) is None:
            return None
        self._drop_expired_tokens(monotonic())
        token = secrets.token_urlsafe(24)
        self.download_tokens[token] = DownloadToken(
            capture_id, owner, monotonic() + DOWNLOAD_TOKEN_TTL_SECONDS
        )
        return token

    def redeem_download_token(self, token: str, range_request: bool = False) -> Capture | None:
        """Spend the token on the first download; later, only Range requests find the capture.

        A resumed download is served until the token expires; a plain replay, an expired
        token or a gone capture finds nothing.
        """
        grant = self.download_tokens.get(token)
        if grant is None or grant.expires_at <= monotonic():
            self.download_tokens.pop(token, None)
            return None
        if grant.redeemed and not range_request:
            return None
        self.download_tokens[token] = replace(grant, redeemed=True)
        return self.get(grant.capture_id, grant.owner)

    def issue_preview_token(self, capture_id: str, owner: str) -> str | None:
        """A path for the editor's <video>, which cannot send the JWT header on Range requests.

        One token per capture; it keeps the session token out of the URL and proxy logs.
        """
        if self.get(capture_id, owner) is None:
            return None
        for token, grant in self.preview_tokens.items():
            if grant.capture_id == capture_id:
                return token
        token = secrets.token_urlsafe(24)
        self.preview_tokens[token] = PreviewGrant(capture_id, owner)
        return token

    def redeem_preview_token(self, token: str) -> Capture | None:
        """Any number of requests; the capture's TTL, delete or eviction ends the token."""
        grant = self.preview_tokens.get(token)
        if grant is None:
            return None
        return self.get(grant.capture_id, grant.owner)

    async def delete(self, capture_id: str, owner: str) -> None:
        capture = self.captures.get(capture_id)
        if capture is not None and capture.owner == owner:
            await self._remove(capture)

    async def sweep(self, now: float | None = None) -> None:
        now = monotonic() if now is None else now
        self._drop_expired_tokens(now)
        for capture in list(self.captures.values()):
            if capture.expired(now):
                await self._remove(capture)

    def _drop_expired_tokens(self, now: float) -> None:
        for token, grant in list(self.download_tokens.items()):
            if grant.expires_at <= now:
                del self.download_tokens[token]

    async def clear(self) -> None:
        for capture in list(self.captures.values()):
            await self._remove(capture)
        self.preview_tokens.clear()

    async def _remove(self, capture: Capture) -> None:
        self.captures.pop(capture.id, None)
        for token, grant in list(self.download_tokens.items()):
            if grant.capture_id == capture.id:
                del self.download_tokens[token]
        for token, grant in list(self.preview_tokens.items()):
            if grant.capture_id == capture.id:
                del self.preview_tokens[token]
        try:
            await asyncio.to_thread(remove_recording_directory, capture.path.parent)
        except OSError as exc:
            log.warning("Failed to remove capture {}: {}", capture.id, exc)


class HighlightService:
    """Manages channel recorders and provides highlight capture functionality."""

    def __init__(self):
        self._recorders: dict[str, ChannelRecorder] = {}
        self._owners: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task | None = None
        self.captures = CaptureStore()
        # channel_id -> (consecutive failed starts, monotonic time the next start may try)
        self._start_failures: dict[str, tuple[int, float]] = {}

    def recorder_counts(self) -> tuple[int, int]:
        """(running, not running) recorders, for the gauges log line."""
        running = sum(recorder.is_running for recorder in self._recorders.values())
        return running, len(self._recorders) - running

    def clear_start_backoff(self) -> None:
        """Forget failed starts so the next start for any channel tries at once."""
        self._start_failures.clear()

    def _in_start_backoff(self, channel_id: str) -> bool:
        failure = self._start_failures.get(channel_id)
        return failure is not None and time.monotonic() < failure[1]

    def _record_start_failure(self, channel_id: str) -> None:
        failures = self._start_failures.get(channel_id, (0, 0.0))[0] + 1
        delay = min(START_BACKOFF_BASE_SECONDS * 2 ** (failures - 1), START_BACKOFF_MAX_SECONDS)
        self._start_failures[channel_id] = (failures, time.monotonic() + delay)

    def start_idle_cleanup_task(self) -> None:
        """Start background task to clean up idle recorders."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._idle_cleanup_loop())
            log.debug("Started idle recorder cleanup task")

    async def stop_idle_cleanup_task(self) -> None:
        """Stop the background cleanup task and wait for it to finish."""
        task = self._cleanup_task
        if task and not task.done():
            task.cancel()
            self._cleanup_task = None
            with suppress(asyncio.CancelledError):
                await task
            log.debug("Stopped idle recorder cleanup task")

    async def _idle_cleanup_loop(self) -> None:
        """Background loop that periodically cleans up idle recorders."""
        while True:
            try:
                await asyncio.sleep(10)  # Check every 10 seconds
                await self._cleanup_idle_recorders()
                await self.captures.sweep()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.warning("Error in idle cleanup loop: {}", e)

    async def _cleanup_idle_recorders(self) -> None:
        """Stop recorders that haven't been polled recently."""
        now = monotonic()
        idle_channels: list[str] = []

        # A running FFmpeg whose upstream went quiet writes nothing; past warm-up, restart it.
        stall_limit = max(3 * settings.highlight_segment_seconds, RECORDER_STALL_MIN_SECONDS)

        # Find idle recorders (without holding lock during iteration)
        for channel_id, recorder in list(self._recorders.items()):
            if not recorder.is_running:
                idle_channels.append(channel_id)
                continue
            if recorder.last_activity > 0:
                idle_time = now - recorder.last_activity
                if idle_time > RECORDER_IDLE_TIMEOUT:
                    idle_channels.append(channel_id)
                    log.debug(
                        "Channel {} idle for {:.1f}s, marking for cleanup",
                        channel_id,
                        idle_time,
                    )
                    continue
            await asyncio.to_thread(recorder.trim_stderr_log)
            silent = await asyncio.to_thread(recorder.seconds_since_output)
            if silent > stall_limit:
                idle_channels.append(channel_id)
                log.bind(
                    event="highlight.recorder_stalled",
                    channel_id=channel_id,
                    silent_seconds=round(silent, 1),
                ).warning(
                    "Recorder for channel {} wrote nothing for {:.0f}s; stopping it so the "
                    "next poll restarts it",
                    channel_id,
                    silent,
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
            owner: Ignored; recorders are charged to RECORDER_OWNER, not to a viewer.

        Returns:
            True if recorder is running (started or already running). False if
            optional recording cannot start, including when capacity is full.
        """
        if not settings.highlight_enabled:
            log.debug("Highlight feature disabled, not starting recorder")
            return False

        if channel_id in self._recorders and self._recorders[channel_id].is_running:
            return True
        # A channel whose FFmpeg just failed waits out its backoff instead of respawning per poll.
        if self._in_start_backoff(channel_id):
            return False
        # Reserve before any awaited work: overload never queues behind startup.
        if not await self._reserve_recorder_slot(channel_id):
            # Recording is optional; normal status polling and channel changes
            # must continue while recorders occupy the available slots.
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
                    recorder_budget.release(self._owners.pop(channel_id, RECORDER_OWNER))
                    del self._recorders[channel_id]
                # A concurrent poll may have failed this channel while we waited for the lock.
                if self._in_start_backoff(channel_id):
                    return False
                recorder = ChannelRecorder(channel_id, source.channel.stream_url)
                if await recorder.start():
                    self._start_failures.pop(channel_id, None)
                    self._recorders[channel_id] = recorder
                    self._owners[channel_id] = RECORDER_OWNER
                    retained = True
                    return True
                self._record_start_failure(channel_id)
                return False
        finally:
            if not retained:
                if recorder is not None:
                    await recorder.stop()
                recorder_budget.release(RECORDER_OWNER)

    async def _reserve_recorder_slot(self, channel_id: str) -> bool:
        """Take a recorder slot, evicting the recorder unpolled longest when the budget is full.

        Only a recorder unpolled for RECORDER_EVICT_UNPOLLED_SECONDS qualifies, and never the
        channel being started or the Live channel, which everyone is about to watch.
        """
        try:
            recorder_budget.acquire(RECORDER_OWNER)
            return True
        except MediaCapacityError:
            pass
        live = channel_state.get_current_channel()
        cutoff = monotonic() - RECORDER_EVICT_UNPOLLED_SECONDS
        candidates = [
            (recorder.last_activity, other)
            for other, recorder in self._recorders.items()
            if other != channel_id
            and (live is None or other != live.id)
            and recorder.last_activity <= cutoff
        ]
        if not candidates:
            return False
        _, evicted = min(candidates)
        log.info("Stopping recorder for channel {} to record channel {}", evicted, channel_id)
        await self.stop_recording(evicted)
        try:
            recorder_budget.acquire(RECORDER_OWNER)
            return True
        except MediaCapacityError:
            return False

    async def stop_recording(self, channel_id: str) -> None:
        """Stop recording a channel.

        Args:
            channel_id: Channel to stop recording.
        """
        async with self._lock:
            if channel_id in self._recorders:
                await self._recorders[channel_id].stop()
                del self._recorders[channel_id]
                recorder_budget.release(self._owners.pop(channel_id, RECORDER_OWNER))

    async def stop_all(self) -> None:
        """Stop all recorders (for shutdown), concurrently so slow exits overlap."""
        async with self._lock:
            recorders = list(self._recorders.items())
            self._recorders.clear()

        async def stop(channel_id: str, recorder: ChannelRecorder) -> None:
            try:
                await recorder.stop()
            finally:
                recorder_budget.release(self._owners.pop(channel_id, RECORDER_OWNER))

        await asyncio.gather(*(stop(channel_id, recorder) for channel_id, recorder in recorders))
        await self.captures.clear()

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
            "ready": recorder.has_completed_segment(),
            "bufferSeconds": recorder.get_buffer_seconds(),
            "maxBufferSeconds": settings.highlight_buffer_seconds,
        }

    async def create_capture(
        self, channel_id: str, owner: str
    ) -> tuple[Capture | None, str | None]:
        """Snapshot the channel into a server-held capture the owner can stream and export."""
        pressed_at = time.time()
        if not settings.highlight_enabled:
            return None, "Highlight feature is disabled"
        if channel_id not in self._recorders:
            return None, "No recording active for this channel"
        recorder = self._recorders[channel_id]
        # Waited outside the export slot: only two exist server-wide, and waiting encodes nothing.
        await recorder.wait_for_current_segment()
        # Everyone who clipped the same moment finishes the wait together, so queue briefly.
        async with export_budget.waiting_slot(owner):
            # Look the recorder up again: it may have been stopped, or replaced, while we waited.
            recorder = self._recorders.get(channel_id)
            if recorder is None or not recorder.is_running:
                return None, RECORDER_GONE_ERROR
            try:
                return await self.captures.create(recorder, owner, channel_id, pressed_at), None
            except TimeoutError:
                return None, "Highlight creation timed out"
            except OSError as exc:
                # The text names server paths; the errno (ENOSPC above all) is what matters.
                log.bind(
                    event="highlight.capture_failed", channel_id=channel_id, errno=exc.errno
                ).warning("Highlight capture failed: {}", exc)
                return None, CLIP_SAVE_ERROR
            except ValueError as exc:
                log.warning("Highlight capture failed: {}", exc)
                return None, str(exc)

    def get_capture(self, capture_id: str, owner: str) -> Capture | None:
        return self.captures.get(capture_id, owner)

    async def delete_capture(self, capture_id: str, owner: str) -> None:
        await self.captures.delete(capture_id, owner)

    def issue_download_token(self, capture_id: str, owner: str) -> str | None:
        return self.captures.issue_download_token(capture_id, owner)

    def redeem_download_token(self, token: str, range_request: bool = False) -> Capture | None:
        return self.captures.redeem_download_token(token, range_request)

    def issue_preview_token(self, capture_id: str, owner: str) -> str | None:
        return self.captures.issue_preview_token(capture_id, owner)

    def redeem_preview_token(self, token: str) -> Capture | None:
        return self.captures.redeem_preview_token(token)


# Global service instance
highlight_service = HighlightService()
