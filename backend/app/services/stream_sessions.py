"""ErsatzTV stream sessions: an opaque id in the playback URL instead of the JWT.

A signed-in client creates a session for a channel with its Authorization
header, then plays /api/ersatztv/s/{id}/stream.m3u8. The rewritten manifest,
its nested playlists and segments all carry the same id, so no credential
reaches a URL (and so NPM's access log or a Chromecast). The id is the
capability, like a cast session's UUID.

Sessions live in memory. Expiry is enforced on read and swept on create, the
caps bound memory, and everything runs on the event loop, so there is no
background task and no lock.
"""

import secrets
import time
from dataclasses import dataclass

from loguru import logger

log = logger.bind(service="stream_sessions")

# A session unused this long is gone. hls.js and the Chromecast reload the live
# playlist every target duration, so a playing session is never this idle.
STREAM_SESSION_IDLE_SECONDS = 300
STREAM_SESSIONS_PER_ACCOUNT = 8
STREAM_SESSIONS_MAX = 256


def monotonic() -> float:
    """The clock for session idleness, which a host clock step must not move."""
    return time.monotonic()


class StreamSessionLimitError(Exception):
    """Every stream session slot is taken by a live session."""


@dataclass
class StreamSession:
    id: str
    account: str
    channel_id: str
    created: float
    last_used: float


_sessions: dict[str, StreamSession] = {}


def _expired(session: StreamSession, now: float) -> bool:
    return now - session.last_used >= STREAM_SESSION_IDLE_SECONDS


def _sweep(now: float) -> None:
    for session_id in [sid for sid, s in _sessions.items() if _expired(s, now)]:
        del _sessions[session_id]


def create(account: str, channel_id: str) -> StreamSession:
    """Open a session for an account's playback of a channel.

    A ninth live session for one account replaces that account's least
    recently used one.

    Raises:
        StreamSessionLimitError: STREAM_SESSIONS_MAX live sessions are open.
    """
    now = monotonic()
    _sweep(now)
    own = [s for s in _sessions.values() if s.account == account]
    if len(own) >= STREAM_SESSIONS_PER_ACCOUNT:
        oldest = min(own, key=lambda s: s.last_used)
        del _sessions[oldest.id]
        log.debug("Evicted stream session {} for a new one", oldest.id[:8])
    if len(_sessions) >= STREAM_SESSIONS_MAX:
        raise StreamSessionLimitError("Too many open streams")
    session = StreamSession(
        id=secrets.token_urlsafe(24),
        account=account,
        channel_id=channel_id,
        created=now,
        last_used=now,
    )
    _sessions[session.id] = session
    log.debug("Created stream session {} for channel {}", session.id[:8], channel_id)
    return session


def get(session_id: str) -> StreamSession | None:
    """Return a live session and keep it alive, or None when unknown or idle."""
    session = _sessions.get(session_id)
    if session is None:
        return None
    now = monotonic()
    if _expired(session, now):
        del _sessions[session_id]
        return None
    session.last_used = now
    return session


def manifest_path(session_id: str) -> str:
    """The app-relative playlist URL a client plays for a session."""
    return f"/api/ersatztv/s/{session_id}/stream.m3u8"


def clear() -> None:
    """Forget every session (tests)."""
    _sessions.clear()
