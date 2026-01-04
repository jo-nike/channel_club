"""Presence service for tracking connected users and their activity.

This service maintains in-memory tracking of all connected users,
their view type (live/ersatztv), current channel, and estimated bitrate.
The state resets on server restart (acceptable for this use case).
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from fastapi import WebSocket
from loguru import logger

# Module-level logger with service context
log = logger.bind(service="presence")

# Bitrate estimates (Mbps)
LIVE_BITRATE = 8.5
ERSATZTV_BITRATE = 12.0


@dataclass
class UserPresence:
    """Represents a connected user's presence information."""

    connection_id: str
    username: str
    view: Literal["live", "ersatztv"]
    current_channel: str | None = None
    connected_since: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    estimated_bitrate: float = 0.0
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
        connection_id: Unique identifier for this connection.
        username: The authenticated username.
        view: The view type ("live" or "ersatztv").
        websocket: Optional WebSocket reference for future use.

    Returns:
        The created UserPresence object.
    """
    bitrate = LIVE_BITRATE if view == "live" else ERSATZTV_BITRATE
    presence = UserPresence(
        connection_id=connection_id,
        username=username,
        view=view,
        estimated_bitrate=bitrate,
        websocket=websocket,
    )
    _active_users[connection_id] = presence
    log.info("User {} connected to {} view", username, view)
    return presence


def remove_user(connection_id: str) -> None:
    """Remove user from tracking on disconnect.

    Args:
        connection_id: The connection ID to remove.
    """
    if connection_id in _active_users:
        user = _active_users.pop(connection_id)
        log.info("User {} disconnected from {} view", user.username, user.view)


def update_user_channel(connection_id: str, channel_name: str | None) -> None:
    """Update user's current channel.

    Args:
        connection_id: The connection ID to update.
        channel_name: The new channel name, or None if not watching.
    """
    if connection_id in _active_users:
        _active_users[connection_id].current_channel = channel_name
        log.debug(
            "User {} now watching: {}",
            _active_users[connection_id].username,
            channel_name,
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
