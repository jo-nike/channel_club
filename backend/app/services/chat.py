"""Chat service for managing real-time chat messages.

This service maintains in-memory storage of chat messages using a circular buffer.
Messages are broadcast to all connected clients via WebSocket.
The history resets on server restart (acceptable for this use case).
"""

import hashlib
import hmac
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import uuid4

from loguru import logger

from app.config import settings
from app.models.auth import account_key
from app.services.presence import View

# Module-level logger with service context
log = logger.bind(service="chat")

# Maximum message length after sanitization
MAX_MESSAGE_LENGTH = 500

# Maximum messages to store in history
MAX_HISTORY_SIZE = 100

# Maximum age for messages (24 hours)
MAX_MESSAGE_AGE = timedelta(hours=24)

# Sender name on system lines, so clients that predate `kind` still show them
SYSTEM_USERNAME = "Live TV"

# 'user' is a member's message, 'system' a line the server posts about a shared
# event (someone changing Live), 'share' a now-playing card, 'suggestion' a
# member asking for a channel on live TV
MessageKind = Literal["user", "system", "share", "suggestion"]


@dataclass(frozen=True)
class ChannelStamp:
    """Where a sender was watching when they posted, taken from presence.

    Only set when others may see it: the admin shows what everyone is
    watching and the sender doesn't hide it (see presence_broadcast).
    """

    channel_name: str
    channel_id: str | None = None
    programme: str | None = None
    view: View | None = None


@dataclass
class ChatMessage:
    """Represents a single chat message."""

    message_id: str
    username: str
    content: str
    # Stable id of the sender's account (see user_id_for); the display name can change
    user_id: str = ""
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))
    kind: MessageKind = "user"
    # The sender's channel when they posted, or None when it isn't shown
    channel: ChannelStamp | None = None

    def to_dict(self, show_channel: bool = True) -> dict:
        """Convert to JSON-serializable dictionary with camelCase keys.

        Args:
            show_channel: Include the sender's channel. False empties the
                channel fields, e.g. replaying history after the admin has
                turned presence off or for a sender who now hides it. A
                share card and a suggestion always keep their channel.
        """
        # A share card is the sender's own post about their channel, and a
        # suggestion's channel is the one suggested, not where the sender is,
        # so both keep it (their content names the channel anyway)
        keeps_channel = self.kind in ("share", "suggestion")
        channel = self.channel if show_channel or keeps_channel else None
        return {
            "messageId": self.message_id,
            "username": self.username,
            "userId": self.user_id,
            "content": self.content,
            "timestamp": self.timestamp.isoformat(),
            "kind": self.kind,
            "channelId": channel.channel_id if channel else None,
            "channelName": channel.channel_name if channel else None,
            "programme": channel.programme if channel else None,
            "view": channel.view if channel else None,
        }


# Circular buffer - max 100 messages
_chat_history: deque[ChatMessage] = deque(maxlen=MAX_HISTORY_SIZE)

# Recently accepted chat sends as (username, clientMessageId) -> stored message
# id, so a client retrying a send it couldn't confirm gets the original
# acknowledgement instead of posting a duplicate. Kept next to the history so
# clearing one clears the other.
_recent_sends: OrderedDict[tuple[str, str], str] = OrderedDict()
MAX_RECENT_SENDS = 256

# Sends being handled right now as (username, clientMessageId), marked before
# any await, so a retry arriving meanwhile (say on a reconnected socket while a
# lookup is slow) is refused instead of posting a second copy
_sends_in_flight: set[tuple[str, str]] = set()


def user_id_for(username: str, plex_id: str | None) -> str:
    """Derive the opaque chat id for a signed-in account.

    Plex accounts are keyed on their account id, which survives a Plex rename;
    local accounts on their username. The id is an HMAC under the JWT secret,
    so it is stable across sessions and restarts but never exposes the raw Plex
    account id to other members' browsers.

    Args:
        username: The authenticated username (JWT sub).
        plex_id: The Plex account id, or None for a local sign-in.

    Returns:
        'u_' followed by 16 hex characters.
    """
    account = account_key(username, plex_id)
    digest = hmac.new(
        settings.jwt_secret.get_secret_value().encode(), account.encode(), hashlib.sha256
    )
    return "u_" + digest.hexdigest()[:16]


