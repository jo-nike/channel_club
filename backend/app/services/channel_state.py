"""Channel state service for tracking currently selected channel.

This service maintains in-memory state of the currently selected channel
and manages WebSocket connections for real-time updates.
The state resets on server restart (acceptable for MVP).
"""

import asyncio
import json

from fastapi import WebSocket
from loguru import logger

from app.models.channel import Channel

# Module-level logger with service context
log = logger.bind(service="channel")

# In-memory state - resets on restart (acceptable for MVP)
_current_channel: Channel | None = None
_active_connections: set[WebSocket] = set()


def get_current_channel() -> Channel | None:
    """Get the currently selected channel.

    Returns:
        The currently selected Channel, or None if no channel is selected.
    """
    log.debug("Getting current channel: {}", _current_channel.name if _current_channel else None)
    return _current_channel


async def set_current_channel(channel: Channel, user: str | None = None) -> Channel:
    """Set the current channel and broadcast to all connected clients.

    Args:
        channel: The channel to set as current.
        user: Optional username of the user making the change.

    Returns:
        The set channel.
    """
    global _current_channel
    _current_channel = channel

    if user:
        log.info("Channel changed to '{}' by user '{}'", channel.name, user)
    else:
        log.info("Channel changed to '{}'", channel.name)

    # Broadcast to all connected clients
    await broadcast_channel_update(channel)

    return _current_channel


def clear_current_channel() -> None:
    """Clear the current channel selection (synchronous, no broadcast)."""
    global _current_channel
    log.debug("Clearing current channel selection")
    _current_channel = None


async def clear_current_channel_async(user: str | None = None) -> None:
    """Clear the current channel and broadcast to all clients.

    Args:
        user: Optional username of the user making the change.
    """
    global _current_channel
    _current_channel = None

    if user:
        log.info("Current channel cleared by user '{}'", user)
    else:
        log.info("Current channel cleared")

    # Broadcast to all connected clients
    await broadcast({"type": "channel_update", "channel": None})


async def connect(websocket: WebSocket) -> None:
    """Accept and track a WebSocket connection.

    Args:
        websocket: The WebSocket connection to accept and track.
    """
    await websocket.accept()
    _active_connections.add(websocket)
    log.debug("WebSocket connected, total connections: {}", len(_active_connections))


def disconnect(websocket: WebSocket) -> None:
    """Remove a WebSocket connection from tracking.

    Args:
        websocket: The WebSocket connection to remove.
    """
    _active_connections.discard(websocket)
    log.debug("WebSocket disconnected, remaining connections: {}", len(_active_connections))


async def broadcast_channel_update(channel: Channel) -> None:
    """Broadcast channel update to all connected clients.

    Args:
        channel: The channel to broadcast.
    """
    message = {
        "type": "channel_update",
        "channel": channel.model_dump(by_alias=True),
    }
    log.debug("Broadcasting channel update to {} clients", len(_active_connections))
    await broadcast(message)


async def broadcast(message: dict) -> None:
    """Send message to all connected clients.

    Args:
        message: The message dict to send as JSON.
    """
    if not _active_connections:
        return

    message_text = json.dumps(message)

    async def send_safe(ws: WebSocket) -> tuple[WebSocket, bool]:
        try:
            await ws.send_text(message_text)
            return ws, True
        except Exception:
            return ws, False

    results = await asyncio.gather(
        *[send_safe(ws) for ws in _active_connections],
        return_exceptions=True,
    )

    # Remove failed connections
    for result in results:
        if isinstance(result, tuple) and not result[1]:
            _active_connections.discard(result[0])


def get_connection_count() -> int:
    """Get count of active connections (for monitoring).

    Returns:
        Number of active WebSocket connections.
    """
    return len(_active_connections)
