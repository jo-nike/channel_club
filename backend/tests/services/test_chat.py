"""Tests for chat service."""

import hashlib
import hmac

import pytest

from app.config import settings
from app.services import chat


@pytest.fixture(autouse=True)
def reset_chat_state():
    """Reset chat state before each test."""
    chat.clear_history()
    yield
    chat.clear_history()


class TestSanitizeMessage:
    """Tests for sanitize_message function."""

    def test_preserves_special_characters(self) -> None:
        """Should preserve special characters as-is (React handles XSS)."""
        result = chat.sanitize_message("<script>alert('xss')</script>")
        assert result == "<script>alert('xss')</script>"

    def test_trims_whitespace(self) -> None:
        """Should trim leading and trailing whitespace."""
        result = chat.sanitize_message("  hello world  ")
        assert result == "hello world"

    def test_returns_none_for_empty_string(self) -> None:
        """Should return None for empty string."""
        result = chat.sanitize_message("")
        assert result is None

    def test_returns_none_for_whitespace_only(self) -> None:
        """Should return None for whitespace-only string."""
        result = chat.sanitize_message("   \n\t  ")
        assert result is None

    def test_returns_none_for_none_content(self) -> None:
        """Should return None when content is None."""
        result = chat.sanitize_message(None)  # type: ignore
        assert result is None

    def test_truncates_to_max_length(self) -> None:
        """Should truncate messages exceeding MAX_MESSAGE_LENGTH."""
        long_message = "a" * 600
        result = chat.sanitize_message(long_message)
        assert result is not None
        assert len(result) == 500

    def test_preserves_valid_message(self) -> None:
        """Should preserve valid message content."""
        result = chat.sanitize_message("Hello everyone!")
        assert result == "Hello everyone!"


class TestAddMessage:
    """Tests for add_message function."""

    def test_adds_message_to_history(self) -> None:
        """Should add message to chat history."""
        result = chat.add_message("testuser", "Hello!")
        assert result is not None
        assert result.username == "testuser"
        assert result.content == "Hello!"
        assert len(result.message_id) > 0

    def test_returns_none_for_empty_content(self) -> None:
        """Should return None when content is empty after sanitization."""
        result = chat.add_message("testuser", "")
        assert result is None

    def test_returns_none_for_whitespace_content(self) -> None:
        """Should return None when content is only whitespace."""
        result = chat.add_message("testuser", "   ")
        assert result is None

    def test_preserves_html_in_content(self) -> None:
        """Should preserve HTML in content (React handles XSS on render)."""
        result = chat.add_message("testuser", "<b>bold</b>")
        assert result is not None
        assert result.content == "<b>bold</b>"

    def test_stores_the_sender_user_id(self) -> None:
        """Should keep the sender's stable id alongside the display name."""
        result = chat.add_message("Nick", "Hello!", user_id="u_0123456789abcdef")
        assert result is not None
        assert result.user_id == "u_0123456789abcdef"
        assert chat.get_history()[-1].user_id == "u_0123456789abcdef"

    def test_user_id_defaults_to_empty(self) -> None:
        """Callers that don't pass a user id still work."""
        result = chat.add_message("testuser", "Hello!")
        assert result is not None
        assert result.user_id == ""

    def test_generates_unique_message_ids(self) -> None:
        """Should generate unique message IDs for each message."""
        msg1 = chat.add_message("user1", "Hello")
        msg2 = chat.add_message("user2", "World")
        assert msg1 is not None
        assert msg2 is not None
        assert msg1.message_id != msg2.message_id

    def test_includes_timestamp(self) -> None:
        """Should include timestamp on message."""
        result = chat.add_message("testuser", "Hello")
        assert result is not None
        assert result.timestamp is not None


class TestGetHistory:
    """Tests for get_history function."""

    def test_returns_empty_list_when_no_messages(self) -> None:
        """Should return empty list when no messages."""
        result = chat.get_history()
        assert result == []

    def test_returns_all_messages_when_less_than_limit(self) -> None:
        """Should return all messages when fewer than limit."""
        chat.add_message("user1", "Message 1")
        chat.add_message("user2", "Message 2")
        chat.add_message("user3", "Message 3")

        result = chat.get_history(limit=50)
        assert len(result) == 3

    def test_returns_limited_messages(self) -> None:
        """Should return only 'limit' messages when more exist."""
        for i in range(10):
            chat.add_message(f"user{i}", f"Message {i}")

        result = chat.get_history(limit=5)
        assert len(result) == 5

    def test_returns_most_recent_messages(self) -> None:
        """Should return the most recent messages when limited."""
        for i in range(10):
            chat.add_message("user", f"Message {i}")

        result = chat.get_history(limit=3)
        assert len(result) == 3
        # Should be messages 7, 8, 9 (most recent)
        assert result[0].content == "Message 7"
        assert result[1].content == "Message 8"
        assert result[2].content == "Message 9"

    def test_preserves_message_order(self) -> None:
        """Should preserve chronological order (oldest first)."""
        chat.add_message("user1", "First")
        chat.add_message("user2", "Second")
        chat.add_message("user3", "Third")

        result = chat.get_history()
        assert result[0].content == "First"
        assert result[1].content == "Second"
        assert result[2].content == "Third"

    def test_default_limit_is_50(self) -> None:
        """Should default to limit of 50 messages."""
        for i in range(60):
            chat.add_message("user", f"Message {i}")

        result = chat.get_history()
        assert len(result) == 50


