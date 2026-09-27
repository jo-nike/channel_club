"""Presence snapshot shared with every member: who is here and what they watch.

The presence service tracks one entry per WebSocket connection, so a person
with two tabs (or a phone and a TV) appears twice there. The snapshot built
here has one entry per person, taken from the connection that most recently
started watching something.
"""

from typing import TypedDict

from app.services import presence
from app.services.presence import UserPresence, View


class PresenceEntry(TypedDict):
    """One person in the presence snapshot (camelCase, as sent to clients)."""

    userId: str | None
    displayName: str
    channelId: str | None
    channelName: str | None
    programme: str | None
    view: View | None
    since: str | None


def _started(user: UserPresence) -> float:
    """When a connection started its current channel (or connected, if unknown)."""
    return (user.channel_since or user.connected_since).timestamp()


def _entry(user: UserPresence) -> PresenceEntry:
    return {
        "userId": user.user_id,
        "displayName": user.nickname or user.username,
        "channelId": user.current_channel_id,
        "channelName": user.current_channel,
        "programme": user.current_programme,
        "view": user.view,
        "since": user.channel_since.isoformat() if user.channel_since else None,
    }


def build_snapshot() -> list[PresenceEntry]:
    """Build the presence snapshot: one entry per person, sorted by name.

    Connections that have not reported a channel yet are skipped. A new
    connection reports view 'live' until its first channel_update arrives, so
    including it would briefly show its owner watching the live channel.

    Returns:
        One entry per person, from the connection with the latest channel start.
    """
    latest: dict[str, UserPresence] = {}
    for user in presence.get_active_users().values():
        if user.current_channel is None:
            continue
        key = user.user_id or user.username
        kept = latest.get(key)
        if kept is None or _started(user) > _started(kept):
            latest[key] = user

    entries = [_entry(user) for user in latest.values()]
    entries.sort(key=lambda e: (e["displayName"].casefold(), e["userId"] or ""))
    return entries
