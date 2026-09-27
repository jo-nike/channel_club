"""Presence service for tracking connected users and their activity.

This service maintains in-memory tracking of all connected users,
their view type (live/ersatztv), and current channel.
The state resets on server restart (acceptable for this use case).

Every session and channel change is also emitted as a structured INFO log
event (``session.start``, ``session.stop``, ``watch.start``, ``watch.stop``)
with bound fields, so viewing history can be queried from the log store
(Loki: ``| json | record_extra_event="watch.stop"``) without a database.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from fastapi import WebSocket
from loguru import logger

# Module-level logger with service context
log = logger.bind(service="presence")

View = Literal["live", "ersatztv"]


@dataclass
class UserPresence:
    """Represents a connected user's presence information."""

    connection_id: str
    username: str
    view: View
    current_channel: str | None = None
    current_channel_id: str | None = None
    current_programme: str | None = None
    channel_since: datetime | None = None
    connected_since: datetime = field(default_factory=lambda: datetime.now(UTC))
    last_activity: datetime = field(default_factory=lambda: datetime.now(UTC))
    websocket: WebSocket | None = None  # For potential future use


# In-memory store keyed by connection_id
_active_users: dict[str, UserPresence] = {}


def _emit(event: str, message: str, **fields: object) -> None:
    """Log a structured presence event at INFO with bound fields."""
    log.bind(event=event, **fields).info(message)


def _seconds_since(start: datetime | None) -> float:
    if start is None:
        return 0.0
    return round((datetime.now(UTC) - start).total_seconds(), 1)


def _close_watch(user: UserPresence, reason: str) -> None:
    """Emit watch.stop for the user's current channel, if any, and clear it."""
    if user.current_channel is None and user.current_channel_id is None:
        return
    duration = _seconds_since(user.channel_since)
    _emit(
        "watch.stop",
        f"User {user.username} stopped watching {user.current_channel} "
        f"after {duration}s ({reason})",
        user=user.username,
        session=user.connection_id,
        view=user.view,
        channel=user.current_channel,
        channel_id=user.current_channel_id,
        duration_s=duration,
        reason=reason,
    )
    user.current_channel = None
    user.current_channel_id = None
    user.current_programme = None
    user.channel_since = None


def _close_session(user: UserPresence, reason: str) -> None:
    """Emit watch.stop (if watching) and session.stop for a departing user."""
    _close_watch(user, reason)
    duration = _seconds_since(user.connected_since)
    _emit(
        "session.stop",
        f"User {user.username} disconnected from {user.view} view after {duration}s ({reason})",
        user=user.username,
        session=user.connection_id,
        view=user.view,
        duration_s=duration,
        reason=reason,
    )


def track_user(
    connection_id: str,
    username: str,
    view: View,
    websocket: WebSocket | None = None,
) -> UserPresence:
    """Track a new user connection.

    Args:
        connection_id: Unique identifier for this connection (session_id from client).
        username: The authenticated username.
        view: The view type ("live" or "ersatztv").
        websocket: Optional WebSocket reference for future use.

    Returns:
        The created UserPresence object.
    """
    # Check if this session was already tracked (view switch in same tab)
    if connection_id in _active_users:
        old_user = _active_users[connection_id]
        log.info(
            "Session {} ({}) switching from {} to {} view",
            connection_id,
            username,
            old_user.view,
            view,
        )
        _close_session(old_user, "view_switch")

    user_presence = UserPresence(
        connection_id=connection_id,
        username=username,
        view=view,
        websocket=websocket,
    )
    _active_users[connection_id] = user_presence
    _emit(
        "session.start",
        f"User {username} connected to {view} view (session: {connection_id})",
        user=username,
        session=connection_id,
        view=view,
    )
    return user_presence


def remove_user(connection_id: str, websocket: WebSocket | None = None) -> None:
    """Remove user from tracking on disconnect.

    Args:
        connection_id: The connection ID to remove.
        websocket: The WebSocket that is disconnecting. If provided, only removes
            if it matches the stored WebSocket (prevents race conditions on view switch).
    """
    if connection_id in _active_users:
        user = _active_users[connection_id]
        # If websocket is provided, only remove if it matches
        # This prevents removing a new connection when an old one disconnects
        if websocket is not None and user.websocket is not None and user.websocket is not websocket:
            log.debug(
                "Ignoring disconnect for session {} - WebSocket mismatch (view switch)",
                connection_id,
            )
            return
        _active_users.pop(connection_id)
        _close_session(user, "disconnect")


