"""WebSocket router for real-time channel updates."""

import asyncio
import json
import time
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from jose import JWTError
from loguru import logger
from pydantic import ValidationError

from app.config import settings
from app.models.channel import Channel
from app.models.websocket import MAX_MESSAGE_BYTES, client_message_adapter
from app.services import app_settings, channel_state, chat, presence, presence_broadcast
from app.services.auth import verify_token
from app.services.media_source import resolve_media_channel

router = APIRouter()
log = logger.bind(router="websocket")

# Store nicknames per client_id as (owning websocket, nickname) pairs
# (in-memory, cleared on disconnect). The websocket is kept so an old
# connection's cleanup cannot clobber a nickname set by a newer one.
_nickname_map: dict[str, tuple[WebSocket, str]] = {}
MAX_NICKNAME_LENGTH = 30


def _clear_nickname(client_id: str, websocket: WebSocket) -> None:
    """Remove a client's nickname, but only if this WebSocket still owns it.

    Mirrors the identity guard in presence.remove_user: on a view switch the
    new connection sets its nickname before the old connection's cleanup runs.

    Args:
        client_id: The client (session) ID whose nickname should be removed.
        websocket: The WebSocket requesting the removal.
    """
    entry = _nickname_map.get(client_id)
    if entry is None:
        return
    if entry[0] is not websocket:
        log.debug(
            "Ignoring nickname clear for client {} - WebSocket mismatch (view switch)",
            client_id,
        )
        return
    _nickname_map.pop(client_id, None)


def _is_another_members_name(nickname: str, username: str) -> bool:
    """Whether a nickname is the sign-in name of another connected member.

    Compared case-insensitively, so nobody can post as 'Jon' while jon is
    here. Only members connected right now are known, so this is partial
    protection: it can't reserve the names of people who are offline.

    Args:
        nickname: The requested nickname (already trimmed).
        username: The requester's own sign-in name, which they may always use.
    """
    folded = nickname.casefold()
    return any(
        user.username != username and user.username.casefold() == folded
        for user in presence.get_active_users().values()
    )


def _channel_stamp(client_id: str) -> chat.ChannelStamp | None:
    """The sender's channel for a chat message, if others may see it.

    Taken from the server's presence for this connection, never from the
    client's message. None while presence is off, when the sender hides what
    they watch, or before they have reported a channel.

    Args:
        client_id: The sender's connection (session) id.
    """
    user = presence_broadcast.shown_channel(client_id)
    if user is None or user.current_channel is None:
        return None
    return chat.ChannelStamp(
        channel_name=user.current_channel,
        channel_id=user.current_channel_id,
        programme=user.current_programme,
        view=user.view,
    )


async def _suggested_channel(channel_id: str) -> Channel | None:
    """The channel a suggestion names, from the server's own catalogue.

    Resolved the way PUT /channels/current resolves a switch, so a suggestion
    that is posted can be put on. None for an id nobody can switch to (not in
    the catalogue, malformed, or the catalogue is unavailable).

    Args:
        channel_id: The channel id the client suggested.
    """
    try:
        return (await resolve_media_channel(channel_id)).channel
    except HTTPException:
        return None


async def _ack_chat(
    websocket: WebSocket, client_message_id: str | None, message_id: str | None
) -> None:
    """Confirm a chat send that asked for it: accepted with its id, or refused.

    Args:
        websocket: The sender's WebSocket.
        client_message_id: The client's id for the send; without one, nothing is sent.
        message_id: The stored message's id, or None if the send was refused.
    """
    if not client_message_id:
        return
    ack: dict[str, object] = {
        "type": "chat_ack",
        "clientMessageId": client_message_id,
        "accepted": message_id is not None,
    }
    if message_id is not None:
        ack["messageId"] = message_id
    await websocket.send_json(ack)


