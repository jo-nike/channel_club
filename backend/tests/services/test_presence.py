"""Tests for presence service."""

from datetime import datetime
from unittest.mock import MagicMock

import pytest

from app.services import presence


@pytest.fixture(autouse=True)
def reset_presence_state():
    """Reset presence state before each test."""
    presence._active_users.clear()
    yield
    presence._active_users.clear()


class TestTrackUser:
    """Tests for track_user function."""

    def test_tracks_new_user(self) -> None:
        """Should track a new user with all required fields."""
        result = presence.track_user(
            connection_id="abc123",
            username="testuser",
            view="live",
        )

        assert result.connection_id == "abc123"
        assert result.username == "testuser"
        assert result.view == "live"
        assert result.current_channel is None
        assert isinstance(result.connected_since, datetime)

    def test_tracks_ersatztv_user(self) -> None:
        """Should track ersatztv view user."""
        result = presence.track_user(
            connection_id="xyz789",
            username="moviefan",
            view="ersatztv",
        )

        assert result.view == "ersatztv"

    def test_adds_user_to_active_users(self) -> None:
        """Should add tracked user to active users store."""
        presence.track_user(
            connection_id="conn1",
            username="user1",
            view="live",
        )

        assert "conn1" in presence._active_users
        assert presence._active_users["conn1"].username == "user1"

    def test_stores_websocket_when_provided(self) -> None:
        """Should store websocket reference when provided."""
        mock_ws = MagicMock()

        result = presence.track_user(
            connection_id="conn2",
            username="user2",
            view="live",
            websocket=mock_ws,
        )

        assert result.websocket is mock_ws


class TestRemoveUser:
    """Tests for remove_user function."""

    def test_removes_existing_user(self) -> None:
        """Should remove user from active users."""
        presence.track_user(
            connection_id="abc123",
            username="testuser",
            view="live",
        )

        presence.remove_user("abc123")

        assert "abc123" not in presence._active_users

    def test_removing_nonexistent_user_is_safe(self) -> None:
        """Should not error when removing unknown user."""
        presence.remove_user("nonexistent")  # Should not raise
        assert len(presence._active_users) == 0

    def test_removes_when_websocket_matches(self) -> None:
        """Should remove user when websocket matches stored websocket."""
        mock_ws = MagicMock()
        presence.track_user(
            connection_id="abc123",
            username="testuser",
            view="live",
            websocket=mock_ws,
        )

        presence.remove_user("abc123", websocket=mock_ws)

        assert "abc123" not in presence._active_users

    def test_does_not_remove_when_websocket_mismatch(self) -> None:
        """Should not remove user when websocket doesn't match (view switch case)."""
        old_ws = MagicMock()
        new_ws = MagicMock()

        # User connects with old websocket
        presence.track_user(
            connection_id="session123",
            username="testuser",
            view="live",
            websocket=old_ws,
        )

        # User reconnects (view switch) - entry gets replaced with new websocket
        presence.track_user(
            connection_id="session123",
            username="testuser",
            view="ersatztv",
            websocket=new_ws,
        )

        # Old websocket disconnects - should NOT remove the new entry
        presence.remove_user("session123", websocket=old_ws)

        # Entry should still exist with new websocket
        assert "session123" in presence._active_users
        assert presence._active_users["session123"].view == "ersatztv"
        assert presence._active_users["session123"].websocket is new_ws