class TestCircularBuffer:
    """Tests for circular buffer behavior."""

    def test_buffer_max_size_is_100(self) -> None:
        """Should not exceed MAX_HISTORY_SIZE (100) messages."""
        for i in range(150):
            chat.add_message("user", f"Message {i}")

        # Direct access to check buffer size
        assert len(chat._chat_history) == 100

    def test_oldest_messages_removed_when_full(self) -> None:
        """Should remove oldest messages when buffer is full."""
        for i in range(110):
            chat.add_message("user", f"Message {i}")

        history = chat.get_history(limit=100)
        # Oldest should be message 10 (0-9 were pushed out)
        assert history[0].content == "Message 10"
        # Newest should be message 109
        assert history[-1].content == "Message 109"


class TestChatMessage:
    """Tests for ChatMessage dataclass."""

    def test_to_dict_uses_camelcase(self) -> None:
        """Should use camelCase for JSON serialization."""
        msg = chat.add_message("testuser", "Hello")
        assert msg is not None

        msg_dict = msg.to_dict()
        assert "messageId" in msg_dict
        assert "username" in msg_dict
        assert "userId" in msg_dict
        assert "content" in msg_dict
        assert "timestamp" in msg_dict

    def test_to_dict_includes_user_id(self) -> None:
        """Should emit the sender's stable id as userId."""
        msg = chat.add_message("Nick", "Hello", user_id="u_0123456789abcdef")
        assert msg is not None

        assert msg.to_dict()["userId"] == "u_0123456789abcdef"

    def test_to_dict_serializes_timestamp_as_iso(self) -> None:
        """Should serialize timestamp as ISO 8601 string."""
        msg = chat.add_message("testuser", "Hello")
        assert msg is not None

        msg_dict = msg.to_dict()
        timestamp = msg_dict["timestamp"]
        assert isinstance(timestamp, str)
        assert "T" in timestamp  # ISO format includes T separator


class TestUserIdFor:
    """Tests for user_id_for, the opaque chat id of an account."""

    @staticmethod
    def _expected(account: str) -> str:
        digest = hmac.new(settings.jwt_secret.encode(), account.encode(), hashlib.sha256)
        return "u_" + digest.hexdigest()[:16]

    def test_plex_account_is_keyed_on_the_plex_id(self) -> None:
        """A Plex sign-in's id is the HMAC of its account id, not its username."""
        assert chat.user_id_for("plexuser", "12345") == self._expected("plex:12345")

    def test_plex_rename_keeps_the_id(self) -> None:
        """Renaming the Plex account (new sub, same plex_id) keeps the same id."""
        assert chat.user_id_for("oldname", "12345") == chat.user_id_for("newname", "12345")

    def test_local_account_is_keyed_on_the_username(self) -> None:
        """A local sign-in's id is the HMAC of its username."""
        assert chat.user_id_for("testuser", None) == self._expected("local:testuser")
        assert chat.user_id_for("testuser", None) != chat.user_id_for("other", None)

    def test_plex_and_local_ids_never_collide(self) -> None:
        """A local username equal to someone's Plex id is a different account."""
        assert chat.user_id_for("12345", None) != chat.user_id_for("someone", "12345")

    def test_id_is_opaque(self) -> None:
        """The id has a fixed shape and doesn't expose the raw Plex id."""
        user_id = chat.user_id_for("plexuser", "987654321")
        assert len(user_id) == 18
        assert user_id.startswith("u_")
        int(user_id[2:], 16)  # hex
        assert "987654321" not in user_id

    def test_id_depends_on_the_server_secret(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Another deployment's secret gives different ids, so they can't be precomputed."""
        before = chat.user_id_for("plexuser", "12345")
        monkeypatch.setattr(settings, "jwt_secret", "a-different-secret-that-is-long-enough")
        assert chat.user_id_for("plexuser", "12345") != before


class TestClearHistory:
    """Tests for clear_history function."""

    def test_clears_all_messages(self) -> None:
        """Should clear all messages from history."""
        chat.add_message("user1", "Message 1")
        chat.add_message("user2", "Message 2")

        chat.clear_history()

        assert chat.get_history() == []
        assert chat.get_history_count() == 0


class TestGetHistoryCount:
    """Tests for get_history_count function."""

    def test_returns_zero_when_empty(self) -> None:
        """Should return 0 when history is empty."""
        assert chat.get_history_count() == 0

    def test_returns_correct_count(self) -> None:
        """Should return correct message count."""
        chat.add_message("user1", "Message 1")
        chat.add_message("user2", "Message 2")
        chat.add_message("user3", "Message 3")

        assert chat.get_history_count() == 3
