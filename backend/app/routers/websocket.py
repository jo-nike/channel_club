"""WebSocket router for real-time channel updates."""

import json
from uuid import uuid4

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError
from loguru import logger

from app.services import channel_state, presence
from app.services.auth import verify_token

router = APIRouter()
log = logger.bind(router="websocket")


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

        # Listen for client messages
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                await handle_client_message(websocket, message, client_id)
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


async def handle_client_message(websocket: WebSocket, message: dict, client_id: str) -> None:
    """Handle incoming client messages.

    Args:
        websocket: The WebSocket connection.
        message: Parsed JSON message from client.
        client_id: Unique client identifier for logging.
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
    else:
        # Log unknown message types for debugging
        log.debug("Unknown WebSocket message type from client {}: {}", client_id, msg_type)
