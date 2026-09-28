"""Presence service for tracking connected users and their activity.

This service maintains in-memory tracking of all connected users,
their view type (live/ersatztv), and current channel.
The state resets on server restart (acceptable for this use case).

Every session, channel and programme change is also emitted as a structured
INFO log event (``session.start``, ``session.stop``, ``watch.start``,
``watch.stop``, ``programme.change``, ``programme.stop``) with bound fields,
so viewing history can be queried from the log store
(Loki: ``| json | record_extra_event="watch.stop"``) without a database.
"""

import asyncio
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from fastapi import WebSocket
from loguru import logger

# Module-level logger with service context
log = logger.bind(service="presence")

View = Literal["live", "ersatztv"]


def _now() -> datetime:
    """Wall-clock time, for display and logged durations (tests patch this)."""
    return datetime.now(UTC)


def _monotonic() -> float:
    """Monotonic time, for staleness: a host clock step can't age anyone (tests patch this)."""
    return time.monotonic()


@dataclass
class UserPresence:
    """Represents a connected user's presence information."""

    connection_id: str
    username: str
    view: View
    user_id: str | None = None  # Opaque chat id (chat.user_id_for), safe to show others
    nickname: str | None = None  # Chat display name, None means the username
    hide_activity: bool = False  # "Hide what I'm watching": others see the name only
    current_channel: str | None = None
    current_channel_id: str | None = None
    current_programme: str | None = None
    channel_since: datetime | None = None
    programme_since: datetime | None = None  # Start of the current titled programme segment
    connected_since: datetime = field(default_factory=lambda: _now())
    last_activity: datetime = field(default_factory=lambda: _now())
    last_activity_mono: float = field(default_factory=lambda: _monotonic())  # For staleness
    websocket: WebSocket | None = None  # Closed if a stale sweep removes the entry


# In-memory store keyed by connection_id
_active_users: dict[str, UserPresence] = {}

# The frontend's synthetic id for the Live slot. Pre-R2 bundles report it, named
# 'Live', when nothing is live; a shim that can go once those tabs are gone.
LEGACY_EMPTY_LIVE_SLOT_ID = "live-channel-0"


def _emit(event: str, message: str, **fields: object) -> None:
    """Log a structured presence event at INFO with bound fields."""
    log.bind(event=event, **fields).info(message)


def _seconds_since(start: datetime | None, end: datetime | None = None) -> float:
    if start is None:
        return 0.0
    # A watch can start after the last ping, so an end at that ping is before it
    return max(0.0, round(((end or _now()) - start).total_seconds(), 1))


def _close_programme(user: UserPresence, end: datetime | None = None) -> None:
    """Emit programme.stop for the titled segment that just ended, if one is open.

    ``end`` is when the segment ended, if not now.
    """
    if user.current_programme is None or user.programme_since is None:
        return
    duration = _seconds_since(user.programme_since, end)
    _emit(
        "programme.stop",
        f"User {user.username} stopped watching {user.current_programme} "
        f"on {user.current_channel} after {duration}s",
        user=user.username,
        session=user.connection_id,
        view=user.view,
        channel=user.current_channel,
        channel_id=user.current_channel_id,
        programme=user.current_programme,
        duration_s=duration,
    )
    user.programme_since = None


def _close_watch(user: UserPresence, reason: str, end: datetime | None = None) -> None:
    """Emit watch.stop for the user's current channel, if any, and clear it.

    An open programme segment is closed first with programme.stop. ``end`` is
    when the watch ended, if not now (a stale sweep passes the last message).
    """
    if user.current_channel is None and user.current_channel_id is None:
        return
    _close_programme(user, end)
    duration = _seconds_since(user.channel_since, end)
    _emit(
        "watch.stop",
        f"User {user.username} stopped watching {user.current_channel} "
        f"after {duration}s ({reason})",
        user=user.username,
        session=user.connection_id,
        view=user.view,
        channel=user.current_channel,
        channel_id=user.current_channel_id,
        programme=user.current_programme,
        duration_s=duration,
        reason=reason,
    )
    user.current_channel = None
    user.current_channel_id = None
    user.current_programme = None
    user.channel_since = None


