"""Chromecast streaming service using server-side FFmpeg HLS transcoding.

This service manages FFmpeg processes that transcode MPEG-TS streams to HLS
format for Chromecast playback. Chromecast devices natively support HLS but
not raw MPEG-TS, so transcoding is required for live channels from Dispatcharr.

Architecture:
- One cast session per user request (session_id = UUID)
- FFmpeg transcodes MPEG-TS to HLS segments on-demand
- Sessions are cleaned up after timeout (no segment requests)
- HLS streams (ErsatzTV) get an ErsatzTV stream session instead: no
  transcoding, no cast session
"""

import asyncio
import os
import shutil
import subprocess
import time
import uuid
from contextlib import suppress
from pathlib import Path

from loguru import logger

from app.config import settings
from app.models.channel import Channel
from app.services import stream_sessions
from app.services.highlight import RECORDER_RW_TIMEOUT_MICROSECONDS
from app.services.media_limits import process_budget

log = logger.bind(service="cast")


def monotonic() -> float:
    """The clock for session idleness, which a host clock step must not move."""
    return time.monotonic()


def ffmpeg_input_args(stream_url: str) -> list[str]:
    """FFmpeg's input options for a cast source (a test swaps in a local file)."""
    return [
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "5",
        "-rw_timeout",
        str(RECORDER_RW_TIMEOUT_MICROSECONDS),  # A silent upstream ends FFmpeg
        "-protocol_whitelist",
        "http,https,tcp,tls,crypto",
        "-i",
        stream_url,
    ]


