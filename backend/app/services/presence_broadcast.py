"""Presence snapshot shared with every member: who is here and what they watch.

The presence service tracks one entry per WebSocket connection, so a person
with two tabs (or a phone and a TV) appears twice there. The snapshot built
here has one entry per person, taken from the connection that most recently
started watching something.

Channels are private by default: unless an admin turns on "Show what everyone
is watching" (app_settings.presence_visible), and for anyone who chose "Hide
what I'm watching", the entry carries the name only.

Every change (connect, disconnect, channel or programme change, nickname,
privacy preference, visibility setting, stale cleanup) calls
schedule_broadcast(), which coalesces bursts into one presence_update per
second carrying the snapshot as it is when sent.
"""

import asyncio
from typing import TypedDict

from app.services import app_settings, channel_state, presence
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


def _entry(user: UserPresence, show_channel: bool) -> PresenceEntry:
    name = user.nickname or user.username
    if not show_channel:
        return {
            "userId": user.user_id,
            "displayName": name,
            "channelId": None,
            "channelName": None,
            "programme": None,
            "view": None,
            "since": None,
        }
    return {
        "userId": user.user_id,
        "displayName": name,
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

    Channel fields are left empty when presence visibility is off, and for a
    person who hides their activity on any of their connections.

    Returns:
        One entry per person, from the connection with the latest channel start.
    """
    visible = app_settings.presence_visible_enabled()
    latest: dict[str, UserPresence] = {}
    hidden: set[str] = set()
    for user in presence.get_active_users().values():
        key = user.user_id or user.username
        if user.hide_activity:
            hidden.add(key)
        if user.current_channel is None:
            continue
        kept = latest.get(key)
        if kept is None or _started(user) > _started(kept):
            latest[key] = user

    entries = [_entry(user, visible and key not in hidden) for key, user in latest.items()]
    entries.sort(key=lambda e: (e["displayName"].casefold(), e["userId"] or ""))
    return entries


# Changes within this window share one presence_update
BROADCAST_DEBOUNCE_SECONDS = 1.0

# The broadcast waiting out the debounce window, if any
_pending: asyncio.Task | None = None
# Strong references to broadcast tasks until they finish (the event loop only
# keeps weak ones)
_tasks: set[asyncio.Task] = set()


def schedule_broadcast() -> None:
    """Send everyone a presence_update within about a second.

    Calls while one is already waiting are folded into it. The snapshot is
    built when the message is sent, so it reflects the last of the changes.
    Must be called from the event loop.
    """
    global _pending
    if _pending is not None and not _pending.done():
        return
    task = asyncio.create_task(_broadcast_after_debounce())
    _pending = task
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _broadcast_after_debounce() -> None:
    global _pending
    await asyncio.sleep(BROADCAST_DEBOUNCE_SECONDS)
    # Let changes made while this broadcast is being sent schedule a new one
    _pending = None
    await channel_state.broadcast({"type": "presence_update", "presence": build_snapshot()})


def cancel_pending() -> None:
    """Cancel scheduled and in-flight presence broadcasts (on shutdown)."""
    for task in list(_tasks):
        task.cancel()
