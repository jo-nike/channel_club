"""Chromecast streaming service using server-side FFmpeg HLS transcoding.

This service manages FFmpeg processes that transcode MPEG-TS streams to HLS
format for Chromecast playback. Chromecast devices natively support HLS but
not raw MPEG-TS, so transcoding is required for live channels from Dispatcharr.

Architecture:
- One cast session per user request (session_id = UUID)
- FFmpeg transcodes MPEG-TS to HLS segments on-demand
- Sessions are cleaned up after timeout (no segment requests)
- HLS streams (ErsatzTV) are returned directly without transcoding
"""

import asyncio
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from loguru import logger

from app.config import settings

log = logger.bind(service="cast")


class CastSession:
    """Manages FFmpeg HLS transcoding for a single cast session."""

    def __init__(self, session_id: str, channel_id: str, stream_url: str, stream_type: str):
        self.session_id = session_id
        self.channel_id = channel_id
        self.stream_url = stream_url
        self.stream_type = stream_type  # 'hls' or 'mpegts'
        self.process: subprocess.Popen | None = None
        self.output_dir: Path | None = None
        self.started_at: float = 0
        self.last_activity: float = 0
        self._lock = asyncio.Lock()

    def touch(self) -> None:
        """Update last activity timestamp (called on segment/playlist access)."""
        self.last_activity = time.time()

    @property
    def is_running(self) -> bool:
        """Check if FFmpeg process is running."""
        return self.process is not None and self.process.poll() is None

    @property
    def playlist_path(self) -> Path | None:
        """Get path to the HLS playlist file."""
        if self.output_dir:
            return self.output_dir / "playlist.m3u8"
        return None

    async def start(self) -> str | None:
        """Start FFmpeg HLS transcoding.

        Returns:
            Relative URL path to the HLS playlist, or None if failed.
        """
        async with self._lock:
            if self.is_running:
                log.debug("Cast session {} already running", self.session_id)
                return f"/api/cast/hls/{self.session_id}/playlist.m3u8"

            # For HLS streams, no transcoding needed - return source URL directly
            if self.stream_type == "hls":
                log.info("HLS stream for session {} - no transcoding needed", self.session_id)
                self.last_activity = time.time()
                return self.stream_url

            # Create output directory for HLS segments
            self.output_dir = Path(settings.cast_temp_dir) / self.session_id
            self.output_dir.mkdir(parents=True, exist_ok=True)

            # Build FFmpeg command for HLS output
            playlist_path = str(self.output_dir / "playlist.m3u8")
            segment_pattern = str(self.output_dir / "seg_%03d.ts")

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
                "delete_segments+append_list",
                "-hls_segment_filename",
                segment_pattern,
                playlist_path,
            ]

            log.info(
                "Starting FFmpeg HLS transcoding for cast session {} (channel {})",
                self.session_id,
                self.channel_id,
            )
            log.debug("FFmpeg command: {}", " ".join(cmd))

            try:
                self.process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    preexec_fn=os.setsid,  # Create new process group for clean cleanup
                )
                self.started_at = time.time()
                self.last_activity = time.time()

                # Wait for FFmpeg to create the playlist (up to 10 seconds)
                for _ in range(20):
                    await asyncio.sleep(0.5)
                    if not self.is_running:
                        stderr = self.process.stderr.read().decode() if self.process.stderr else ""
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
                shutil.rmtree(self.output_dir)
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
        if file_path.exists():
            self.touch()  # Update activity on file access
            return file_path
        return None


class CastService:
    """Manages cast sessions and provides HLS transcoding for Chromecast."""

    def __init__(self):
        self._sessions: dict[str, CastSession] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task | None = None

    def start_idle_cleanup_task(self) -> None:
        """Start background task to clean up idle sessions."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._idle_cleanup_loop())
            log.debug("Started idle cast session cleanup task")

    def stop_idle_cleanup_task(self) -> None:
        """Stop the background cleanup task."""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            self._cleanup_task = None
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
        now = time.time()
        idle_sessions: list[str] = []

        # Find idle sessions
        for session_id, session in list(self._sessions.items()):
            if session.last_activity > 0:
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
        # First kill any orphan FFmpeg processes
        self._cleanup_orphan_processes()

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

    def _cleanup_orphan_processes(self) -> None:
        """Kill any orphan FFmpeg processes from previous runs."""
        cast_dir = settings.cast_temp_dir
        killed = 0

        try:
            result = subprocess.run(
                ["pgrep", "-f", f"ffmpeg.*{cast_dir}"],
                capture_output=True,
                text=True,
            )

            if result.returncode == 0 and result.stdout.strip():
                pids = result.stdout.strip().split("\n")
                for pid_str in pids:
                    try:
                        pid = int(pid_str.strip())
                        try:
                            os.killpg(os.getpgid(pid), 15)  # SIGTERM
                            killed += 1
                            log.debug("Killed orphan FFmpeg process {}", pid)
                        except ProcessLookupError:
                            pass
                        except PermissionError:
                            log.warning("No permission to kill process {}", pid)
                    except ValueError:
                        continue

                if killed:
                    log.info("Killed {} orphan FFmpeg processes", killed)

        except FileNotFoundError:
            log.debug("pgrep not available, skipping orphan process cleanup")
        except Exception as e:
            log.warning("Failed to cleanup orphan processes: {}", e)

    async def create_session(
        self, channel_id: str, stream_url: str, stream_type: str
    ) -> dict | None:
        """Create a new cast session with HLS transcoding.

        Args:
            channel_id: Channel being cast.
            stream_url: Source stream URL.
            stream_type: 'hls' or 'mpegts'.

        Returns:
            Dict with session_id and hls_url, or None if failed.
        """
        if not settings.cast_enabled:
            log.warning("Cast feature is disabled")
            return None

        session_id = str(uuid.uuid4())
        session = CastSession(session_id, channel_id, stream_url, stream_type)

        # Only track sessions that need transcoding. Registered before start() so
        # shutdown/stop can still reach an FFmpeg process that is coming up.
        if stream_type == "mpegts":
            async with self._lock:
                self._sessions[session_id] = session

        # Never hold the service lock across start() - it can take up to 10s and
        # would block stop_session/stop_all/idle cleanup for the duration.
        hls_url = await session.start()

        if hls_url:
            return {
                "session_id": session_id,
                "hls_url": hls_url,
                "needs_transcoding": stream_type == "mpegts",
            }

        async with self._lock:
            self._sessions.pop(session_id, None)
        return None

    async def stop_session(self, session_id: str) -> bool:
        """Stop a cast session and cleanup resources.

        Args:
            session_id: Session to stop.

        Returns:
            True if session was found and stopped, False otherwise.
        """
        async with self._lock:
            session = self._sessions.pop(session_id, None)

        # Stop outside the service lock - session.stop() waits on FFmpeg
        if session:
            await session.stop()
            log.info("Cast session {} stopped", session_id)
            return True
        return False

    async def stop_all(self) -> None:
        """Stop all sessions (for shutdown)."""
        self.stop_idle_cleanup_task()
        async with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()

        for session in sessions:
            await session.stop()
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