class CastSession:
    """Manages FFmpeg HLS transcoding for a single cast session."""

    def __init__(
        self,
        session_id: str,
        channel_id: str,
        stream_url: str,
        stream_type: str,
        follows_live: bool = False,
    ):
        self.session_id = session_id
        self.channel_id = channel_id
        self.stream_url = stream_url
        self.stream_type = stream_type  # 'hls' or 'mpegts'
        # A cast of the Live slot moves with Live and stops with it
        self.follows_live = follows_live
        self.process: subprocess.Popen | None = None
        self.output_dir: Path | None = None
        self.started_at: float = 0
        self.last_activity: float = 0
        self._lock = asyncio.Lock()

    def touch(self) -> None:
        """Update last activity timestamp (called on segment/playlist access)."""
        self.last_activity = monotonic()

    @property
    def is_running(self) -> bool:
        """Check if FFmpeg process is running."""
        return self.process is not None and self.process.poll() is None

    @property
    def busy(self) -> bool:
        """True while a start, switch or stop holds the session."""
        return self._lock.locked()

    @property
    def playlist_path(self) -> Path | None:
        """Get path to the HLS playlist file."""
        if self.output_dir:
            return self.output_dir / "playlist.m3u8"
        return None

    def _ffmpeg_command(self, output_dir: Path, *, switching: bool) -> list[str]:
        """FFmpeg's command for this session's source, writing HLS into output_dir.

        A stopped FFmpeg never writes #EXT-X-ENDLIST (omit_endlist), or the
        receiver would end playback mid-switch. append_list carries on the
        existing playlist, its media sequence and segment numbers, so a switch
        never rewrites a segment; discont_start marks the new source's first one.
        """
        flags = "delete_segments+append_list+omit_endlist"
        if switching:
            flags += "+discont_start"
        return [
            "ffmpeg",
            "-y",  # Overwrite output files
            "-hide_banner",
            "-loglevel",
            "warning",
            *ffmpeg_input_args(self.stream_url),
            "-c:v",
            "copy",  # No video re-encoding (fast)
            "-c:a",
            "aac",  # Re-encode audio to AAC (Chromecast compatible)
            "-b:a",
            "128k",  # Audio bitrate
            "-f",
            "hls",
            "-hls_time",
            str(settings.cast_hls_segment_time),
            "-hls_list_size",
            str(settings.cast_hls_list_size),
            "-hls_flags",
            flags,
            "-hls_segment_filename",
            str(output_dir / "seg_%03d.ts"),
            str(output_dir / "playlist.m3u8"),
        ]

    @staticmethod
    def _spawn(cmd: list[str]) -> subprocess.Popen:
        return subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,  # Safe from worker threads; no undrained pipes
        )

    async def start(self) -> str | None:
        """Start FFmpeg HLS transcoding.

        Returns:
            Relative URL path to the HLS playlist, or None if failed.
        """
        async with self._lock:
            if self.is_running:
                log.debug("Cast session {} already running", self.session_id)
                return f"/api/cast/hls/{self.session_id}/playlist.m3u8"

            # Create output directory for HLS segments
            self.output_dir = Path(settings.cast_temp_dir) / self.session_id
            self.output_dir.mkdir(parents=True, exist_ok=True)

            cmd = self._ffmpeg_command(self.output_dir, switching=False)

            log.info(
                "Starting FFmpeg HLS transcoding for cast session {} (channel {})",
                self.session_id,
                self.channel_id,
            )
            log.debug("FFmpeg command: {}", " ".join(cmd))

            try:
                self.process = self._spawn(cmd)
                self.started_at = time.time()
                self.last_activity = monotonic()

                # Wait for FFmpeg to create the playlist (up to 10 seconds)
                for _ in range(20):
                    await asyncio.sleep(0.5)
                    if not self.is_running:
                        stderr = f"exit status {self.process.returncode}"
                        log.error("FFmpeg failed for cast session {}: {}", self.session_id, stderr)
                        return None
                    if self.playlist_path and self.playlist_path.exists():
                        log.info(
                            "FFmpeg HLS transcoding started for session {} (PID: {})",
                            self.session_id,
                            self.process.pid,
                        )
                        return f"/api/cast/hls/{self.session_id}/playlist.m3u8"

                log.error("FFmpeg did not create playlist for session {}", self.session_id)
                # Already holding the lock - use the lock-free variant
                await self._stop_locked()
                return None

            except FileNotFoundError:
                log.error("FFmpeg not found - cast feature requires FFmpeg to be installed")
                return None
            except Exception as e:
                log.error("Failed to start FFmpeg for cast session {}: {}", self.session_id, e)
                return None

    async def switch_source(self, channel_id: str, stream_url: str) -> bool:
        """Move this transcode to another source, keeping its id, directory and playlist.

        The receiver keeps fetching the same playlist: after a short stall it
        plays the new channel's segments, which follow a discontinuity.

        Returns:
            True once the new FFmpeg has written to the playlist. False if the
            session has stopped or the new FFmpeg failed; the caller stops it.
        """
        async with self._lock:
            output_dir = self.output_dir
            playlist = self.playlist_path
            if output_dir is None or playlist is None:
                return False
            if self.process:
                process = self.process
                self.process = None
                await asyncio.to_thread(self._terminate_process, process)
            self.channel_id = channel_id
            self.stream_url = stream_url

            def written() -> tuple[int, int] | None:
                with suppress(FileNotFoundError):
                    stat = playlist.stat()
                    return stat.st_ino, stat.st_mtime_ns
                return None

            before = written()
            try:
                # No await before the assignment: a stop mid-switch must find it
                self.process = self._spawn(self._ffmpeg_command(output_dir, switching=True))
            except Exception as e:
                log.error("Failed to start FFmpeg for cast session {}: {}", self.session_id, e)
                return False

            # Wait for the new FFmpeg to write to the playlist (up to 10 seconds)
            for _ in range(20):
                await asyncio.sleep(0.5)
                if not self.is_running:
                    log.error(
                        "FFmpeg failed for cast session {} on channel {}: exit status {}",
                        self.session_id,
                        channel_id,
                        self.process.returncode,
                    )
                    return False
                if written() != before:
                    return True
            log.error("FFmpeg did not write the playlist for session {}", self.session_id)
            return False

    @staticmethod
    def _terminate_process(process: subprocess.Popen) -> None:
        """Terminate an FFmpeg process group (blocking - run via asyncio.to_thread)."""
        try:
            # Send SIGTERM to process group
            os.killpg(os.getpgid(process.pid), 15)  # SIGTERM
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(os.getpgid(process.pid), 9)  # SIGKILL
                process.wait()
        except ProcessLookupError:
            pass  # Process already dead
        except Exception as e:
            log.warning("Error stopping FFmpeg process: {}", e)

    async def _stop_locked(self) -> None:
        """Stop FFmpeg transcoding and cleanup files. Caller must hold self._lock."""
        if self.process:
            log.info(
                "Stopping FFmpeg for cast session {} (PID: {})",
                self.session_id,
                self.process.pid,
            )
            process = self.process
            self.process = None
            # Killing and reaping FFmpeg blocks for up to 5s - keep it off the event loop
            await asyncio.to_thread(self._terminate_process, process)

        # Cleanup output directory
        if self.output_dir and self.output_dir.exists():
            try:
                # Recursive delete is filesystem-bound - keep it off the loop
                await asyncio.to_thread(shutil.rmtree, self.output_dir)
                log.debug("Cleaned up HLS directory for session {}", self.session_id)
            except Exception as e:
                log.warning("Failed to cleanup HLS files for session {}: {}", self.session_id, e)
            finally:
                self.output_dir = None

    async def stop(self) -> None:
        """Stop FFmpeg transcoding and cleanup files."""
        async with self._lock:
            await self._stop_locked()

    def get_file_path(self, filename: str) -> Path | None:
        """Get path to an HLS file (playlist or segment).

        Args:
            filename: Name of the file (e.g., 'playlist.m3u8' or 'seg_001.ts')

        Returns:
            Full path to the file if it exists, None otherwise.
        """
        if not self.output_dir:
            return None

        file_path = self.output_dir / filename
        if file_path.is_file():
            self.touch()  # Update activity on file access
            return file_path
        return None


