"""Tests for the presence snapshot."""

import asyncio
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services import app_settings, presence, presence_broadcast

# Captured at import, before conftest swaps it for a no-op in every test
REAL_SCHEDULE = presence_broadcast.schedule_broadcast


@pytest.fixture(autouse=True)
def reset_presence_state() -> Iterator[None]:
    """Reset presence state before each test."""
    presence._active_users.clear()
    yield
    presence._active_users.clear()


@pytest.fixture
def visible(monkeypatch: pytest.MonkeyPatch) -> None:
    """An admin has turned on "Show what everyone is watching"."""
    monkeypatch.setattr(app_settings, "_presence_visible", True)


NAME_ONLY = {
    "channelId": None,
    "channelName": None,
    "programme": None,
    "view": None,
    "since": None,
}


def watch(
    connection_id: str,
    username: str,
    user_id: str | None,
    channel: str | None,
    *,
    channel_id: str | None = None,
    programme: str | None = None,
    view: presence.View = "live",
    started_ago: float = 0,
) -> presence.UserPresence:
    """Track a connection and put it on a channel that started `started_ago` seconds ago."""
    user = presence.track_user(connection_id, username, view, user_id=user_id)
    presence.update_user_channel(connection_id, channel, programme, view, channel_id=channel_id)
    if user.channel_since is not None:
        user.channel_since = datetime.now(UTC) - timedelta(seconds=started_ago)
    return user


@pytest.mark.usefixtures("visible")
class TestBuildSnapshot:
    """Tests for build_snapshot while presence is visible."""

    def test_empty_when_nobody_is_connected(self) -> None:
        assert presence_broadcast.build_snapshot() == []

    def test_entry_describes_what_the_person_watches(self) -> None:
        """An entry carries the person's id, name, channel, programme, view and start time."""
        user = watch(
            "c1", "jon", "u_1", "Movies", channel_id="ch-7", programme="Heat", view="ersatztv"
        )
        assert user.channel_since is not None

        assert presence_broadcast.build_snapshot() == [
            {
                "userId": "u_1",
                "displayName": "jon",
                "channelId": "ch-7",
                "channelName": "Movies",
                "programme": "Heat",
                "view": "ersatztv",
                "since": user.channel_since.isoformat(),
            }
        ]

    def test_one_entry_per_person_keeping_the_latest_channel(self) -> None:
        """Two tabs of one person collapse to the one that started watching most recently."""
        watch("old-tab", "jon", "u_1", "News", started_ago=600)
        watch("new-tab", "jon", "u_1", "Sports", started_ago=5)
        watch("older-tab", "jon", "u_1", "Kids", started_ago=3600)

        snapshot = presence_broadcast.build_snapshot()

        assert [e["channelName"] for e in snapshot] == ["Sports"]

    def test_dedupe_does_not_depend_on_connection_order(self) -> None:
        """The latest channel wins even when its connection was tracked first."""
        watch("new-tab", "jon", "u_1", "Sports", started_ago=5)
        watch("old-tab", "jon", "u_1", "News", started_ago=600)

        assert [e["channelName"] for e in presence_broadcast.build_snapshot()] == ["Sports"]

    def test_different_people_get_their_own_entries(self) -> None:
        """People are told apart by user id, sorted by display name."""
        watch("c1", "zoe", "u_2", "News")
        watch("c2", "Amy", "u_3", "Sports")
        watch("c3", "jon", "u_1", "Movies")

        snapshot = presence_broadcast.build_snapshot()

        assert [e["displayName"] for e in snapshot] == ["Amy", "jon", "zoe"]

    def test_connection_with_no_channel_yet_is_skipped(self) -> None:
        """A fresh connection reports view 'live' before its first channel_update: skip it."""
        presence.track_user("fresh", "jon", "live", user_id="u_1")

        assert presence_broadcast.build_snapshot() == []

    def test_skipped_connection_does_not_hide_the_persons_channel(self) -> None:
        """A newer tab with no channel yet doesn't replace the tab that is watching."""
        watch("watching", "jon", "u_1", "News", started_ago=600)
        presence.track_user("fresh", "jon", "live", user_id="u_1")

        assert [e["channelName"] for e in presence_broadcast.build_snapshot()] == ["News"]

    def test_cleared_channel_is_skipped(self) -> None:
        """Someone who stopped watching drops out of the snapshot."""
        watch("c1", "jon", "u_1", "News")
        presence.update_user_channel("c1", None)

        assert presence_broadcast.build_snapshot() == []

    def test_display_name_is_the_nickname_when_set(self) -> None:
        """The chat nickname is shown, and the username again once it's cleared."""
        watch("c1", "jon", "u_1", "News")
        presence.set_nickname("c1", "Jonny")

        assert presence_broadcast.build_snapshot()[0]["displayName"] == "Jonny"

        presence.set_nickname("c1", None)

        assert presence_broadcast.build_snapshot()[0]["displayName"] == "jon"

    def test_since_falls_back_to_the_connection_time(self) -> None:
        """Without a channel start time the connection time decides which tab is newest."""
        older = watch("older", "jon", "u_1", "News")
        newer = watch("newer", "jon", "u_1", "Sports")
        older.channel_since = None
        newer.channel_since = None
        older.connected_since = datetime.now(UTC) - timedelta(minutes=10)

        snapshot = presence_broadcast.build_snapshot()

        assert [e["channelName"] for e in snapshot] == ["Sports"]
        assert snapshot[0]["since"] is None


