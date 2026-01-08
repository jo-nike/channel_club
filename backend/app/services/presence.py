"""Presence service for tracking connected users and their activity.

This service maintains in-memory tracking of all connected users,
their view type (live/ersatztv), and current channel.
The state resets on server restart (acceptable for this use case).
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from fastapi import WebSocket
from loguru import logger

# Module-level logger with service context
log = logger.bind(service="presence")


@dataclass
class UserPresence:
    """Represents a connected user's presence information."""

    connection_id: str
    username: str
    view: Literal["live", "ersatztv"]
    current_channel: str | None = None
    current_programme: str | None = None
    connected_since: datetime = field(default_factory=lambda: datetime.now(UTC))
    last_activity: datetime = field(default_factory=lambda: datetime.now(UTC))
    websocket: WebSocket | None = None  # For potential future use


# In-memory store keyed by connection_id
_active_users: dict[str, UserPresence] = {}


def track_user(
    connection_id: str,
    username: str,
    view: Literal["live", "ersatztv"],
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

    user_presence = UserPresence(
        connection_id=connection_id,
        username=username,
        view=view,
        websocket=websocket,
    )
    _active_users[connection_id] = user_presence
    log.info("User {} connected to {} view (session: {})", username, view, connection_id)
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
        log.info("User {} disconnected from {} view", user.username, user.view)


def update_user_channel(
    connection_id: str,
    channel_name: str | None,
    programme_title: str | None = None,
    view: Literal["live", "ersatztv"] | None = None,
) -> None:
    """Update user's current channel, programme, and optionally view type.

    Args:
        connection_id: The connection ID to update.
        channel_name: The new channel name, or None if not watching.
        programme_title: The current programme title, or None.
        view: Optional view type to update (for unified TV view switching).
    """
    if connection_id in _active_users:
        user = _active_users[connection_id]
        user.current_channel = channel_name
        user.current_programme = programme_title

        # Update view type if provided (unified view switching between live/ersatztv)
        if view is not None and view in ("live", "ersatztv") and user.view != view:
            log.info(
                "User {} switching view from {} to {}",
                user.username,
                user.view,
                view,
            )
            user.view = view

        log.debug(
            "User {} now watching: {} - {} (view: {})",
            user.username,
            channel_name,
            programme_title,
            user.view,
        )


def get_active_users() -> dict[str, UserPresence]:
    """Get all active users.

    Returns:
        A copy of the active users dictionary.
    """
    return _active_users.copy()


def get_users_by_view(view: Literal["live", "ersatztv"]) -> list[UserPresence]:
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
            log.info("Removed stale user {} from {} view", user.username, user.view)
    return len(stale)
