"""Tests for WebSocket router."""

from datetime import UTC
from io import StringIO

import pytest
from fastapi.testclient import TestClient
from loguru import logger

from app.config import settings
from app.main import app
from app.routers import websocket as websocket_router
from app.services import channel_state, chat, presence
from app.services.auth import create_access_token


@pytest.fixture
def valid_token() -> str:
    """Create a valid JWT token for testing."""
    return create_access_token({"sub": "testuser", "role": "viewer"})


@pytest.fixture
def admin_token() -> str:
    """Create a valid admin JWT token for testing."""
    return create_access_token({"sub": "admin", "role": "admin"})


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    return TestClient(app)


@pytest.fixture(autouse=True)
def reset_channel_state():
    """Reset channel state before each test."""
    channel_state.clear_current_channel()
    channel_state._active_connections.clear()
    presence._active_users.clear()
    chat.clear_history()
    websocket_router._nickname_map.clear()
    yield
    channel_state.clear_current_channel()
    channel_state._active_connections.clear()
    presence._active_users.clear()
    chat.clear_history()
    websocket_router._nickname_map.clear()


class TestWebSocketConnection:
    """Tests for WebSocket connection handling."""

    def test_websocket_valid_token_accepts_connection(self, client: TestClient, valid_token: str):
        """Valid token accepts connection and sends ack."""
        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            data = ws.receive_json()
            assert data["type"] == "connection_ack"
            assert "currentChannel" in data

    def test_websocket_invalid_token_rejects_connection(self, client: TestClient):
        """Invalid token rejects connection with code 4001."""
        # WebSocket connections with invalid tokens raise an exception
        with (
            pytest.raises((Exception,)),  # noqa: B017
            client.websocket_connect("/api/ws?token=invalid_token"),
        ):
            pass

    def test_websocket_missing_token_rejects_connection(self, client: TestClient):
        """Missing token rejects connection."""
        with (
            pytest.raises((Exception,)),  # noqa: B017
            client.websocket_connect("/api/ws"),
        ):
            pass

    def test_websocket_expired_token_rejects_connection(self, client: TestClient):
        """Expired token rejects connection."""
        # Create an expired token manually
        from datetime import datetime, timedelta

        from jose import jwt

        from app.config import settings

        expired_payload = {
            "sub": "testuser",
            "role": "viewer",
            "exp": datetime.now(UTC) - timedelta(hours=1),
        }
        expired_token = jwt.encode(expired_payload, settings.jwt_secret, algorithm="HS256")

        with (
            pytest.raises((Exception,)),  # noqa: B017
            client.websocket_connect(f"/api/ws?token={expired_token}"),
        ):
            pass


class TestConnectionAck:
    """Tests for connection acknowledgment message."""

    def test_connection_ack_with_no_current_channel(self, client: TestClient, valid_token: str):
        """Connection ack includes null currentChannel when none set."""
        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            data = ws.receive_json()
            assert data["type"] == "connection_ack"
            assert data["currentChannel"] is None

    def test_connection_ack_with_current_channel(self, client: TestClient, valid_token: str):
        """Connection ack includes current channel when set."""
        from app.models.channel import Channel

        test_channel = Channel(
            id="123", name="Test Channel", stream_url="http://test", guide_id="guide-123"
        )
        # Set channel directly without broadcast (sync version for tests)
        channel_state._current_channel = test_channel

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            data = ws.receive_json()
            assert data["type"] == "connection_ack"
            assert data["currentChannel"] is not None
            assert data["currentChannel"]["id"] == "123"
            assert data["currentChannel"]["name"] == "Test Channel"
            # Check camelCase serialization
            assert "streamUrl" in data["currentChannel"]


