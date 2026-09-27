"""Tests for the presence snapshot."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest

from app.services import presence, presence_broadcast


@pytest.fixture(autouse=True)
def reset_presence_state() -> Iterator[None]:
    """Reset presence state before each test."""
    presence._active_users.clear()
    yield
    presence._active_users.clear()


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


class TestBuildSnapshot:
    """Tests for build_snapshot."""

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