class TestPrivacy:
    """Channel fields are stripped while visibility is off or a person hides."""

    def test_names_only_while_visibility_is_off(self) -> None:
        """The default: others see who is here, not what they watch."""
        watch("c1", "jon", "u_1", "Movies", channel_id="ch-7", programme="Heat")

        assert presence_broadcast.build_snapshot() == [
            {"userId": "u_1", "displayName": "jon", **NAME_ONLY}
        ]

    @pytest.mark.usefixtures("visible")
    def test_person_who_hides_shows_name_only(self) -> None:
        """Hiding strips that person's channel, not anyone else's."""
        watch("c1", "jon", "u_1", "Movies", channel_id="ch-7", programme="Heat")
        watch("c2", "amy", "u_2", "News", channel_id="ch-2")
        presence.set_hide_activity("c1", True)

        snapshot = presence_broadcast.build_snapshot()

        assert snapshot[0]["displayName"] == "amy"
        assert snapshot[0]["channelName"] == "News"
        assert snapshot[1] == {"userId": "u_1", "displayName": "jon", **NAME_ONLY}

    @pytest.mark.usefixtures("visible")
    def test_hiding_on_any_connection_hides_the_person(self) -> None:
        """Hiding on one device also covers the person's other connections."""
        watch("phone", "jon", "u_1", "News", started_ago=600)
        watch("tv", "jon", "u_1", "Movies", started_ago=5)
        presence.set_hide_activity("phone", True)

        assert presence_broadcast.build_snapshot() == [
            {"userId": "u_1", "displayName": "jon", **NAME_ONLY}
        ]

    @pytest.mark.usefixtures("visible")
    def test_unhiding_shows_the_channel_again(self) -> None:
        watch("c1", "jon", "u_1", "Movies")
        presence.set_hide_activity("c1", True)
        presence.set_hide_activity("c1", False)

        assert presence_broadcast.build_snapshot()[0]["channelName"] == "Movies"


@pytest.fixture
async def broadcasts(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[AsyncMock]:
    """Turn presence broadcasts back on with a short debounce; returns the sender."""
    sender = AsyncMock()
    monkeypatch.setattr(presence_broadcast, "schedule_broadcast", REAL_SCHEDULE)
    monkeypatch.setattr(presence_broadcast, "BROADCAST_DEBOUNCE_SECONDS", 0.05)
    monkeypatch.setattr(presence_broadcast.channel_state, "broadcast", sender)
    monkeypatch.setattr(presence_broadcast, "_pending", None)
    yield sender
    presence_broadcast.cancel_pending()
    await asyncio.sleep(0)


async def settle() -> None:
    """Wait past the debounce window."""
    await asyncio.sleep(0.15)


class TestScheduleBroadcast:
    """Tests for the debounced presence_update broadcast."""

    async def test_rapid_updates_send_one_broadcast_with_the_latest_state(
        self, broadcasts: AsyncMock, visible: None
    ) -> None:
        """A burst of changes becomes one presence_update carrying the last of them."""
        watch("c1", "jon", "u_1", "News")
        for programme in ("One", "Two", "Three"):
            presence.update_user_channel("c1", "News", programme)
            presence_broadcast.schedule_broadcast()

        await settle()

        broadcasts.assert_awaited_once()
        message = broadcasts.await_args_list[0].args[0]
        assert message["type"] == "presence_update"
        assert [e["programme"] for e in message["presence"]] == ["Three"]

    async def test_nothing_is_sent_before_the_debounce_window(self, broadcasts: AsyncMock) -> None:
        presence_broadcast.schedule_broadcast()
        await asyncio.sleep(0)

        broadcasts.assert_not_awaited()

    async def test_a_later_change_gets_its_own_broadcast(self, broadcasts: AsyncMock) -> None:
        """Once a broadcast has gone out, the next change schedules another."""
        presence_broadcast.schedule_broadcast()
        await settle()
        watch("c1", "jon", "u_1", "News")
        presence_broadcast.schedule_broadcast()
        await settle()

        assert broadcasts.await_count == 2
        assert broadcasts.await_args_list[0].args[0]["presence"] == []
        assert [e["displayName"] for e in broadcasts.await_args_list[1].args[0]["presence"]] == [
            "jon"
        ]

    async def test_broadcast_respects_privacy(self, broadcasts: AsyncMock) -> None:
        """While visibility is off (the default) the broadcast carries names only."""
        watch("c1", "jon", "u_1", "News", channel_id="ch-1", programme="Weather")
        presence_broadcast.schedule_broadcast()

        await settle()

        assert broadcasts.await_args_list[0].args[0]["presence"] == [
            {"userId": "u_1", "displayName": "jon", **NAME_ONLY}
        ]

    async def test_cancel_pending_stops_a_scheduled_broadcast(self, broadcasts: AsyncMock) -> None:
        presence_broadcast.schedule_broadcast()

        presence_broadcast.cancel_pending()
        await settle()

        broadcasts.assert_not_awaited()

    def test_stale_cleanup_schedules_a_broadcast(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Removing a stale tab tells everyone, whether the timer or an admin swept it."""
        schedule = MagicMock()
        monkeypatch.setattr(presence_broadcast, "schedule_broadcast", schedule)
        presence.track_user("gone", "ghost", "live")
        presence._active_users["gone"].last_activity = datetime.now(UTC) - timedelta(hours=1)

        presence.cleanup_stale_users()

        schedule.assert_called_once_with()

    def test_sweep_that_removes_nobody_does_not_broadcast(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        schedule = MagicMock()
        monkeypatch.setattr(presence_broadcast, "schedule_broadcast", schedule)
        presence.track_user("here", "friend", "live")

        presence.cleanup_stale_users()

        schedule.assert_not_called()