class TestPingPong:
    """Tests for ping/pong functionality."""

    def test_ping_receives_pong_response(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Ping message receives pong response."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # Consume connection_ack
            ws.send_json({"type": "ping"})
            data = ws.receive_json()
            assert data["type"] == "pong"

    def test_unknown_message_type_handled_gracefully(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Unknown message types are handled without error."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # Consume connection_ack
            ws.send_json({"type": "unknown_type"})
            # Should not crash - send ping to verify connection still works
            ws.send_json({"type": "ping"})
            data = ws.receive_json()
            assert data["type"] == "pong"


class TestConnectionTracking:
    """Tests for connection tracking."""

    def test_connection_added_to_active_connections(self, client: TestClient, valid_token: str):
        """Connection is tracked in active connections."""
        assert channel_state.get_connection_count() == 0

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # Consume connection_ack
            # Connection should be tracked
            assert channel_state.get_connection_count() == 1

        # After disconnect, connection should be removed
        assert channel_state.get_connection_count() == 0

    def test_multiple_connections_tracked(self, client: TestClient, valid_token: str):
        """Multiple connections are tracked separately."""
        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws1:
            ws1.receive_json()
            assert channel_state.get_connection_count() == 1

            with client.websocket_connect(f"/api/ws?token={valid_token}") as ws2:
                ws2.receive_json()
                assert channel_state.get_connection_count() == 2

            # ws2 closed
            assert channel_state.get_connection_count() == 1

        # ws1 closed
        assert channel_state.get_connection_count() == 0


class TestChannelBroadcast:
    """Tests for channel update broadcasting."""

    def test_broadcast_when_channel_changes(
        self,
        client: TestClient,
        valid_token: str,
        admin_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Broadcast channel_update when admin sets channel via API."""
        monkeypatch.setattr(settings, "chat_enabled", False)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # Consume connection_ack

            # Admin sets channel via API
            response = client.put(
                "/api/channels/current",
                json={
                    "id": "test-123",
                    "name": "Test Channel",
                    "streamUrl": "http://test",
                    "guideId": "guide-123",
                },
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert response.status_code == 200

            # Client should receive broadcast
            data = ws.receive_json()
            assert data["type"] == "channel_update"
            assert data["channel"]["id"] == "test-123"
            assert data["channel"]["name"] == "Test Channel"
            assert data["channel"]["streamUrl"] == "http://test"
            assert data["channel"]["guideId"] == "guide-123"

    def test_multiple_clients_receive_broadcast(
        self,
        client: TestClient,
        valid_token: str,
        admin_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """All connected clients receive broadcast."""
        monkeypatch.setattr(settings, "chat_enabled", False)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws1:
            ws1.receive_json()  # Consume ack

            with client.websocket_connect(f"/api/ws?token={valid_token}") as ws2:
                ws2.receive_json()  # Consume ack

                # Admin sets channel
                response = client.put(
                    "/api/channels/current",
                    json={
                        "id": "multi-123",
                        "name": "Multi Test",
                        "streamUrl": "http://multi",
                        "guideId": "guide-multi",
                    },
                    headers={"Authorization": f"Bearer {admin_token}"},
                )
                assert response.status_code == 200

                # Both clients should receive
                data1 = ws1.receive_json()
                data2 = ws2.receive_json()

                assert data1["type"] == "channel_update"
                assert data2["type"] == "channel_update"
                assert data1["channel"]["id"] == "multi-123"
                assert data2["channel"]["id"] == "multi-123"


class TestWebSocketLogging:
    """Tests for WebSocket router logging."""

    def test_connection_logs_info(self, client: TestClient, valid_token: str):
        """WebSocket connection logs INFO with client ID."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="INFO")

        try:
            with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
                ws.receive_json()  # Consume connection_ack

            log_output = output.getvalue()
            assert "INFO" in log_output
            assert "connect" in log_output.lower()
        finally:
            logger.remove(handler_id)

    def test_disconnection_logs_info(self, client: TestClient, valid_token: str):
        """WebSocket disconnection logs INFO with client ID."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="INFO")

        try:
            with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
                ws.receive_json()  # Consume connection_ack
            # Connection closed

            log_output = output.getvalue()
            assert "disconnect" in log_output.lower()
        finally:
            logger.remove(handler_id)

    def test_auth_failure_logs_warning(self, client: TestClient):
        """Failed WebSocket authentication logs WARNING."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="WARNING")

        try:
            with (
                pytest.raises((Exception,)),  # noqa: B017
                client.websocket_connect("/api/ws?token=invalid_token"),
            ):
                pass

            log_output = output.getvalue()
            assert "WARNING" in log_output
        finally:
            logger.remove(handler_id)

    def test_ping_logs_debug(self, client: TestClient, valid_token: str):
        """Ping/pong messages log DEBUG."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="DEBUG")

        try:
            with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
                ws.receive_json()  # Consume connection_ack
                ws.send_json({"type": "ping"})
                ws.receive_json()  # Consume pong

            log_output = output.getvalue()
            assert "DEBUG" in log_output
            assert "ping" in log_output.lower() or "pong" in log_output.lower()
        finally:
            logger.remove(handler_id)

    def test_websocket_logging_uses_router_context(self, client: TestClient, valid_token: str):
        """WebSocket logging uses logger.bind(router='websocket') context."""
        output = StringIO()
        handler_id = logger.add(output, format="{extra} | {message}", level="INFO")

        try:
            with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
                ws.receive_json()  # Consume connection_ack

            log_output = output.getvalue()
            assert "router" in log_output
            assert "websocket" in log_output
        finally:
            logger.remove(handler_id)


class TestPresenceTracking:
    """Tests for user presence tracking in WebSocket."""

    def test_user_tracked_on_connect(self, client: TestClient, valid_token: str):
        """User should be tracked in presence service on connect."""
        assert len(presence._active_users) == 0

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # Consume connection_ack
            assert len(presence._active_users) == 1

            # Check user details
            users = list(presence._active_users.values())
            assert users[0].username == "testuser"
            assert users[0].view == "live"  # default view

    def test_user_removed_on_disconnect(self, client: TestClient, valid_token: str):
        """User should be removed from presence on disconnect."""
        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # Consume connection_ack
            assert len(presence._active_users) == 1

        # After disconnect
        assert len(presence._active_users) == 0

    def test_view_parameter_parsed_from_query(self, client: TestClient, valid_token: str):
        """View parameter should be parsed from query string."""
        with client.websocket_connect(f"/api/ws?token={valid_token}&view=ersatztv") as ws:
            ws.receive_json()  # Consume connection_ack

            users = list(presence._active_users.values())
            assert users[0].view == "ersatztv"

    def test_default_view_is_live(self, client: TestClient, valid_token: str):
        """Default view should be 'live' when not specified."""
        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # Consume connection_ack

            users = list(presence._active_users.values())
            assert users[0].view == "live"

    def test_multiple_users_tracked(self, client: TestClient, valid_token: str, admin_token: str):
        """Multiple users should be tracked separately."""
        with client.websocket_connect(f"/api/ws?token={valid_token}&view=live") as ws1:
            ws1.receive_json()
            assert len(presence._active_users) == 1

            with client.websocket_connect(f"/api/ws?token={admin_token}&view=ersatztv") as ws2:
                ws2.receive_json()
                assert len(presence._active_users) == 2

                # Check views
                live_users = presence.get_users_by_view("live")
                ersatztv_users = presence.get_users_by_view("ersatztv")
                assert len(live_users) == 1
                assert len(ersatztv_users) == 1

            # ws2 closed
            assert len(presence._active_users) == 1

        # ws1 closed
        assert len(presence._active_users) == 0


class TestChatMessages:
    """Tests for chat message functionality."""

    def test_chat_message_broadcast_when_enabled(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Chat messages are broadcast when chat is enabled."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws1:
            ws1.receive_json()  # connection_ack
            ws1.receive_json()  # chat_history (empty)

            with client.websocket_connect(f"/api/ws?token={valid_token}") as ws2:
                ws2.receive_json()  # connection_ack
                ws2.receive_json()  # chat_history

                # Send chat message from ws1
                ws1.send_json({"type": "chat_message", "content": "Hello everyone!"})

                # Both clients should receive the broadcast
                msg1 = ws1.receive_json()
                msg2 = ws2.receive_json()

                assert msg1["type"] == "chat_message"
                assert msg1["content"] == "Hello everyone!"
                assert msg1["username"] == "testuser"
                assert "messageId" in msg1
                assert "timestamp" in msg1

                assert msg2["type"] == "chat_message"
                assert msg2["content"] == "Hello everyone!"

    def test_chat_message_ignored_when_disabled(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Chat messages are ignored when chat is disabled."""
        monkeypatch.setattr(settings, "chat_enabled", False)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # connection_ack

            # Send chat message
            ws.send_json({"type": "chat_message", "content": "Hello!"})

            # Send ping to verify connection still works
            ws.send_json({"type": "ping"})
            data = ws.receive_json()
            assert data["type"] == "pong"  # No chat message was broadcast

    def test_chat_history_sent_on_connect_when_enabled(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Chat history is sent on connect when chat is enabled."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        # Add some messages to history
        chat.add_message("user1", "First message")
        chat.add_message("user2", "Second message")

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ack = ws.receive_json()
            assert ack["type"] == "connection_ack"

            history = ws.receive_json()
            assert history["type"] == "chat_history"
            assert len(history["messages"]) == 2
            assert history["messages"][0]["content"] == "First message"
            assert history["messages"][1]["content"] == "Second message"

    def test_chat_history_not_sent_when_disabled(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Chat history is not sent when chat is disabled."""
        monkeypatch.setattr(settings, "chat_enabled", False)

        chat.add_message("user1", "Message")

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ack = ws.receive_json()
            assert ack["type"] == "connection_ack"

            # Send ping to verify we don't get chat_history
            ws.send_json({"type": "ping"})
            data = ws.receive_json()
            assert data["type"] == "pong"  # Next message is pong, not chat_history

    def test_chat_message_whitespace_trimmed(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Chat messages are trimmed but not HTML escaped (React handles XSS)."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            ws.send_json({"type": "chat_message", "content": "  hello world  "})

            msg = ws.receive_json()
            assert msg["type"] == "chat_message"
            # Content is trimmed
            assert msg["content"] == "hello world"

    def test_empty_chat_message_rejected(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Empty chat messages are rejected."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            # Send empty message
            ws.send_json({"type": "chat_message", "content": ""})

            # Send ping to verify no broadcast happened
            ws.send_json({"type": "ping"})
            data = ws.receive_json()
            assert data["type"] == "pong"  # Next message is pong, not chat

    def test_chat_history_limited_to_50(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Chat history is limited to 50 messages."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        # Add 60 messages
        for i in range(60):
            chat.add_message("user", f"Message {i}")

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # connection_ack
            history = ws.receive_json()

            assert history["type"] == "chat_history"
            assert len(history["messages"]) == 50
            # Should have messages 10-59 (most recent 50)
            assert history["messages"][0]["content"] == "Message 10"
            assert history["messages"][49]["content"] == "Message 59"


class TestChatNickname:
    """Tests for chat nickname functionality."""

    def test_set_nickname_changes_display_name(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Setting nickname changes the display name for chat messages."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            # Set nickname
            ws.send_json({"type": "set_nickname", "nickname": "CoolUser"})

            # Send chat message
            ws.send_json({"type": "chat_message", "content": "Hello!"})

            msg = ws.receive_json()
            assert msg["type"] == "chat_message"
            assert msg["username"] == "CoolUser"
            assert msg["content"] == "Hello!"

    def test_set_nickname_trims_whitespace(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Nickname is trimmed of whitespace."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            ws.send_json({"type": "set_nickname", "nickname": "  SpacedName  "})
            ws.send_json({"type": "chat_message", "content": "Test"})

            msg = ws.receive_json()
            assert msg["username"] == "SpacedName"

    def test_set_nickname_truncates_to_30_chars(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Nickname is truncated to 30 characters."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            long_name = "A" * 50
            ws.send_json({"type": "set_nickname", "nickname": long_name})
            ws.send_json({"type": "chat_message", "content": "Test"})

            msg = ws.receive_json()
            assert msg["username"] == "A" * 30

    def test_empty_nickname_uses_auth_username(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Empty nickname falls back to authenticated username."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            # Set then clear nickname
            ws.send_json({"type": "set_nickname", "nickname": "TempName"})
            ws.send_json({"type": "set_nickname", "nickname": ""})

            ws.send_json({"type": "chat_message", "content": "Test"})

            msg = ws.receive_json()
            assert msg["username"] == "testuser"  # Falls back to auth username

    def test_nickname_persists_across_messages(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Nickname persists for subsequent messages."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            ws.send_json({"type": "set_nickname", "nickname": "PersistentNick"})

            ws.send_json({"type": "chat_message", "content": "First"})
            msg1 = ws.receive_json()

            ws.send_json({"type": "chat_message", "content": "Second"})
            msg2 = ws.receive_json()

            assert msg1["username"] == "PersistentNick"
            assert msg2["username"] == "PersistentNick"

    def test_different_users_have_different_nicknames(
        self,
        client: TestClient,
        valid_token: str,
        admin_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Each user can have their own nickname."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws1:
            ws1.receive_json()  # connection_ack
            ws1.receive_json()  # chat_history

            with client.websocket_connect(f"/api/ws?token={admin_token}") as ws2:
                ws2.receive_json()  # connection_ack
                ws2.receive_json()  # chat_history

                # Set different nicknames
                ws1.send_json({"type": "set_nickname", "nickname": "User1Nick"})
                ws2.send_json({"type": "set_nickname", "nickname": "User2Nick"})

                # Send messages
                ws1.send_json({"type": "chat_message", "content": "From user 1"})
                msg1 = ws1.receive_json()
                ws2.receive_json()  # ws2 also receives the broadcast

                ws2.send_json({"type": "chat_message", "content": "From user 2"})
                ws1.receive_json()  # ws1 receives ws2's message
                msg2 = ws2.receive_json()

                assert msg1["username"] == "User1Nick"
                assert msg2["username"] == "User2Nick"