class CastService:
    """Manages cast sessions and provides HLS transcoding for Chromecast."""

    def __init__(self):
        self._sessions: dict[str, CastSession] = {}
        self._owners: dict[str, str] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task | None = None

    def session_count(self) -> int:
        """Number of cast sessions, for the gauges log line."""
        return len(self._sessions)

    def start_idle_cleanup_task(self) -> None:
        """Start background task to clean up idle sessions."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._idle_cleanup_loop())
            log.debug("Started idle cast session cleanup task")

    async def stop_idle_cleanup_task(self) -> None:
        """Stop the background cleanup task and wait for it to finish."""
        task = self._cleanup_task
        if task and not task.done():
            task.cancel()
            self._cleanup_task = None
            with suppress(asyncio.CancelledError):
                await task
            log.debug("Stopped idle cast session cleanup task")

    async def _idle_cleanup_loop(self) -> None:
        """Background loop that periodically cleans up idle sessions."""
        while True:
            try:
                await asyncio.sleep(30)  # Check every 30 seconds
                await self._cleanup_idle_sessions()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.warning("Error in idle cleanup loop: {}", e)

    async def _cleanup_idle_sessions(self) -> None:
        """Stop sessions that haven't had activity recently."""
        now = monotonic()
        idle_sessions: list[str] = []

        # Find idle sessions
        for session_id, session in list(self._sessions.items()):
            if session.busy:
                continue  # Starting or switching sources: not running is expected
            if session.stream_type == "mpegts" and not session.is_running:
                idle_sessions.append(session_id)
            elif session.last_activity > 0:
                idle_time = now - session.last_activity
                if idle_time > settings.cast_session_timeout:
                    idle_sessions.append(session_id)
                    log.debug(
                        "Cast session {} idle for {:.1f}s, marking for cleanup",
                        session_id,
                        idle_time,
                    )

        # Stop idle sessions
        for session_id in idle_sessions:
            log.info("Stopping idle cast session {} (timeout)", session_id)
            await self.stop_session(session_id)

    def cleanup_stale_sessions(self) -> None:
        """Remove any stale session directories from previous runs.

        Called at startup to clean up orphaned files from crashes or unclean shutdowns.
        """
        temp_dir = Path(settings.cast_temp_dir)
        if not temp_dir.exists():
            return

        try:
            removed = 0
            for item in temp_dir.iterdir():
                if item.is_dir():
                    shutil.rmtree(item)
                    removed += 1
            if removed:
                log.info("Cleaned up {} stale cast session directories", removed)
        except Exception as e:
            log.warning("Failed to cleanup stale cast sessions: {}", e)

    async def create_session(
        self,
        channel_id: str,
        stream_url: str,
        stream_type: str,
        owner: str = "system",
        follows_live: bool = False,
    ) -> dict | None:
        """Create a new cast session with HLS transcoding.

        Args:
            channel_id: Channel being cast.
            stream_url: Source stream URL.
            stream_type: 'hls' or 'mpegts'.
            owner: The account casting.
            follows_live: Move the transcode with Live, and stop it with Live.

        Returns:
            Dict with session_id and hls_url, or None if failed.

        Raises:
            StreamSessionLimitError: an 'hls' cast found every stream session taken.
        """
        if not settings.cast_enabled:
            log.warning("Cast feature is disabled")
            return None

        if stream_type == "hls":
            # ErsatzTV already serves HLS: no FFmpeg, so no slot and no cast
            # session. The receiver plays the owner's ErsatzTV stream session,
            # which ends by idle expiry.
            stream = stream_sessions.create(owner, channel_id)
            return {
                "session_id": stream.id,
                "hls_url": stream_sessions.manifest_path(stream.id),
                "needs_transcoding": False,
            }

        # Admission is synchronous and precedes subprocess creation or queued startup.
        process_budget.acquire(owner)
        session_id = str(uuid.uuid4())
        session = CastSession(session_id, channel_id, stream_url, stream_type, follows_live)
        retained = False
        try:
            async with self._lock:
                self._sessions[session_id] = session
                self._owners[session_id] = owner
            hls_url = await session.start()
            if hls_url and self._sessions.get(session_id) is session:
                retained = True
                return {
                    "session_id": session_id,
                    "hls_url": hls_url,
                    "needs_transcoding": stream_type == "mpegts",
                }
            return None
        finally:
            if not retained:
                await session.stop()
                async with self._lock:
                    self._sessions.pop(session_id, None)
                    if session_id in self._owners:
                        process_budget.release(self._owners.pop(session_id))

    async def stop_session(self, session_id: str, owner: str | None = None) -> bool:
        """Stop a cast session and cleanup resources.

        Args:
            session_id: Session to stop.
            owner: The account asking; None for the system (idle sweep, shutdown).

        Returns:
            True if session was found and stopped, False otherwise (also when
            it belongs to someone else, so the answer reveals nothing).
        """
        async with self._lock:
            if owner is not None and self._owners.get(session_id) != owner:
                return False
            session = self._sessions.pop(session_id, None)

        # Stop outside the service lock - session.stop() waits on FFmpeg
        if session:
            try:
                await session.stop()
            finally:
                process_budget.release(self._owners.pop(session_id, "system"))
            log.info("Cast session {} stopped", session_id)
            return True
        return False

    async def follow_live(self, channel: Channel | None) -> None:
        """Move every follow-live cast to the Live channel, or stop them all with Live.

        A session whose switch fails is stopped: its receiver goes idle, and
        the sender reports that the Chromecast stopped playing.
        """
        async with self._lock:
            following = [s for s in self._sessions.values() if s.follows_live]

        async def follow(session: CastSession) -> None:
            old = session.channel_id
            short = session.session_id[:8]
            if channel is None:
                log.info("Cast session {} stops with Live ({} -> None)", short, old)
                await self.stop_session(session.session_id)
                return
            if old == channel.id:
                return
            if await session.switch_source(channel.id, channel.stream_url):
                log.info("Cast session {} follows Live ({} -> {})", short, old, channel.id)
                return
            if self._sessions.get(session.session_id) is session:
                log.info("Cast session {} could not follow Live ({} -> {})", short, old, channel.id)
                await self.stop_session(session.session_id)

        await asyncio.gather(*(follow(session) for session in following))

    async def stop_all(self) -> None:
        """Stop all sessions (for shutdown)."""
        await self.stop_idle_cleanup_task()
        async with self._lock:
            sessions = list(self._sessions.items())
            self._sessions.clear()

        async def stop(session_id: str, session: CastSession) -> None:
            try:
                await session.stop()
            finally:
                process_budget.release(self._owners.pop(session_id, "system"))

        await asyncio.gather(*(stop(session_id, session) for session_id, session in sessions))
        log.info("All cast sessions stopped")

    def get_session(self, session_id: str) -> CastSession | None:
        """Get a session by ID."""
        return self._sessions.get(session_id)

    def get_file(self, session_id: str, filename: str) -> Path | None:
        """Get an HLS file from a session.

        Args:
            session_id: Session ID.
            filename: File to retrieve.

        Returns:
            Path to the file if found, None otherwise.
        """
        session = self._sessions.get(session_id)
        if session:
            return session.get_file_path(filename)
        return None


# Global service instance
cast_service = CastService()
