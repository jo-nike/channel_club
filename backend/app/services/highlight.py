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
import subprocess
import time
from pathlib import Path

from loguru import logger

from app.config import settings

log = logger.bind(service="highlight")


def get_ersatztv_stream_url(channel_id: str) -> str | None:
    """Get direct ErsatzTV HLS stream URL for a channel by looking it up.

    Args:
        channel_id: ErsatzTV channel ID.

    Returns:
        Direct HLS stream URL if found, None otherwise.
    """
    # Import here to avoid circular dependency
    from app.services.ersatztv import get_channel_by_id

    channel = get_channel_by_id(channel_id)
    if channel:
        log.debug("Found ErsatzTV channel: {} -> {}", channel_id, channel.stream_url)
        return channel.stream_url
    return None


class ChannelRecorder:
    """Manages FFmpeg recording for a single channel."""

    def __init__(self, channel_id: str, stream_url: str):
        self.channel_id = channel_id
        self.stream_url = stream_url
        self.process: subprocess.Popen | None = None
        self.segment_dir: Path | None = None
        self.started_at: float = 0
        self._lock = asyncio.Lock()

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
            self.segment_dir = Path(settings.highlight_temp_dir) / self.channel_id
            self.segment_dir.mkdir(parents=True, exist_ok=True)

            # Build FFmpeg command for HLS segment recording
            # Uses segment muxer to create rolling segments
            segment_pattern = str(self.segment_dir / "seg_%03d.ts")
            segment_list = str(self.segment_dir / "segments.txt")

            cmd = [
                "ffmpeg",
                "-y",  # Overwrite output files
                "-hide_banner",
                "-loglevel", "warning",
                "-reconnect", "1",
                "-reconnect_streamed", "1",
                "-reconnect_delay_max", "5",
                "-i", self.stream_url,
                "-c", "copy",  # No re-encoding - copy codec
                "-f", "segment",
                "-segment_time", str(settings.highlight_segment_seconds),
                "-segment_list", segment_list,
                "-segment_list_type", "flat",
                "-segment_wrap", str(
                    (settings.highlight_buffer_seconds // settings.highlight_segment_seconds) + 2
                ),  # Number of segments to keep before wrapping
                "-reset_timestamps", "1",
                segment_pattern,
            ]

            log.info(
                "Starting FFmpeg recorder for channel {} with {} second buffer",
                self.channel_id,
                settings.highlight_buffer_seconds,
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

                # Give FFmpeg a moment to start and check it's running
                await asyncio.sleep(0.5)
                if not self.is_running:
                    stderr = self.process.stderr.read().decode() if self.process.stderr else ""
                    log.error("FFmpeg failed to start for channel {}: {}", self.channel_id, stderr)
                    return False

                log.info(
                    "FFmpeg recorder started for channel {} (PID: {})",
                    self.channel_id,
                    self.process.pid,
                )
                return True

            except FileNotFoundError:
                log.error("FFmpeg not found - highlight feature requires FFmpeg to be installed")
                return False
            except Exception as e:
                log.error("Failed to start FFmpeg for channel {}: {}", self.channel_id, e)
                return False

    async def stop(self) -> None:
        """Stop FFmpeg recording and cleanup."""
        async with self._lock:
            if self.process:
                log.info(
                    "Stopping FFmpeg recorder for channel {} (PID: {})",
                    self.channel_id,
                    self.process.pid,
                )
                try:
                    # Send SIGTERM to process group
                    os.killpg(os.getpgid(self.process.pid), 15)  # SIGTERM
                    try:
                        self.process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(os.getpgid(self.process.pid), 9)  # SIGKILL
                        self.process.wait()
                except ProcessLookupError:
                    pass  # Process already dead
                except Exception as e:
                    log.warning("Error stopping FFmpeg process: {}", e)
                finally:
                    self.process = None

            # Cleanup segment directory
            if self.segment_dir and self.segment_dir.exists():
                try:
                    shutil.rmtree(self.segment_dir)
                    log.debug("Cleaned up segment directory for channel {}", self.channel_id)
                except Exception as e:
                    log.warning("Failed to cleanup segments for channel {}: {}", self.channel_id, e)
                finally:
                    self.segment_dir = None

    def get_buffer_seconds(self) -> float:
        """Get how many seconds have been recorded so far."""
        if not self.is_running or not self.segment_dir:
            return 0

        elapsed = time.time() - self.started_at
        return min(elapsed, settings.highlight_buffer_seconds)

    async def save_highlight(self) -> tuple[bytes | None, str | None]:
        """Extract and return the current highlight buffer as MP4.

        Returns:
            Tuple of (mp4_bytes, error_message). If successful, error is None.
        """
        if not self.is_running or not self.segment_dir:
            return None, "Recorder not running"

        segment_list = self.segment_dir / "segments.txt"
        if not segment_list.exists():
            return None, "No segments recorded yet"

        # Read segment list and get recent segments
        try:
            segments = segment_list.read_text().strip().split("\n")
            segments = [s.strip() for s in segments if s.strip()]
        except Exception as e:
            log.error("Failed to read segment list: {}", e)
            return None, "Failed to read segments"

        if not segments:
            return None, "No segments recorded yet"

        # Deduplicate and collect unique segment files
        # (segments.txt grows indefinitely with duplicate entries after wrap)
        seen_segments: set[Path] = set()
        existing_segments: list[Path] = []
        for seg_name in segments:
            seg_path = self.segment_dir / seg_name
            if seg_path.exists() and seg_path not in seen_segments:
                seen_segments.add(seg_path)
                existing_segments.append(seg_path)

        if not existing_segments:
            return None, "No segment files found"

        # Sort by modification time (oldest first for correct playback order)
        existing_segments.sort(key=lambda p: p.stat().st_mtime)

        # Filter to only segments within the buffer window
        cutoff_time = time.time() - settings.highlight_buffer_seconds
        existing_segments = [
            seg for seg in existing_segments
            if seg.stat().st_mtime >= cutoff_time
        ]

        if not existing_segments:
            return None, "No recent segments available"

        log.info(
            "Saving highlight for channel {} ({} segments)",
            self.channel_id,
            len(existing_segments),
        )

        # Create concat file for FFmpeg
        concat_file = self.segment_dir / "concat.txt"
        try:
            with open(concat_file, "w") as f:
                for seg_path in existing_segments:
                    f.write(f"file '{seg_path}'\n")

            # Concatenate segments and remux to MP4
            output_file = self.segment_dir / "highlight.mp4"

            cmd = [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel", "warning",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_file),
                "-c", "copy",  # No re-encoding
                "-movflags", "+faststart",  # Optimize for streaming
                str(output_file),
            ]

            log.debug("FFmpeg concat command: {}", " ".join(cmd))

            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=30,
            )

            if result.returncode != 0:
                log.error("FFmpeg concat failed: {}", result.stderr.decode())
                return None, "Failed to create highlight"

            if not output_file.exists():
                return None, "Highlight file not created"

            # Read the MP4 file
            mp4_bytes = output_file.read_bytes()
            log.info(
                "Highlight saved for channel {} ({:.1f} KB)",
                self.channel_id,
                len(mp4_bytes) / 1024,
            )

            # Cleanup temporary files
            concat_file.unlink(missing_ok=True)
            output_file.unlink(missing_ok=True)

            return mp4_bytes, None

        except subprocess.TimeoutExpired:
            log.error("FFmpeg concat timed out for channel {}", self.channel_id)
            return None, "Highlight creation timed out"
        except Exception as e:
            log.error("Failed to save highlight for channel {}: {}", self.channel_id, e)
            return None, f"Error: {e}"


class HighlightService:
    """Manages channel recorders and provides highlight capture functionality."""

    def __init__(self):
        self._recorders: dict[str, ChannelRecorder] = {}
        self._lock = asyncio.Lock()

    def cleanup_stale_segments(self) -> None:
        """Remove any stale segment directories from previous runs.

        Called at startup to clean up orphaned files from crashes or unclean shutdowns.
        """
        temp_dir = Path(settings.highlight_temp_dir)
        if not temp_dir.exists():
            return

        try:
            removed = 0
            for item in temp_dir.iterdir():
                if item.is_dir():
                    shutil.rmtree(item)
                    removed += 1
            if removed:
                log.info("Cleaned up {} stale segment directories", removed)
        except Exception as e:
            log.warning("Failed to cleanup stale segments: {}", e)

    async def start_recording(self, channel_id: str, stream_url: str) -> bool:
        """Start recording a channel (if not already recording).

        Args:
            channel_id: Unique channel identifier.
            stream_url: URL of the stream to record (may be overridden for ErsatzTV).

        Returns:
            True if recorder is running (started or already running).
        """
        if not settings.highlight_enabled:
            log.debug("Highlight feature disabled, not starting recorder")
            return False

        # Try to look up ErsatzTV channel to get direct stream URL
        ersatztv_url = get_ersatztv_stream_url(channel_id)
        if ersatztv_url:
            stream_url = ersatztv_url
            log.debug("Using direct ErsatzTV stream URL: {}", stream_url)

        async with self._lock:
            if channel_id in self._recorders:
                recorder = self._recorders[channel_id]
                if recorder.is_running:
                    return True
                # Recorder exists but stopped - restart it
                await recorder.start()
                return recorder.is_running

            # Create new recorder
            recorder = ChannelRecorder(channel_id, stream_url)
            if await recorder.start():
                self._recorders[channel_id] = recorder
                return True
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

    async def stop_all(self) -> None:
        """Stop all recorders (for shutdown)."""
        async with self._lock:
            for recorder in self._recorders.values():
                await recorder.stop()
            self._recorders.clear()

    def get_status(self, channel_id: str) -> dict:
        """Get recording status for a channel.

        Returns:
            Status dict with recording state and buffer info.
        """
        if not settings.highlight_enabled:
            return {"enabled": False, "recording": False, "bufferSeconds": 0}

        if channel_id not in self._recorders:
            return {"enabled": True, "recording": False, "bufferSeconds": 0}

        recorder = self._recorders[channel_id]
        return {
            "enabled": True,
            "recording": recorder.is_running,
            "bufferSeconds": recorder.get_buffer_seconds(),
            "maxBufferSeconds": settings.highlight_buffer_seconds,
        }

    async def save_highlight(self, channel_id: str) -> tuple[bytes | None, str | None]:
        """Save highlight for a channel.

        Args:
            channel_id: Channel to save highlight for.

        Returns:
            Tuple of (mp4_bytes, error_message).
        """
        if not settings.highlight_enabled:
            return None, "Highlight feature is disabled"

        if channel_id not in self._recorders:
            return None, "No recording active for this channel"

        recorder = self._recorders[channel_id]
        return await recorder.save_highlight()


# Global service instance
highlight_service = HighlightService()
