"""Channel state service for tracking currently selected channel.

This service maintains in-memory state of the currently selected channel
and manages WebSocket connections for real-time updates.
The Live channel's id is saved to the state file (state_store) and restored
in the background on start.
"""

import asyncio
import json
from contextlib import suppress
from typing import TYPE_CHECKING

from fastapi import HTTPException, WebSocket
from fastapi.websockets import WebSocketState
from loguru import logger

from app.config import settings
from app.models.channel import Channel
from app.services import chat, state_store

if TYPE_CHECKING:
    from app.services.highlight import HighlightService

# Module-level logger with service context
log = logger.bind(service="channel")

# Per-send timeout for broadcasts, so one stalled client cannot hang the
# handlers that await broadcast() (chat, channel change, settings update)
BROADCAST_SEND_TIMEOUT_SECONDS = 5.0

# Restoring Live retries this often while the catalogue is unavailable, and
# gives up after RESTORE_ATTEMPTS tries (each capped at RESTORE_ATTEMPT_TIMEOUT_SECONDS)
RESTORE_RETRY_SECONDS = 15.0
RESTORE_ATTEMPTS = 20
RESTORE_ATTEMPT_TIMEOUT_SECONDS = 30.0
# How long startup waits for the restore before serving (see wait_for_restore)
RESTORE_STARTUP_WAIT_SECONDS = 3.0

# In-memory state; Live is restored from the state file on start
_current_channel: Channel | None = None
_active_connections: set[WebSocket] = set()
_connection_owners: dict[WebSocket, asyncio.Task] = {}
# Closes of connections a broadcast failed to reach, held so they aren't
# garbage-collected mid-close (see stop_failed_closes)
_failed_closes: set[asyncio.Task] = set()

# Live changes are serialised; recorder work runs in one background task that
# always targets the latest Live channel (reset with reset_live_change_state)
_change_lock = asyncio.Lock()
_reconcile_task: asyncio.Task | None = None
_reconcile_requested = False
_reconcile_owner = "system"
_restore_task: asyncio.Task | None = None


def get_current_channel() -> Channel | None:
    """Get the currently selected channel.

    Returns:
        The currently selected Channel, or None if no channel is selected.
    """
    log.debug("Getting current channel: {}", _current_channel.name if _current_channel else None)
    return _current_channel


async def set_current_channel(channel: Channel, user: str | None = None) -> Channel:
    """Set the current channel and broadcast to all connected clients.

    Changes are serialised so the last broadcast always matches the stored
    channel. Recorder work runs afterwards in the background reconcile task,
    so viewers see the change without waiting on FFmpeg.

    Args:
        channel: The channel to set as current.
        user: Optional username of the user making the change.

    Returns:
        The set channel.
    """
    global _current_channel
    async with _change_lock:
        _current_channel = channel

        log.bind(
            event="channel.change", user=user, channel=channel.name, channel_id=channel.id
        ).info("Channel changed to '{}' by user '{}'", channel.name, user or "system")
        await state_store.save({"liveChannelId": channel.id, "liveSetBy": user})

        # Broadcast to all connected clients
        await broadcast_channel_update(channel, changed_by=user)
        if user:
            await _broadcast_system_line(f"{user} put on {channel.name}")

        if settings.highlight_enabled:
            # Import here to avoid circular dependency
            from app.services.highlight import highlight_service

            # A new live pick retries at once rather than waiting out an earlier failure's backoff.
            highlight_service.clear_start_backoff()
            _schedule_reconcile(highlight_service, user or "system")

    return channel


def _schedule_reconcile(service: "HighlightService", owner: str) -> None:
    """Ask the reconcile task to start recording the current Live channel.

    A task that is already running picks the request up when its current start
    finishes, so a quick A->B->C only ever starts C. The previous channel's
    recorder is left alone: viewers on it keep their buffer, and the idle sweep
    retires it once nobody polls it.
    """
    global _reconcile_task, _reconcile_requested, _reconcile_owner
    _reconcile_requested = True
    _reconcile_owner = owner
    if _reconcile_task is None or _reconcile_task.done():
        _reconcile_task = asyncio.create_task(_reconcile_recording(service))


async def _reconcile_recording(service: "HighlightService") -> None:
    """Start the recorder for whatever channel is Live when this runs."""
    global _reconcile_requested
    while _reconcile_requested:
        _reconcile_requested = False
        channel = _current_channel
        if channel is None or not channel.stream_url:
            continue
        try:
            await service.start_recording(channel.id, channel.stream_url, owner=_reconcile_owner)
        except Exception as exc:
            # Optional recording must never fail a Live change.
            log.warning("Highlight setup failed for {}: {}", channel.id, exc)


async def stop_reconcile_task() -> None:
    """Cancel the reconcile task at shutdown and wait for it to finish."""
    task = _reconcile_task
    if task is None or task.done():
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


def reset_live_change_state() -> None:
    """Forget the change lock, reconcile and restore tasks (each test runs on a fresh loop)."""
    global _change_lock, _reconcile_task, _reconcile_requested, _reconcile_owner, _restore_task
    _change_lock = asyncio.Lock()
    _reconcile_task = None
    _reconcile_requested = False
    _reconcile_owner = "system"
    _restore_task = None