def _close_session(user: UserPresence, reason: str, end: datetime | None = None) -> None:
    """Emit watch.stop (if watching) and session.stop for a departing user."""
    _close_watch(user, reason, end)
    duration = _seconds_since(user.connected_since, end)
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
    user_id: str | None = None,
    hide_activity: bool = False,
) -> UserPresence:
    """Track a new user connection.

    Args:
        connection_id: Server-generated id for this connection, never the client's.
        username: The authenticated username.
        view: The view type ("live" or "ersatztv").
        websocket: The connection's WebSocket, closed if a stale sweep removes it.
        user_id: The account's opaque chat id, used to group a person's connections.
        hide_activity: Whether the person hides what they watch, known at connect.

    Returns:
        The created UserPresence object.
    """
    user_presence = UserPresence(
        connection_id=connection_id,
        username=username,
        view=view,
        websocket=websocket,
        user_id=user_id,
        hide_activity=hide_activity,
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
    On the same channel, a title change ends the titled segment that was open
    (``programme.stop`` with its duration), and each new non-null title emits
    ``programme.change``. Null titles start nothing.

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

    if channel_id == LEGACY_EMPTY_LIVE_SLOT_ID:
        channel_name = channel_id = programme_title = None

    channel_changed = channel_name != user.current_channel or channel_id != user.current_channel_id
    if channel_changed:
        _close_watch(user, "switch" if channel_name is not None else "cleared")
    title_changed = (
        not channel_changed
        and user.current_channel is not None
        and programme_title != user.current_programme
    )
    if title_changed:
        _close_programme(user)

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

    if title_changed and programme_title is not None:
        user.programme_since = _now()
        _emit(
            "programme.change",
            f"User {user.username} watching {user.current_channel}: {programme_title}",
            user=user.username,
            session=connection_id,
            view=user.view,
            channel=user.current_channel,
            channel_id=user.current_channel_id,
            programme=programme_title,
        )

    if channel_changed and channel_name is not None:
        user.current_channel = channel_name
        user.current_channel_id = channel_id
        user.channel_since = _now()
        user.programme_since = user.channel_since if programme_title is not None else None
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


def set_nickname(connection_id: str, nickname: str | None) -> None:
    """Record the chat display name a connection uses.

    Args:
        connection_id: The connection ID to update.
        nickname: The accepted nickname, or None to fall back to the username.
    """
    if connection_id in _active_users:
        _active_users[connection_id].nickname = nickname


def set_hide_activity(connection_id: str, hide: bool) -> None:
    """Record whether a connection's owner hides what they watch from others.

    The admin Active Users list still shows the channel.

    Args:
        connection_id: The connection ID to update.
        hide: True to show only the person's name to other members.
    """
    if connection_id in _active_users:
        _active_users[connection_id].hide_activity = hide


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

    Called for every valid message from the client (pings included), so a
    connection that is in use is never swept as stale.

    Args:
        connection_id: The connection ID to update.
    """
    if connection_id in _active_users:
        user = _active_users[connection_id]
        user.last_activity = _now()
        user.last_activity_mono = _monotonic()


# Default timeout for stale user cleanup (60 seconds)
# Must be longer than client ping interval (30s) to avoid false positives
STALE_USER_TIMEOUT_SECONDS = 60

# How often the background task sweeps for stale users. With the 60s timeout a
# tab that vanished without closing its socket is gone within about 90s.
CLEANUP_INTERVAL_SECONDS = 30

# How long closing a stale connection's socket may take
STALE_CLOSE_TIMEOUT_SECONDS = 5.0

# Strong reference to the running cleanup task (the event loop only keeps a
# weak one)
_cleanup_task: asyncio.Task | None = None

# Closes of stale sockets still in flight, held for the same reason
_stale_closes: set[asyncio.Task] = set()


async def _close_stale_socket(websocket: WebSocket) -> None:
    """Close a swept connection's socket with 4000, so its client reconnects.

    Args:
        websocket: The stale connection's WebSocket.
    """
    # Import here to avoid a circular dependency (channel_state imports chat,
    # which imports presence)
    from app.services import channel_state

    # Remove from broadcasts before awaiting transport shutdown. The close
    # ends the endpoint's receive, and its cleanup finds the entry already gone.
    channel_state.disconnect(websocket)
    try:
        await asyncio.wait_for(
            websocket.close(code=4000, reason="stale"), timeout=STALE_CLOSE_TIMEOUT_SECONDS
        )
    except Exception:
        log.debug("Stale connection transport could not close")


async def stop_stale_closes() -> None:
    """Cancel the stale-socket closes still in flight (app shutdown)."""
    tasks = list(_stale_closes)
    _stale_closes.clear()
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


def cleanup_stale_users(timeout_seconds: int = STALE_USER_TIMEOUT_SECONDS) -> int:
    """Remove users who haven't sent a message within the timeout period.

    This handles cases where a browser crashes or network fails without
    proper WebSocket disconnect. A socket that is still open is closed with
    code 4000, so the client reconnects and registers again instead of
    staying connected with no presence.

    Args:
        timeout_seconds: Seconds of inactivity before a user is considered stale.

    Returns:
        The number of stale users removed.
    """
    now = _monotonic()
    stale = [
        cid
        for cid, user in _active_users.items()
        if now - user.last_activity_mono > timeout_seconds
    ]
    for cid in stale:
        user = _active_users.pop(cid, None)
        if user:
            if user.websocket is not None:
                task = asyncio.create_task(_close_stale_socket(user.websocket))
                _stale_closes.add(task)
                task.add_done_callback(_stale_closes.discard)
            # The tab went quiet at its last message, not at this sweep
            _close_session(user, "stale", user.last_activity)
    if stale:
        # Import here to avoid a circular dependency (presence_broadcast reads presence)
        from app.services import presence_broadcast

        presence_broadcast.schedule_broadcast()
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
