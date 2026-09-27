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
from uuid import uuid4

from loguru import logger

from app.config import settings

# Module-level logger with service context
log = logger.bind(service="chat")

# Maximum message length after sanitization
MAX_MESSAGE_LENGTH = 500

# Maximum messages to store in history
MAX_HISTORY_SIZE = 100

# Maximum age for messages (24 hours)
MAX_MESSAGE_AGE = timedelta(hours=24)


@dataclass
class ChatMessage:
    """Represents a single chat message."""

    message_id: str
    username: str
    content: str
    # Stable id of the sender's account (see user_id_for); the display name can change
    user_id: str = ""
    timestamp: datetime = field(default_factory=lambda: datetime.now(UTC))

    def to_dict(self) -> dict:
        """Convert to JSON-serializable dictionary with camelCase keys."""
        return {
            "messageId": self.message_id,
            "username": self.username,
            "userId": self.user_id,
            "content": self.content,
            "timestamp": self.timestamp.isoformat(),
        }


# Circular buffer - max 100 messages
_chat_history: deque[ChatMessage] = deque(maxlen=MAX_HISTORY_SIZE)

# Recently accepted chat sends as (username, clientMessageId) -> stored message
# id, so a client retrying a send it couldn't confirm gets the original
# acknowledgement instead of posting a duplicate. Kept next to the history so
# clearing one clears the other.
_recent_sends: OrderedDict[tuple[str, str], str] = OrderedDict()
MAX_RECENT_SENDS = 256


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
    account = f"plex:{plex_id}" if plex_id else f"local:{username}"
    digest = hmac.new(settings.jwt_secret.encode(), account.encode(), hashlib.sha256)
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


def add_message(username: str, content: str, user_id: str = "") -> ChatMessage | None:
    """Add a new chat message to the history.

    The content will be sanitized before adding. If the content is empty
    or invalid after sanitization, None is returned.

    Args:
        username: The username of the message sender.
        content: The raw message content.
        user_id: The sender's stable chat id (see user_id_for).

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


def clear_history() -> None:
    """Clear all chat history and the remembered sends that pointed into it.

    A retry of a send from before the clear then posts a new message, rather
    than being acknowledged with a message id that no longer exists.
    """
    _chat_history.clear()
    _recent_sends.clear()
    log.debug("Chat history cleared")


def get_history_count() -> int:
    """Get the current number of messages in history.

    Returns:
        Number of messages currently stored.
    """
    return len(_chat_history)