def _prune_expired() -> None:
    """Remove messages older than MAX_MESSAGE_AGE from the history."""
    cutoff = datetime.now(UTC) - MAX_MESSAGE_AGE
    while _chat_history and _chat_history[0].timestamp < cutoff:
        _chat_history.popleft()


def sanitize_message(content: str) -> str | None:
    """Sanitize a chat message content.

    Applies the following sanitization rules:
    1. Trim whitespace
    2. Limit to MAX_MESSAGE_LENGTH characters (truncate, don't reject)
    3. Return None if empty after sanitization

    Args:
        content: The raw message content from the user.

    Returns:
        Sanitized message string, or None if the message is empty after sanitization.
    """
    if not content:
        log.debug("Empty message content received")
        return None

    # Note: No html.escape() here — content is sent as JSON via WebSocket
    # and rendered by React, which auto-escapes text content (XSS-safe).
    # html.escape() caused double-escaping (e.g. ' → &#x27; shown literally).

    # Trim whitespace
    sanitized = content.strip()

    # Reject if empty after trimming
    if not sanitized:
        log.debug("Message empty after sanitization")
        return None

    # Truncate to max length
    if len(sanitized) > MAX_MESSAGE_LENGTH:
        log.debug(
            "Message truncated from {} to {} characters",
            len(sanitized),
            MAX_MESSAGE_LENGTH,
        )
        sanitized = sanitized[:MAX_MESSAGE_LENGTH]

    return sanitized


def add_message(
    username: str, content: str, user_id: str = "", channel: ChannelStamp | None = None
) -> ChatMessage | None:
    """Add a new chat message to the history.

    The content will be sanitized before adding. If the content is empty
    or invalid after sanitization, None is returned.

    Args:
        username: The username of the message sender.
        content: The raw message content.
        user_id: The sender's stable chat id (see user_id_for).
        channel: The sender's channel, when others may see it.

    Returns:
        The created ChatMessage, or None if the message was rejected.
    """
    sanitized_content = sanitize_message(content)

    if sanitized_content is None:
        log.debug("Message from {} rejected after sanitization", username)
        return None

    message = ChatMessage(
        message_id=str(uuid4()),
        username=username,
        content=sanitized_content,
        user_id=user_id,
        channel=channel,
    )

    _prune_expired()
    _chat_history.append(message)
    log.debug(
        "Chat message added: {} from {} (history size: {})",
        message.message_id[:8],
        username,
        len(_chat_history),
    )

    return message


def add_share(username: str, channel: ChannelStamp, user_id: str = "") -> ChatMessage:
    """Add a 'share what I'm watching' card to the history.

    The channel comes from the server's presence, never from the client. The
    content says the same in words, so clients that predate `kind` show it
    as an ordinary message.

    Args:
        username: The display name of the sender.
        channel: The sender's channel, programme and view.
        user_id: The sender's stable chat id (see user_id_for).

    Returns:
        The stored ChatMessage of kind 'share'.
    """
    content = f"Watching {channel.channel_name}"
    if channel.programme:
        content += f" · {channel.programme}"
    message = ChatMessage(
        message_id=str(uuid4()),
        username=username,
        content=content[:MAX_MESSAGE_LENGTH],
        user_id=user_id,
        kind="share",
        channel=channel,
    )

    _prune_expired()
    _chat_history.append(message)
    log.debug("Share added: {} from {}", message.message_id[:8], username)

    return message