def start_restore_task(channel_id: str | None) -> None:
    """Restore the saved Live channel in the background, so startup never waits on it.

    Args:
        channel_id: The liveChannelId from the state file; None restores nothing.
    """
    global _restore_task
    if channel_id is not None:
        _restore_task = asyncio.create_task(_restore_live_channel(channel_id))


async def wait_for_restore(timeout: float) -> None:
    """Wait up to timeout for the Live restore to finish, without cancelling it.

    Tabs reconnect as soon as a new deploy accepts connections; a restore that
    finishes first puts Live in their connection_ack, instead of a channel_update
    a moment later that restarts Live viewers and toasts everyone else.
    """
    task = _restore_task
    if task is None or task.done():
        return
    await asyncio.wait({task}, timeout=timeout)


async def stop_restore_task() -> None:
    """Cancel the restore task at shutdown and wait for it to finish."""
    task = _restore_task
    if task is None or task.done():
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def _restore_live_channel(channel_id: str) -> None:
    """Re-resolve the saved Live id against the catalogue and put it back on quietly.

    Retries while the catalogue is unavailable, then gives up with one INFO line.
    An id the catalogue no longer has leaves Live empty and is cleared from the file.
    A restore logs no channel.change and posts no chat line; clients get the
    normal channel_update.
    """
    from app.services.media_source import resolve_media_channel

    global _current_channel
    for attempt in range(RESTORE_ATTEMPTS):
        if attempt:
            await asyncio.sleep(RESTORE_RETRY_SECONDS)
        try:
            async with asyncio.timeout(RESTORE_ATTEMPT_TIMEOUT_SECONDS):
                resolved = await resolve_media_channel(channel_id)
        except TimeoutError:
            continue
        except HTTPException as exc:
            if exc.status_code == 503:
                continue
            async with _change_lock:
                # Only forget the id if nobody has changed Live since
                if state_store.current()["liveChannelId"] == channel_id:
                    log.info("Saved Live channel {} no longer exists; Live left empty", channel_id)
                    await state_store.save({"liveChannelId": None, "liveSetBy": None})
            return

        async with _change_lock:
            # A Live change made while this was resolving wins over the saved one
            if _current_channel is not None or state_store.current()["liveChannelId"] != channel_id:
                return
            channel = resolved.channel
            _current_channel = channel
            log.info("Live channel restored to '{}'", channel.name)
            await broadcast_channel_update(channel)
            if settings.highlight_enabled:
                from app.services.highlight import highlight_service

                _schedule_reconcile(highlight_service, "system")
        return

    log.info("Live channel {} not restored: the channel catalogue stayed unavailable", channel_id)


def clear_current_channel() -> None:
    """Clear the current channel selection (synchronous, no broadcast)."""
    global _current_channel
    log.debug("Clearing current channel selection")
    _current_channel = None


async def clear_current_channel_async(user: str | None = None) -> None:
    """Clear the current channel and broadcast to all clients.

    The recorder keeps running for viewers still on the channel; the idle
    sweep retires it once nobody polls it.

    Args:
        user: Optional username of the user making the change.
    """
    global _current_channel
    async with _change_lock:
        if settings.highlight_enabled and _current_channel:
            from app.services.highlight import highlight_service

            highlight_service.clear_start_backoff()

        _current_channel = None

        if user:
            log.info("Current channel cleared by user '{}'", user)
        else:
            log.info("Current channel cleared")
        await state_store.save({"liveChannelId": None, "liveSetBy": None})

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
        except Exception as e:
            log.info("Broadcast send failed ({}), dropping connection", type(e).__name__)
            return ws, False

    results = await asyncio.gather(
        *[send_safe(ws) for ws in _active_connections],
        return_exceptions=True,
    )

    dropped = 0
    for result in results:
        if not isinstance(result, tuple) or result[1]:
            continue
        ws = result[0]
        if ws not in _active_connections:
            continue  # Another overlapping broadcast already owns cleanup.
        owner = _connection_owners.get(ws)
        # Out of later broadcasts at once; the close runs in the background,
        # so a peer that won't close can't hold up whoever awaits broadcast()
        disconnect(ws)
        dropped += 1
        task = asyncio.create_task(_close_failed(ws, owner))
        _failed_closes.add(task)
        task.add_done_callback(_failed_closes.discard)
    if dropped:
        log.info("Broadcast dropped {} of {} connections", dropped, len(results))


async def _close_failed(ws: WebSocket, owner: asyncio.Task | None) -> None:
    """Close a connection a broadcast could not reach, then end its endpoint.

    Args:
        ws: The failed connection, already removed from tracking.
        owner: The endpoint task serving it, if known.
    """
    try:
        await asyncio.wait_for(
            ws.close(code=1011, reason="Broadcast failed; reconnect"),
            timeout=BROADCAST_SEND_TIMEOUT_SECONDS,
        )
    except Exception as e:
        log.info("Failed connection transport could not close ({})", type(e).__name__)
    finally:
        # Closing an ASGI socket need not unblock receive immediately.
        # Cancel its owning endpoint so presence/nickname cleanup always runs.
        if owner is not None and not owner.done():
            owner.cancel()


async def stop_failed_closes() -> None:
    """Cancel the failed-connection closes still in flight (app shutdown)."""
    tasks = list(_failed_closes)
    _failed_closes.clear()
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


def get_connection_count() -> int:
    """Get count of active connections (for monitoring).

    Returns:
        Number of active WebSocket connections.
    """
    return len(_active_connections)