async def verify_websocket_token(token: str) -> dict | None:
    """Verify JWT token for WebSocket connection.

    Args:
        token: JWT token string.

    Returns:
        Token payload dict if valid, None otherwise.
    """
    try:
        payload = verify_token(token)
        return {
            "sub": payload.sub,
            "role": payload.role,
            "exp": payload.exp.timestamp(),
            "plex_id": payload.plex_id,
        }
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

    # Accept before validating: closing a WebSocket before the handshake
    # completes is turned into a plain HTTP 403, so the client would see 1006
    # instead of the 4001 auth-failure code it acts on.
    await websocket.accept()

    payload = await verify_websocket_token(token)
    if not payload or time.time() >= payload["exp"]:
        log.warning("WebSocket auth failed for client {}", client_id)
        await websocket.close(code=4001, reason="Invalid token")
        return

    log.info("WebSocket connected: client {} (user={})", client_id, payload.get("sub"))
    user_id = chat.user_id_for(payload["sub"], payload.get("plex_id"))

    # Track the accepted connection
    await channel_state.connect(websocket, owner=asyncio.current_task())

    # Track user presence
    view_type = "ersatztv" if view == "ersatztv" else "live"
    presence.track_user(
        connection_id=client_id,
        username=payload["sub"],  # Key guaranteed by verify_websocket_token
        view=view_type,
        websocket=websocket,
        user_id=user_id,
    )
    presence_broadcast.schedule_broadcast()

    try:
        async with asyncio.timeout(max(0, payload["exp"] - time.time())):
            # Send connection acknowledgment with current channel and settings
            current = channel_state.get_current_channel()
            ack_message = {
                "type": "connection_ack",
                "currentChannel": current.model_dump(by_alias=True) if current else None,
                "settings": app_settings.get_app_settings().model_dump(by_alias=True),
                # Tell the client who it is signed in as, so chat can default
                # to the sign-in name (Plex logins don't store a username), and
                # the id its own messages carry whatever name they show.
                "you": {"username": payload["sub"], "userId": user_id},
                # Who else is here (and, if the admin allows it, what they watch)
                "presence": presence_broadcast.build_snapshot(),
            }
            await websocket.send_json(ack_message)

            # Send chat history if chat is enabled
            if settings.chat_enabled:
                history = chat.get_history(limit=50)
                # Channels stamped earlier follow today's privacy: none while
                # presence is off, and none for a sender who now hides theirs
                channels_visible = app_settings.presence_visible_enabled()
                hidden = presence_broadcast.hidden_people()
                history_message = {
                    "type": "chat_history",
                    "messages": [
                        msg.to_dict(show_channel=channels_visible and msg.user_id not in hidden)
                        for msg in history
                    ],
                }
                await websocket.send_json(history_message)

            # Listen for client messages
            username = payload["sub"]
            while True:
                data = await websocket.receive_text()
                if time.time() >= payload["exp"]:
                    raise TimeoutError
                if len(data.encode("utf-8")) > MAX_MESSAGE_BYTES:
                    await websocket.close(code=1009, reason="Message too large")
                    return
                try:
                    message = json.loads(data)
                    await handle_client_message(websocket, message, client_id, username, user_id)
                except json.JSONDecodeError:
                    log.debug("Malformed JSON from client {}", client_id)
    except TimeoutError:
        # Remove from broadcasts before awaiting transport shutdown.
        channel_state.disconnect(websocket)
        await asyncio.wait_for(websocket.close(code=4001, reason="Token expired"), timeout=1)
    except WebSocketDisconnect:
        log.info("WebSocket disconnected: client {}", client_id)
    except Exception as e:
        log.error("WebSocket error for client {}: {}", client_id, e)
    finally:
        # Always clean up on disconnect
        # Pass websocket to avoid race condition on view switch
        presence.remove_user(client_id, websocket)
        channel_state.disconnect(websocket)
        # Clean up nickname (same websocket-identity guard as presence)
        _clear_nickname(client_id, websocket)
        presence_broadcast.schedule_broadcast()


