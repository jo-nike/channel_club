"""Channel state service for tracking currently selected channel.

This service maintains in-memory state of the currently selected channel
and manages WebSocket connections for real-time updates.
The state resets on server restart (acceptable for MVP).
"""

import asyncio
import json

from fastapi import WebSocket

from app.models.channel import Channel

# In-memory state - resets on restart (acceptable for MVP)
_current_channel: Channel | None = None
_active_connections: set[WebSocket] = set()


def get_current_channel() -> Channel | None:
    """Get the currently selected channel.

    Returns:
        The currently selected Channel, or None if no channel is selected.
    """
    return _current_channel


async def set_current_channel(channel: Channel) -> Channel:
    """Set the current channel and broadcast to all connected clients.

    Args:
        channel: The channel to set as current.

    Returns:
        The set channel.
    """
    global _current_channel
    _current_channel = channel

    # Broadcast to all connected clients
    await broadcast_channel_update(channel)

    return _current_channel


def clear_current_channel() -> None:
    """Clear the current channel selection."""
    global _current_channel
    _current_channel = None


async def connect(websocket: WebSocket) -> None:
    """Accept and track a WebSocket connection.

    Args:
        websocket: The WebSocket connection to accept and track.
    """
    await websocket.accept()
    _active_connections.add(websocket)


def disconnect(websocket: WebSocket) -> None:
    """Remove a WebSocket connection from tracking.

    Args:
        websocket: The WebSocket connection to remove.
    """
    _active_connections.discard(websocket)


async def broadcast_channel_update(channel: Channel) -> None:
    """Broadcast channel update to all connected clients.

    Args:
        channel: The channel to broadcast.
    """
    message = {
        "type": "channel_update",
        "channel": channel.model_dump(by_alias=True),
    }
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
