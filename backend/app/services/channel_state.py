"""Channel state service for tracking currently selected channel.

This service maintains in-memory state of the currently selected channel
and manages WebSocket connections for real-time updates.
The state resets on server restart (acceptable for MVP).
"""

import asyncio
import json

from fastapi import WebSocket
from fastapi.websockets import WebSocketState
from loguru import logger

from app.config import settings
from app.models.channel import Channel
from app.services import chat

# Module-level logger with service context
log = logger.bind(service="channel")

# Per-send timeout for broadcasts, so one stalled client cannot hang the
# handlers that await broadcast() (chat, channel change, settings update)
BROADCAST_SEND_TIMEOUT_SECONDS = 5.0

# In-memory state - resets on restart (acceptable for MVP)
_current_channel: Channel | None = None
_active_connections: set[WebSocket] = set()
_connection_owners: dict[WebSocket, asyncio.Task] = {}


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
    old_channel = _current_channel
    _current_channel = channel

    log.bind(event="channel.change", user=user, channel=channel.name, channel_id=channel.id).info(
        "Channel changed to '{}' by user '{}'", channel.name, user or "system"
    )

    # Handle highlight recording on channel switch
    if settings.highlight_enabled:
        # Import here to avoid circular dependency
        from app.services.highlight import highlight_service

        # A new live pick retries at once rather than waiting out an earlier failure's backoff.
        highlight_service.clear_start_backoff()
        try:
            # Stop recording for old channel if switching to different channel
            if old_channel and old_channel.id != channel.id:
                await highlight_service.stop_recording(old_channel.id)

            # Optional recording must not prevent the selected channel broadcast.
            if channel.stream_url:
                await highlight_service.start_recording(
                    channel.id, channel.stream_url, owner=user or "system"
                )
        except Exception as exc:
            log.warning("Highlight setup failed for {}: {}", channel.id, exc)

    # Broadcast to all connected clients
    await broadcast_channel_update(channel, changed_by=user)
    if user:
        await _broadcast_system_line(f"{user} put on {channel.name}")

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

    # Stop recording for current channel if active
    if settings.highlight_enabled and _current_channel:
        from app.services.highlight import highlight_service

        highlight_service.clear_start_backoff()
        await highlight_service.stop_recording(_current_channel.id)

    _current_channel = None

    if user:
        log.info("Current channel cleared by user '{}'", user)
    else:
        log.info("Current channel cleared")

    # Broadcast to all connected clients, naming who stopped live TV
    await broadcast({"type": "channel_update", "channel": None, "changedBy": user})
    if user:
        await _broadcast_system_line(f"{user} stopped live TV")


async def connect(websocket: WebSocket, owner: asyncio.Task | None = None) -> None:
    """Accept (if not already accepted) and track a WebSocket connection.

    Callers that need to send a custom close code on auth failure accept the
    socket themselves first; accepting twice raises, so only accept here when
    the handshake is still pending.

    Args:
        websocket: The WebSocket connection to accept and track.
    """
    if websocket.application_state == WebSocketState.CONNECTING:
        await websocket.accept()
    _active_connections.add(websocket)
    if owner is not None:
        _connection_owners[websocket] = owner
    log.debug("WebSocket connected, total connections: {}", len(_active_connections))


def disconnect(websocket: WebSocket) -> None:
    """Remove a WebSocket connection from tracking.

    Args:
        websocket: The WebSocket connection to remove.
    """
    _active_connections.discard(websocket)
    _connection_owners.pop(websocket, None)
    log.debug("WebSocket disconnected, remaining connections: {}", len(_active_connections))


async def broadcast_channel_update(channel: Channel, changed_by: str | None = None) -> None:
    """Broadcast channel update to all connected clients.

    Args:
        channel: The channel to broadcast.
        changed_by: Username of whoever changed the channel, so clients can
            say who put it on. None for system changes.
    """
    message = {
        "type": "channel_update",
        "channel": channel.model_dump(by_alias=True),
        "changedBy": changed_by,
    }
    log.debug("Broadcasting channel update to {} clients", len(_active_connections))
    await broadcast(message)


async def _broadcast_system_line(content: str) -> None:
    """Post a system line to chat about a Live change, if chat is enabled.

    The line is broadcast as an ordinary chat_message (kind 'system') but not
    stored in the chat history; see chat.system_message.

    Args:
        content: The sentence to show, naming who made the change.
    """
    if not settings.chat_enabled:
        return
    line = chat.system_message(content)
    await broadcast({"type": "chat_message", **line.to_dict()})


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
            await asyncio.wait_for(
                ws.send_text(message_text), timeout=BROADCAST_SEND_TIMEOUT_SECONDS
            )
            return ws, True
        except TimeoutError:
            log.warning(
                "Broadcast send timed out after {}s, dropping connection",
                BROADCAST_SEND_TIMEOUT_SECONDS,
            )
            return ws, False
        except Exception:
            return ws, False

    results = await asyncio.gather(
        *[send_safe(ws) for ws in _active_connections],
        return_exceptions=True,
    )

    async def close_failed(ws: WebSocket) -> None:
        if ws not in _active_connections:
            return  # Another overlapping broadcast already owns cleanup.
        owner = _connection_owners.get(ws)
        disconnect(ws)
        try:
            await asyncio.wait_for(
                ws.close(code=1011, reason="Broadcast failed; reconnect"),
                timeout=BROADCAST_SEND_TIMEOUT_SECONDS,
            )
        except Exception:
            log.debug("Failed connection transport could not close")
        finally:
            # Closing an ASGI socket need not unblock receive immediately.
            # Cancel its owning endpoint so presence/nickname cleanup always runs.
            if owner is not None and not owner.done():
                owner.cancel()

    await asyncio.gather(
        *(
            close_failed(result[0])
            for result in results
            if isinstance(result, tuple) and not result[1]
        )
    )


def get_connection_count() -> int:
    """Get count of active connections (for monitoring).

    Returns:
        Number of active WebSocket connections.
    """
    return len(_active_connections)