async def handle_client_message(
    websocket: WebSocket, message: object, client_id: str, username: str, user_id: str
) -> None:
    """Handle incoming client messages.

    Args:
        websocket: The WebSocket connection.
        message: Parsed JSON message from client.
        client_id: Unique client identifier for logging.
        username: Authenticated username of the client.
        user_id: The client's stable chat id (chat.user_id_for).
    """
    # Preserve forward compatibility for unknown types, but never store unchecked data.
    if (
        isinstance(message, dict)
        and isinstance(message.get("type"), str)
        and message["type"]
        not in {
            "ping",
            "channel_update",
            "set_nickname",
            "set_presence_prefs",
            "chat_message",
            "share",
            "suggest",
        }
    ):
        return
    try:
        validated = client_message_adapter.validate_python(message).model_dump()
    except ValidationError:
        await websocket.send_json({"type": "error", "code": "invalid_message"})
        return

    msg_type = validated.get("type")

    if msg_type == "ping":
        log.debug("Ping from client {}, sending pong", client_id)
        presence.update_last_activity(client_id)
        await websocket.send_json({"type": "pong"})
    elif msg_type == "channel_update":
        channel = validated.get("channel")
        programme = validated.get("programme")
        view = validated.get("view")
        presence.update_user_channel(
            client_id, channel, programme, view, channel_id=validated.get("channelId")
        )
        # Every update, including a programme rollover on the same channel
        presence_broadcast.schedule_broadcast()
        log.debug(
            "Channel update from client {}: {} - {} (view: {})",
            client_id,
            channel,
            programme,
            view or "unchanged",
        )
    elif msg_type == "set_nickname":
        # Handle nickname setting for chat display name
        nickname = validated.get("nickname", "").strip()[:MAX_NICKNAME_LENGTH]
        if nickname and _is_another_members_name(nickname, username):
            # Refused: the previous name (or the sign-in name) stays in use
            log.debug("Nickname refused for client {}: another member's name", client_id)
            await websocket.send_json(
                {"type": "error", "code": "nickname_taken", "nickname": nickname}
            )
        elif nickname:
            _nickname_map[client_id] = (websocket, nickname)
            presence.set_nickname(client_id, nickname)
            presence_broadcast.schedule_broadcast()
            log.debug("Nickname set for client {}: {}", client_id, nickname)
        else:
            # Empty nickname - remove from map (fall back to auth username)
            _clear_nickname(client_id, websocket)
            presence.set_nickname(client_id, None)
            presence_broadcast.schedule_broadcast()
            log.debug("Nickname cleared for client {}", client_id)

    elif msg_type == "set_presence_prefs":
        presence.set_hide_activity(client_id, validated["hideActivity"])
        presence_broadcast.schedule_broadcast()
        log.debug("Presence prefs from client {}: hide={}", client_id, validated["hideActivity"])

    elif msg_type in ("chat_message", "share", "suggest"):
        client_message_id = validated.get("clientMessageId")
        # Handle chat messages only if chat is enabled
        if not settings.chat_enabled:
            log.debug("Chat message ignored from client {} - chat disabled", client_id)
            await _ack_chat(websocket, client_message_id, None)
            return

        original_id = (
            chat.find_recent_send(username, client_message_id) if client_message_id else None
        )
        if original_id is not None:
            # A retry of a send we already stored and broadcast: confirm it again
            log.debug("Repeated chat send from {} acknowledged without reposting", username)
            await _ack_chat(websocket, client_message_id, original_id)
            return

        # Use nickname if set, otherwise fall back to auth username
        nickname_entry = _nickname_map.get(client_id)
        display_name = nickname_entry[1] if nickname_entry else username
        if msg_type == "share":
            # Refused (None) while the sender's channel is private or unknown
            stamp = _channel_stamp(client_id)
            chat_msg = chat.add_share(display_name, stamp, user_id=user_id) if stamp else None
        elif msg_type == "suggest":
            # Refused (None) for a channel the catalogue doesn't have
            suggested = await _suggested_channel(validated["channelId"])
            chat_msg = (
                chat.add_suggestion(display_name, suggested.id, suggested.name, user_id=user_id)
                if suggested
                else None
            )
        else:
            content = validated.get("content", "")
            chat_msg = chat.add_message(
                display_name, content, user_id=user_id, channel=_channel_stamp(client_id)
            )

        if chat_msg:
            if client_message_id:
                # Recorded before the broadcast awaits, so a retry can't slip in between
                chat.remember_send(username, client_message_id, chat_msg.message_id)
            # Broadcast to all connected clients
            broadcast_message = {
                "type": "chat_message",
                **chat_msg.to_dict(),
            }
            await channel_state.broadcast(broadcast_message)
            await _ack_chat(websocket, client_message_id, chat_msg.message_id)
            log.debug("Chat message broadcast from {}: {}", username, chat_msg.message_id[:8])
        else:
            log.debug("Chat {} from {} rejected (empty/invalid/private)", msg_type, username)
            await _ack_chat(websocket, client_message_id, None)
    else:
        # Log unknown message types for debugging
        log.debug("Unknown WebSocket message type from client {}: {}", client_id, msg_type)
