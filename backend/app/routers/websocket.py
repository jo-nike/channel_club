"""WebSocket router for real-time channel updates."""

import json
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from jose import JWTError

from app.services import channel_state
from app.services.auth import verify_token

router = APIRouter()
logger = logging.getLogger(__name__)


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
) -> None:
    """WebSocket endpoint for real-time channel updates.

    Args:
        websocket: The WebSocket connection.
        token: JWT token passed as query parameter.
    """
    # Validate token before accepting connection
    payload = await verify_websocket_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid token")
        return

    # Accept connection and track it
    await channel_state.connect(websocket)

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
                await handle_client_message(websocket, message)
            except json.JSONDecodeError:
                pass  # Ignore malformed messages

    except WebSocketDisconnect:
        channel_state.disconnect(websocket)
    except Exception:
        channel_state.disconnect(websocket)


async def handle_client_message(websocket: WebSocket, message: dict) -> None:
    """Handle incoming client messages.

    Args:
        websocket: The WebSocket connection.
        message: Parsed JSON message from client.
    """
    msg_type = message.get("type")

    if msg_type == "ping":
        await websocket.send_json({"type": "pong"})
    else:
        # Log unknown message types for debugging
        logger.debug(f"Unknown WebSocket message type: {msg_type}")