def add_suggestion(
    username: str, channel_id: str, channel_name: str, user_id: str = ""
) -> ChatMessage:
    """Add a suggestion to put a channel on live TV to the history.

    The channel is one the server resolved from its own catalogue, never a
    name from the client, so whoever accepts it switches to what the card
    says. Its view is left empty: it's the channel suggested, not where the
    sender is watching. The content says the same in words, so clients that
    predate `kind` show it as an ordinary message.

    Args:
        username: The display name of the sender.
        channel_id: The suggested channel's catalogue id.
        channel_name: The suggested channel's name.
        user_id: The sender's stable chat id (see user_id_for).

    Returns:
        The stored ChatMessage of kind 'suggestion'.
    """
    content = f"Suggests putting {channel_name} on live TV"
    message = ChatMessage(
        message_id=str(uuid4()),
        username=username,
        content=content[:MAX_MESSAGE_LENGTH],
        user_id=user_id,
        kind="suggestion",
        channel=ChannelStamp(channel_name=channel_name, channel_id=channel_id),
    )

    _prune_expired()
    _chat_history.append(message)
    log.debug("Suggestion added: {} from {}", message.message_id[:8], username)

    return message


def system_message(content: str) -> ChatMessage:
    """Build a system line about a shared event, without storing it.

    System lines are ephemeral: they are broadcast to whoever is connected but
    never enter the history, so a run of Live changes can't push members'
    messages out of the MAX_HISTORY_SIZE buffer. The content is the full
    sentence, so clients that ignore `kind` still render it as a message.

    Args:
        content: The line to show, e.g. "jon put on TSN 5".

    Returns:
        A ChatMessage of kind 'system' from SYSTEM_USERNAME.
    """
    return ChatMessage(
        message_id=str(uuid4()),
        username=SYSTEM_USERNAME,
        content=content,
        kind="system",
    )


def get_history(limit: int = 50) -> list[ChatMessage]:
    """Get recent chat messages from history.

    Args:
        limit: Maximum number of messages to return (default: 50).

    Returns:
        List of ChatMessage objects, ordered from oldest to newest.
    """
    _prune_expired()
    # Convert deque to list and return last 'limit' messages
    history_list = list(_chat_history)

    if limit >= len(history_list):
        return history_list

    return history_list[-limit:]


def find_recent_send(username: str, client_message_id: str) -> str | None:
    """Look up the message stored for a client's earlier send, if it is remembered.

    Args:
        username: The authenticated sender.
        client_message_id: The client's id for the send.

    Returns:
        The stored message id, or None if this send hasn't been accepted.
    """
    return _recent_sends.get((username, client_message_id))


def remember_send(username: str, client_message_id: str, message_id: str) -> None:
    """Remember an accepted send so a retry is acknowledged instead of reposted.

    Only the most recent MAX_RECENT_SENDS sends are kept, oldest dropped first.

    Args:
        username: The authenticated sender.
        client_message_id: The client's id for the send.
        message_id: The id of the stored message.
    """
    _recent_sends[(username, client_message_id)] = message_id
    if len(_recent_sends) > MAX_RECENT_SENDS:
        _recent_sends.popitem(last=False)


def begin_send(username: str, client_message_id: str) -> bool:
    """Mark a send as in flight, unless the same send already is.

    Args:
        username: The authenticated sender.
        client_message_id: The client's id for the send.

    Returns:
        True if the caller now owns the send (and must call end_send), False
        if the same send is already being handled.
    """
    key = (username, client_message_id)
    if key in _sends_in_flight:
        return False
    _sends_in_flight.add(key)
    return True


def end_send(username: str, client_message_id: str) -> None:
    """Clear a send's in-flight mark, whether it was stored, refused or failed.

    Args:
        username: The authenticated sender.
        client_message_id: The client's id for the send.
    """
    _sends_in_flight.discard((username, client_message_id))


def clear_history() -> None:
    """Clear all chat history and the remembered sends that pointed into it.

    A retry of a send from before the clear then posts a new message, rather
    than being acknowledged with a message id that no longer exists.
    """
    _chat_history.clear()
    _recent_sends.clear()
    _sends_in_flight.clear()
    log.debug("Chat history cleared")


def get_history_count() -> int:
    """Get the current number of messages in history.

    Returns:
        Number of messages currently stored.
    """
    return len(_chat_history)