def update_user_channel(
    connection_id: str,
    channel_name: str | None,
    programme_title: str | None = None,
    view: View | None = None,
    channel_id: str | None = None,
) -> None:
    """Update user's current channel, programme, and optionally view type.

    Emits ``watch.stop`` / ``watch.start`` only when the channel itself changes.
    A programme title rollover on the same channel updates state silently.

    Args:
        connection_id: The connection ID to update.
        channel_name: The new channel name, or None if not watching.
        programme_title: The current programme title, or None.
        view: Optional view type to update (for unified TV view switching).
        channel_id: Stable channel identifier (Dispatcharr UUID or ErsatzTV tvg-id).
    """
    if connection_id not in _active_users:
        return
    user = _active_users[connection_id]

    channel_changed = channel_name != user.current_channel or channel_id != user.current_channel_id
    if channel_changed:
        _close_watch(user, "switch" if channel_name is not None else "cleared")

    # Update view type if provided (unified view switching between live/ersatztv)
    if view is not None and view in ("live", "ersatztv") and user.view != view:
        log.info(
            "User {} switching view from {} to {}",
            user.username,
            user.view,
            view,
        )
        user.view = view

    user.current_programme = programme_title

    if channel_changed and channel_name is not None:
        user.current_channel = channel_name
        user.current_channel_id = channel_id
        user.channel_since = datetime.now(UTC)
        _emit(
            "watch.start",
            f"User {user.username} now watching: {channel_name} - {programme_title} "
            f"(view: {user.view})",
            user=user.username,
            session=connection_id,
            view=user.view,
            channel=channel_name,
            channel_id=channel_id,
            programme=programme_title,
        )


def get_active_users() -> dict[str, UserPresence]:
    """Get all active users.

    Returns:
        A copy of the active users dictionary.
    """
    return _active_users.copy()


def get_users_by_view(view: View) -> list[UserPresence]:
    """Get users filtered by view type.

    Args:
        view: The view type to filter by.

    Returns:
        List of UserPresence objects matching the view type.
    """
    return [u for u in _active_users.values() if u.view == view]


def update_last_activity(connection_id: str) -> None:
    """Update the last activity timestamp for a user.

    Called when the server receives a ping from the client to indicate
    the connection is still active.

    Args:
        connection_id: The connection ID to update.
    """
    if connection_id in _active_users:
        _active_users[connection_id].last_activity = datetime.now(UTC)


# Default timeout for stale user cleanup (60 seconds)
# Must be longer than client ping interval (30s) to avoid false positives
STALE_USER_TIMEOUT_SECONDS = 60

# How often the background task sweeps for stale users. With the 60s timeout a
# tab that vanished without closing its socket is gone within about 90s.
CLEANUP_INTERVAL_SECONDS = 30

# Strong reference to the running cleanup task (the event loop only keeps a
# weak one)
_cleanup_task: asyncio.Task | None = None


def cleanup_stale_users(timeout_seconds: int = STALE_USER_TIMEOUT_SECONDS) -> int:
    """Remove users who haven't sent a ping within the timeout period.

    This handles cases where a browser crashes or network fails without
    proper WebSocket disconnect.

    Args:
        timeout_seconds: Seconds of inactivity before a user is considered stale.

    Returns:
        The number of stale users removed.
    """
    now = datetime.now(UTC)
    stale = [
        cid
        for cid, user in _active_users.items()
        if (now - user.last_activity).total_seconds() > timeout_seconds
    ]
    for cid in stale:
        user = _active_users.pop(cid, None)
        if user:
            _close_session(user, "stale")
    return len(stale)


def start_cleanup_task() -> None:
    """Start the background task that removes stale users every 30 seconds."""
    global _cleanup_task
    if _cleanup_task is None or _cleanup_task.done():
        _cleanup_task = asyncio.create_task(_cleanup_loop())
        log.debug("Started stale presence cleanup task")


def stop_cleanup_task() -> None:
    """Stop the background stale-user cleanup task."""
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        _cleanup_task = None
        log.debug("Stopped stale presence cleanup task")


async def _cleanup_loop() -> None:
    """Background loop that periodically removes stale users."""
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
            removed = cleanup_stale_users()
            if removed > 0:
                log.info("Cleaned up {} stale users", removed)
        except asyncio.CancelledError:
            break
        except Exception as e:
            log.warning("Error in presence cleanup loop: {}", e)