class TestUpdateUserChannel:
    """Tests for update_user_channel function."""

    def test_updates_channel_for_existing_user(self) -> None:
        """Should update current channel for tracked user."""
        presence.track_user(
            connection_id="abc123",
            username="testuser",
            view="live",
        )

        presence.update_user_channel("abc123", "BBC One")

        assert presence._active_users["abc123"].current_channel == "BBC One"

    def test_updates_to_none(self) -> None:
        """Should allow setting channel to None."""
        presence.track_user(
            connection_id="abc123",
            username="testuser",
            view="live",
        )
        presence.update_user_channel("abc123", "BBC One")
        presence.update_user_channel("abc123", None)

        assert presence._active_users["abc123"].current_channel is None

    def test_updating_nonexistent_user_is_safe(self) -> None:
        """Should not error when updating unknown user."""
        presence.update_user_channel("nonexistent", "Some Channel")  # Should not raise

    def test_updates_view_type_when_provided(self) -> None:
        """Should update view type when provided (for unified TV view)."""
        presence.track_user(
            connection_id="abc123",
            username="testuser",
            view="live",
        )

        # Verify initial view
        assert presence._active_users["abc123"].view == "live"

        # Switch to ersatztv via channel update
        presence.update_user_channel("abc123", "Movies", "Test Movie", view="ersatztv")

        assert presence._active_users["abc123"].view == "ersatztv"
        assert presence._active_users["abc123"].current_channel == "Movies"
        assert presence._active_users["abc123"].current_programme == "Test Movie"

    def test_view_update_ignores_invalid_values(self) -> None:
        """Should ignore invalid view values."""
        presence.track_user(
            connection_id="abc123",
            username="testuser",
            view="live",
        )

        # Try to set invalid view
        presence.update_user_channel("abc123", "Channel", view="invalid")  # type: ignore

        # View should remain unchanged
        assert presence._active_users["abc123"].view == "live"

    def test_view_update_none_keeps_current_view(self) -> None:
        """Should keep current view when None is passed."""
        presence.track_user(
            connection_id="abc123",
            username="testuser",
            view="ersatztv",
        )

        presence.update_user_channel("abc123", "Channel", view=None)

        assert presence._active_users["abc123"].view == "ersatztv"


class TestGetActiveUsers:
    """Tests for get_active_users function."""

    def test_returns_empty_dict_when_no_users(self) -> None:
        """Should return empty dict when no users tracked."""
        result = presence.get_active_users()
        assert result == {}

    def test_returns_copy_of_active_users(self) -> None:
        """Should return a copy, not the original dict."""
        presence.track_user(
            connection_id="abc123",
            username="testuser",
            view="live",
        )

        result = presence.get_active_users()
        del result["abc123"]

        assert "abc123" in presence._active_users

    def test_returns_all_active_users(self) -> None:
        """Should return all tracked users."""
        presence.track_user(
            connection_id="conn1",
            username="user1",
            view="live",
        )
        presence.track_user(
            connection_id="conn2",
            username="user2",
            view="ersatztv",
        )

        result = presence.get_active_users()

        assert len(result) == 2
        assert "conn1" in result
        assert "conn2" in result


class TestGetUsersByView:
    """Tests for get_users_by_view function."""

    def test_returns_empty_list_when_no_users(self) -> None:
        """Should return empty list when no users of that view."""
        result = presence.get_users_by_view("live")
        assert result == []

    def test_filters_by_live_view(self) -> None:
        """Should return only live view users."""
        presence.track_user(
            connection_id="conn1",
            username="user1",
            view="live",
        )
        presence.track_user(
            connection_id="conn2",
            username="user2",
            view="ersatztv",
        )
        presence.track_user(
            connection_id="conn3",
            username="user3",
            view="live",
        )

        result = presence.get_users_by_view("live")

        assert len(result) == 2
        assert all(u.view == "live" for u in result)
        usernames = [u.username for u in result]
        assert "user1" in usernames
        assert "user3" in usernames

    def test_filters_by_ersatztv_view(self) -> None:
        """Should return only ersatztv view users."""
        presence.track_user(
            connection_id="conn1",
            username="user1",
            view="live",
        )
        presence.track_user(
            connection_id="conn2",
            username="user2",
            view="ersatztv",
        )

        result = presence.get_users_by_view("ersatztv")

        assert len(result) == 1
        assert result[0].username == "user2"
        assert result[0].view == "ersatztv"
