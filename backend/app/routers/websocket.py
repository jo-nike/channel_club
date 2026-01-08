"""WebSocket router for real-time channel updates."""

import json
from uuid import uuid4

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError
from loguru import logger

from app.config import settings
from app.services import channel_state, chat, presence
from app.services.auth import verify_token

router = APIRouter()
log = logger.bind(router="websocket")

# Store nicknames per client_id (in-memory, cleared on disconnect)
_nickname_map: dict[str, str] = {}
MAX_NICKNAME_LENGTH = 30


async def verify_websocket_token(token: str) -> dict | None:
    """Verify JWT token for WebSocket connection.

    Args:
        token: JWT token string.

    Returns:
        Token payload dict if valid, None otherwise.
    """
    try:
        payload = verify_token(token)
        return {"sub": payload.sub, "role": payload.role}
    except JWTError:
        return None


@router.websocket("/api/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    view: str = Query(default="live"),
    session_id: str = Query(default=""),
) -> None:
    """WebSocket endpoint for real-time channel updates.

    Args:
        websocket: The WebSocket connection.
        token: JWT token passed as query parameter.
        view: View type ("live" or "ersatztv"), defaults to "live".
        session_id: Client session ID for presence tracking (prevents duplicates on view switch).
    """
    # Use session_id if provided, otherwise generate a unique client ID
    # Session ID allows same-tab view switches to replace old presence entry
    client_id = session_id if session_id else str(uuid4())[:8]

    # Validate token before accepting connection
    payload = await verify_websocket_token(token)
    if not payload:
        log.warning("WebSocket auth failed for client {}", client_id)
        await websocket.close(code=4001, reason="Invalid token")
        return

    log.info("WebSocket connected: client {} (user={})", client_id, payload.get("sub"))

    # Accept connection and track it
    await channel_state.connect(websocket)

    # Track user presence
    view_type = "ersatztv" if view == "ersatztv" else "live"
    presence.track_user(
        connection_id=client_id,
        username=payload["sub"],  # Key guaranteed by verify_websocket_token
        view=view_type,
        websocket=websocket,
    )

    try:
        # Send connection acknowledgment with current channel
        current = channel_state.get_current_channel()
        ack_message = {
            "type": "connection_ack",
            "currentChannel": current.model_dump(by_alias=True) if current else None,
        }
        await websocket.send_json(ack_message)

        # Send chat history if chat is enabled
        if settings.chat_enabled:
            history = chat.get_history(limit=50)
            history_message = {
                "type": "chat_history",
                "messages": [msg.to_dict() for msg in history],
            }
            await websocket.send_json(history_message)

        # Listen for client messages
        username = payload["sub"]
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                await handle_client_message(websocket, message, client_id, username)
            except json.JSONDecodeError:
                log.debug("Malformed JSON from client {}", client_id)

    except WebSocketDisconnect:
        log.info("WebSocket disconnected: client {}", client_id)
    except Exception as e:
        log.error("WebSocket error for client {}: {}", client_id, e)
    finally:
        # Always clean up on disconnect
        # Pass websocket to avoid race condition on view switch
        presence.remove_user(client_id, websocket)
        channel_state.disconnect(websocket)
        # Clean up nickname
        _nickname_map.pop(client_id, None)


async def handle_client_message(
    websocket: WebSocket, message: dict, client_id: str, username: str
) -> None:
    """Handle incoming client messages.

    Args:
        websocket: The WebSocket connection.
        message: Parsed JSON message from client.
        client_id: Unique client identifier for logging.
        username: Authenticated username of the client.
    """
    msg_type = message.get("type")

    if msg_type == "ping":
        log.debug("Ping from client {}, sending pong", client_id)
        presence.update_last_activity(client_id)
        await websocket.send_json({"type": "pong"})
    elif msg_type == "channel_update":
        channel = message.get("channel")
        programme = message.get("programme")
        view = message.get("view")
        presence.update_user_channel(client_id, channel, programme, view)
        log.debug(
            "Channel update from client {}: {} - {} (view: {})",
            client_id,
            channel,
            programme,
            view or "unchanged",
        )
    elif msg_type == "set_nickname":
        # Handle nickname setting for chat display name
        nickname = message.get("nickname", "").strip()[:MAX_NICKNAME_LENGTH]
        if nickname:
            _nickname_map[client_id] = nickname
            log.debug("Nickname set for client {}: {}", client_id, nickname)
        else:
            # Empty nickname - remove from map (fall back to auth username)
            _nickname_map.pop(client_id, None)
            log.debug("Nickname cleared for client {}", client_id)

    elif msg_type == "chat_message":
        # Handle chat messages only if chat is enabled
        if not settings.chat_enabled:
            log.debug("Chat message ignored from client {} - chat disabled", client_id)
            return

        content = message.get("content", "")
        # Use nickname if set, otherwise fall back to auth username
        display_name = _nickname_map.get(client_id, username)
        chat_msg = chat.add_message(display_name, content)

        if chat_msg:
            # Broadcast to all connected clients
            broadcast_message = {
                "type": "chat_message",
                **chat_msg.to_dict(),
            }
            await channel_state.broadcast(broadcast_message)
            log.debug("Chat message broadcast from {}: {}", username, chat_msg.message_id[:8])
        else:
            log.debug("Chat message from {} rejected (empty/invalid)", username)
    else:
        # Log unknown message types for debugging
        log.debug("Unknown WebSocket message type from client {}: {}", client_id, msg_type)
