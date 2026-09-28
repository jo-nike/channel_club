"""Tests for WebSocket router."""

import hashlib
import hmac
import json
import sys
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from io import StringIO
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from loguru import logger
from starlette.websockets import WebSocketDisconnect

from app.config import Settings, settings
from app.logging_config import configure_logging
from app.main import app
from app.models.channel import Channel, GroupedChannelsResponse
from app.models.ersatztv import EPGChannel
from app.routers import websocket as websocket_router
from app.services import app_settings, channel_state, chat, presence, presence_broadcast
from app.services.auth import create_access_token
from tests.ws_helpers import ws_connect

# Captured at import, before conftest swaps it for a no-op in every test
REAL_SCHEDULE_BROADCAST = presence_broadcast.schedule_broadcast


def expected_user_id(account: str) -> str:
    """The chat id the server should derive for an account key ('plex:<id>' or 'local:<sub>')."""
    digest = hmac.new(settings.jwt_secret.encode(), account.encode(), hashlib.sha256)
    return "u_" + digest.hexdigest()[:16]


def only_presence() -> presence.UserPresence:
    """The one tracked connection (its key is server-generated)."""
    (user,) = presence._active_users.values()
    return user


def presence_of(username: str) -> presence.UserPresence:
    """The one tracked connection of a user."""
    (user,) = [u for u in presence._active_users.values() if u.username == username]
    return user


@pytest.fixture
def valid_token() -> str:
    """Create a valid JWT token for testing."""
    return create_access_token({"sub": "testuser", "role": "viewer"})


@pytest.fixture
def admin_token() -> str:
    """Create a valid admin JWT token for testing."""
    return create_access_token({"sub": "admin", "role": "admin"})


@pytest.fixture
def client() -> Iterator[TestClient]:
    """Share one ASGI event loop across concurrent sockets; stub startup I/O."""
    with (
        patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
        TestClient(app) as client,
    ):
        yield client


@pytest.fixture(autouse=True)
def cached_catalogue(monkeypatch: pytest.MonkeyPatch) -> None:
    """The catalogues chat names channels from: TSN 5 (42) live, Cartoons (etv-2) on ErsatzTV."""
    grouped = GroupedChannelsResponse(
        ungrouped=[Channel(id="42", name="TSN 5", streamUrl="http://streams/42", guideId="tsn5")]
    )
    cartoons = EPGChannel(id="etv-2", name="Cartoons", streamUrl="http://etv/2.m3u8")
    monkeypatch.setattr(websocket_router, "get_grouped_channels", AsyncMock(return_value=grouped))
    monkeypatch.setattr(
        websocket_router,
        "get_channel_by_id",
        lambda channel_id: cartoons if channel_id == cartoons.id else None,
    )


@pytest.fixture
def uncoalesced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Apply every channel_update at once, for tests about what one update does."""
    monkeypatch.setattr(websocket_router, "CHANNEL_UPDATE_INTERVAL_SECONDS", 0)


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
        with ws_connect(client, valid_token) as ws:
            data = ws.receive_json()
            assert data["type"] == "connection_ack"
            assert "currentChannel" in data

    def test_websocket_invalid_token_rejects_connection(self, client: TestClient):
        """Invalid token: connection is accepted, then closed with code 4001."""
        # The endpoint accepts before validating so the custom 4001 code reaches
        # the client (a pre-handshake close would surface as a generic 1006).
        with (
            ws_connect(client, "invalid_token") as ws,
            pytest.raises(WebSocketDisconnect) as exc_info,
        ):
            ws.receive_json()
        assert exc_info.value.code == 4001

    def test_socket_that_never_authenticates_is_closed_after_the_deadline(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ):
        """No auth frame: closed with 4001 at the deadline, never tracked or greeted."""
        monkeypatch.setattr(websocket_router, "AUTH_TIMEOUT_SECONDS", 0.1)
        with client.websocket_connect("/api/ws?session_id=silent") as ws:
            assert "silent" not in presence._active_users
            assert channel_state.get_connection_count() == 0
            with pytest.raises(WebSocketDisconnect) as exc_info:
                ws.receive_json()
            assert exc_info.value.code == 4001
        assert "silent" not in presence._active_users
        assert channel_state.get_connection_count() == 0

    @pytest.mark.parametrize(
        "first_frame",
        [
            '{"type": "ping"}',
            "not json",
            '{"type": "auth"}',
            '{"type": "auth", "token": 42}',
            '{"type": "auth", "token": "' + "x" * 17000 + '"}',
            b'{"type": "auth", "token": "x"}',
        ],
        ids=["other-type", "malformed", "no-token", "non-string", "oversize", "binary"],
    )
    def test_wrong_first_frame_is_closed_with_4001(
        self, client: TestClient, valid_token: str, first_frame: str | bytes
    ):
        """Anything but an auth message first: 4001 and nothing sent before it."""
        with client.websocket_connect("/api/ws?session_id=wrong") as ws:
            if isinstance(first_frame, bytes):
                ws.send_bytes(first_frame)
            else:
                ws.send_text(first_frame)
            with pytest.raises(WebSocketDisconnect) as exc_info:
                ws.receive_json()
            assert exc_info.value.code == 4001
        assert "wrong" not in presence._active_users

    def test_nothing_is_tracked_until_the_auth_frame_arrives(
        self, client: TestClient, valid_token: str
    ):
        """Presence and the broadcast list stay empty until the socket authenticates."""
        with client.websocket_connect("/api/ws?session_id=pending") as ws:
            assert not presence._active_users
            assert channel_state.get_connection_count() == 0
            ws.send_json({"type": "auth", "token": valid_token})
            assert ws.receive_json()["type"] == "connection_ack"
            assert len(presence._active_users) == 1
            assert channel_state.get_connection_count() == 1

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
            ws_connect(client, expired_token) as ws,
            pytest.raises(WebSocketDisconnect) as exc_info,
        ):
            ws.receive_json()
        assert exc_info.value.code == 4001


class TestLegacyQueryToken:
    """?token= stays accepted until R3, for tabs still running the old bundle."""

    def test_valid_query_token_is_acknowledged(self, client: TestClient, valid_token: str):
        with client.websocket_connect(f"/api/ws?token={valid_token}&session_id=legacy") as ws:
            assert ws.receive_json()["type"] == "connection_ack"
            assert len(presence._active_users) == 1

    def test_invalid_query_token_is_closed_with_4001(self, client: TestClient):
        with (
            client.websocket_connect("/api/ws?token=invalid_token") as ws,
            pytest.raises(WebSocketDisconnect) as exc_info,
        ):
            ws.receive_json()
        assert exc_info.value.code == 4001

    def test_expired_query_token_is_closed_with_4001(self, client: TestClient):
        from datetime import datetime, timedelta

        from jose import jwt

        expired_token = jwt.encode(
            {"sub": "testuser", "role": "viewer", "exp": datetime.now(UTC) - timedelta(hours=1)},
            settings.jwt_secret,
            algorithm="HS256",
        )
        with (
            client.websocket_connect(f"/api/ws?token={expired_token}") as ws,
            pytest.raises(WebSocketDisconnect) as exc_info,
        ):
            ws.receive_json()
        assert exc_info.value.code == 4001


class TestConnectionAck:
    """Tests for connection acknowledgment message."""

    def test_connection_ack_with_no_current_channel(self, client: TestClient, valid_token: str):
        """Connection ack includes null currentChannel when none set."""
        with ws_connect(client, valid_token) as ws:
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

        with ws_connect(client, valid_token) as ws:
            data = ws.receive_json()
            assert data["type"] == "connection_ack"
            assert data["currentChannel"] is not None
            assert data["currentChannel"]["id"] == "123"
            assert data["currentChannel"]["name"] == "Test Channel"
            # Check camelCase serialization
            assert "streamUrl" in data["currentChannel"]

    def test_connection_ack_names_the_signed_in_user(self, client: TestClient, valid_token: str):
        """Connection ack tells the socket which username it is signed in as."""
        with ws_connect(client, valid_token) as ws:
            data = ws.receive_json()
            assert data["type"] == "connection_ack"
            assert data["you"] == {
                "username": "testuser",
                "userId": expected_user_id("local:testuser"),
            }

    def test_connection_ack_gives_plex_sign_ins_a_plex_derived_id(self, client: TestClient):
        """A Plex token's id comes from its account id, and the raw id isn't sent."""
        token = create_access_token({"sub": "plexuser", "role": "viewer", "plex_id": "12345"})
        with ws_connect(client, token) as ws:
            data = ws.receive_json()
            assert data["you"] == {
                "username": "plexuser",
                "userId": expected_user_id("plex:12345"),
            }
            assert "12345" not in str(data["you"])

    def test_connection_ack_carries_the_build_id(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """The ack names the server's build, so an old bundle can notice a deploy."""
        monkeypatch.setattr(settings, "app_build_id", "build-4f2a")
        with ws_connect(client, valid_token) as ws:
            data = ws.receive_json()
            assert data["type"] == "connection_ack"
            assert data["buildId"] == "build-4f2a"


class TestPresenceInAck:
    """connection_ack carries the presence snapshot."""

    def test_ack_lists_who_is_watching_names_only_by_default(
        self, client: TestClient, valid_token: str, admin_token: str
    ):
        """Others are listed by name; channels stay private while visibility is off."""
        with ws_connect(client, admin_token) as ws1:
            ws1.receive_json()  # connection_ack
            ws1.send_json({"type": "channel_update", "channel": "News", "channelId": "n1"})
            ws1.send_json({"type": "ping"})
            ws1.receive_json()  # pong

            with ws_connect(client, valid_token) as ws2:
                ack = ws2.receive_json()

        assert ack["type"] == "connection_ack"
        # The new connection has no channel yet, so only admin is listed
        assert ack["presence"] == [
            {
                "userId": expected_user_id("local:admin"),
                "displayName": "admin",
                "channelId": None,
                "channelName": None,
                "programme": None,
                "view": None,
                "since": None,
            }
        ]

    def test_ack_includes_channels_when_visible(
        self,
        client: TestClient,
        valid_token: str,
        admin_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        monkeypatch.setattr(app_settings, "_presence_visible", True)
        with ws_connect(client, admin_token) as ws1:
            ws1.receive_json()  # connection_ack
            ws1.send_json(
                {"type": "channel_update", "channel": "News", "channelId": "n1", "programme": "AM"}
            )
            ws1.send_json({"type": "ping"})
            ws1.receive_json()  # pong

            with ws_connect(client, valid_token) as ws2:
                ack = ws2.receive_json()

        [entry] = ack["presence"]
        assert entry["channelName"] == "News"
        assert entry["channelId"] == "n1"
        assert entry["programme"] == "AM"
        assert entry["view"] == "live"
        assert entry["since"] is not None

    def test_ack_presence_empty_when_nobody_watches(self, client: TestClient, valid_token: str):
        with ws_connect(client, valid_token) as ws:
            assert ws.receive_json()["presence"] == []


class TestPresenceBroadcastTriggers:
    """Each presence change schedules a presence_update."""

    @pytest.fixture
    def schedule(self, monkeypatch: pytest.MonkeyPatch) -> MagicMock:
        mock = MagicMock()
        monkeypatch.setattr(presence_broadcast, "schedule_broadcast", mock)
        monkeypatch.setattr(settings, "chat_enabled", False)
        return mock

    @staticmethod
    def roundtrip(ws) -> None:
        """Wait until the server has handled everything sent so far."""
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

    def test_connect_and_disconnect_schedule_broadcasts(
        self, client: TestClient, valid_token: str, schedule: MagicMock
    ):
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            assert schedule.call_count == 1

        assert schedule.call_count == 2

    @pytest.mark.usefixtures("uncoalesced")
    def test_every_channel_update_schedules_a_broadcast(
        self, client: TestClient, valid_token: str, schedule: MagicMock
    ):
        """Programme rollovers on the same channel are broadcast too."""
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.send_json({"type": "channel_update", "channel": "News", "programme": "AM"})
            ws.send_json({"type": "channel_update", "channel": "News", "programme": "PM"})
            self.roundtrip(ws)

            assert schedule.call_count == 3

    def test_nickname_and_prefs_schedule_broadcasts(
        self, client: TestClient, valid_token: str, schedule: MagicMock
    ):
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.send_json({"type": "set_nickname", "nickname": "Jonny"})
            ws.send_json({"type": "set_nickname", "nickname": ""})
            ws.send_json({"type": "set_presence_prefs", "hideActivity": True})
            self.roundtrip(ws)

            assert schedule.call_count == 4

    def test_refused_or_invalid_messages_do_not_broadcast(
        self, client: TestClient, valid_token: str, admin_token: str, schedule: MagicMock
    ):
        with ws_connect(client, valid_token) as ws1:
            ws1.receive_json()  # connection_ack
            with ws_connect(client, admin_token) as ws2:
                ws2.receive_json()  # connection_ack
                schedule.reset_mock()
                ws2.send_json({"type": "set_nickname", "nickname": "testuser"})
                assert ws2.receive_json()["code"] == "nickname_taken"
                ws2.send_json({"type": "set_presence_prefs", "hideActivity": "yes"})
                assert ws2.receive_json()["code"] == "invalid_message"
                self.roundtrip(ws2)

                schedule.assert_not_called()


class TestPresenceUpdateBroadcast:
    """presence_update reaches connected clients."""

    def test_channel_change_reaches_everyone(
        self,
        client: TestClient,
        valid_token: str,
        admin_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """A friend changing channel shows up in the others' presence within the debounce."""
        monkeypatch.setattr(presence_broadcast, "schedule_broadcast", REAL_SCHEDULE_BROADCAST)
        monkeypatch.setattr(presence_broadcast, "BROADCAST_DEBOUNCE_SECONDS", 0.05)
        monkeypatch.setattr(presence_broadcast, "_pending", None)
        monkeypatch.setattr(app_settings, "_presence_visible", True)
        monkeypatch.setattr(settings, "chat_enabled", False)

        def next_presence(ws) -> list[dict]:
            for _ in range(5):
                message = ws.receive_json()
                if message["type"] == "presence_update" and message["presence"]:
                    return message["presence"]
            raise AssertionError("no presence_update with entries")

        with ws_connect(client, valid_token) as ws1:
            ws1.receive_json()  # connection_ack
            with ws_connect(client, admin_token) as ws2:
                ws2.receive_json()  # connection_ack
                ws2.send_json({"type": "channel_update", "channel": "Sports", "channelId": "s1"})

                seen = next_presence(ws1)

        assert [(e["displayName"], e["channelName"]) for e in seen] == [("admin", "Sports")]


class TestPingPong:
    """Tests for ping/pong functionality."""

    def test_ping_receives_pong_response(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Ping message receives pong response."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # Consume connection_ack
            ws.send_json({"type": "ping"})
            data = ws.receive_json()
            assert data["type"] == "pong"

    def test_unknown_message_type_handled_gracefully(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Unknown message types are handled without error."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token) as ws:
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

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # Consume connection_ack
            # Connection should be tracked
            assert channel_state.get_connection_count() == 1

        # After disconnect, connection should be removed
        assert channel_state.get_connection_count() == 0

    def test_multiple_connections_tracked(self, client: TestClient, valid_token: str):
        """Multiple connections are tracked separately."""
        with ws_connect(client, valid_token) as ws1:
            ws1.receive_json()
            assert channel_state.get_connection_count() == 1

            with ws_connect(client, valid_token) as ws2:
                ws2.receive_json()
                assert channel_state.get_connection_count() == 2

            # ws2 closed
            assert channel_state.get_connection_count() == 1

        # ws1 closed
        assert channel_state.get_connection_count() == 0


class TestChannelBroadcast:
    @pytest.fixture(autouse=True)
    def authoritative_catalog(self, monkeypatch):
        from unittest.mock import AsyncMock

        from app.models.channel import Channel, GroupedChannelsResponse
        from app.services import media_source

        monkeypatch.setattr(media_source, "get_channel_by_id", lambda _id: None)
        monkeypatch.setattr(
            media_source,
            "get_grouped_channels",
            AsyncMock(
                return_value=GroupedChannelsResponse(
                    ungrouped=[
                        Channel(
                            id="test-123",
                            name="Test Channel",
                            stream_url="http://test",
                            guide_id="guide-123",
                        ),
                        Channel(
                            id="multi-123",
                            name="Multi Test",
                            stream_url="http://multi",
                            guide_id="guide-multi",
                        ),
                    ]
                )
            ),
        )

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

        with ws_connect(client, valid_token) as ws:
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
            assert data["changedBy"] == "admin"

    def test_broadcast_when_channel_cleared(
        self,
        client: TestClient,
        valid_token: str,
        admin_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Clearing the channel broadcasts a null channel naming the admin."""
        monkeypatch.setattr(settings, "chat_enabled", False)

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # Consume connection_ack

            response = client.delete(
                "/api/channels/current",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            assert response.status_code == 200

            data = ws.receive_json()
            assert data == {"type": "channel_update", "channel": None, "changedBy": "admin"}

    def test_multiple_clients_receive_broadcast(
        self,
        client: TestClient,
        valid_token: str,
        admin_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """All connected clients receive broadcast."""
        monkeypatch.setattr(settings, "chat_enabled", False)

        with ws_connect(client, valid_token) as ws1:
            ws1.receive_json()  # Consume ack

            with ws_connect(client, valid_token) as ws2:
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
            with ws_connect(client, valid_token) as ws:
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
            with ws_connect(client, valid_token) as ws:
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
                ws_connect(client, "invalid_token") as ws,
                pytest.raises(WebSocketDisconnect),
            ):
                ws.receive_json()

            log_output = output.getvalue()
            assert "WARNING" in log_output
        finally:
            logger.remove(handler_id)

    def test_ping_logs_debug(self, client: TestClient, valid_token: str):
        """Ping/pong messages log DEBUG."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="DEBUG")

        try:
            with ws_connect(client, valid_token) as ws:
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
            with ws_connect(client, valid_token) as ws:
                ws.receive_json()  # Consume connection_ack

            log_output = output.getvalue()
            assert "router" in log_output
            assert "websocket" in log_output
        finally:
            logger.remove(handler_id)

    def test_handler_error_logs_traceback_with_credentials_redacted(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """A bug in a message handler is logged with its traceback, token redacted (SEC-03)."""
        secret = "SYNTHETIC_HANDLER_ERROR_TOKEN"

        async def broken(*_args: object) -> None:
            raise ValueError(f"lookup failed for /api/stream?token={secret}")

        monkeypatch.setattr(websocket_router, "handle_client_message", broken)
        output = StringIO()
        config = Settings(_env_file=None, log_format="json", log_level="DEBUG")
        with patch("app.logging_config.settings", config), patch.object(sys, "stderr", output):
            configure_logging()
            with ws_connect(client, valid_token) as ws:
                ws.receive_json()  # Consume connection_ack
                ws.send_json({"type": "ping"})

        records = [json.loads(line)["record"] for line in output.getvalue().splitlines()]
        errors = [r for r in records if r["message"].startswith("WebSocket error")]
        assert len(errors) == 1
        assert errors[0]["level"]["name"] == "ERROR"
        assert errors[0]["exception"]["type"] == "ValueError"
        assert "[REDACTED]" in errors[0]["exception"]["value"]
        assert secret not in output.getvalue()

    def test_send_after_close_logs_debug_without_traceback(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Starlette refusing a send on a closed socket is a disconnect race, not an error."""

        async def closes_then_sends(websocket, *_args: object) -> None:
            await websocket.close()
            await websocket.send_json({"type": "pong"})

        monkeypatch.setattr(websocket_router, "handle_client_message", closes_then_sends)
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message} | {exception}", level="DEBUG")
        try:
            with ws_connect(client, valid_token) as ws:
                ws.receive_json()  # Consume connection_ack
                ws.send_json({"type": "ping"})
                with pytest.raises(WebSocketDisconnect):
                    ws.receive_json()
        finally:
            logger.remove(handler_id)

        log_output = output.getvalue()
        assert "DEBUG | WebSocket closed mid-operation" in log_output
        assert "ERROR" not in log_output
        assert "Traceback" not in log_output


class TestPresenceTracking:
    """Tests for user presence tracking in WebSocket."""

    def test_user_tracked_on_connect(self, client: TestClient, valid_token: str):
        """User should be tracked in presence service on connect."""
        assert len(presence._active_users) == 0

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # Consume connection_ack
            assert len(presence._active_users) == 1

            # Check user details
            users = list(presence._active_users.values())
            assert users[0].username == "testuser"
            assert users[0].view == "live"  # default view

    def test_user_removed_on_disconnect(self, client: TestClient, valid_token: str):
        """User should be removed from presence on disconnect."""
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # Consume connection_ack
            assert len(presence._active_users) == 1

        # After disconnect
        assert len(presence._active_users) == 0

    def test_view_parameter_parsed_from_query(self, client: TestClient, valid_token: str):
        """View parameter should be parsed from query string."""
        with ws_connect(client, valid_token, view="ersatztv") as ws:
            ws.receive_json()  # Consume connection_ack

            users = list(presence._active_users.values())
            assert users[0].view == "ersatztv"

    def test_default_view_is_live(self, client: TestClient, valid_token: str):
        """Default view should be 'live' when not specified."""
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # Consume connection_ack

            users = list(presence._active_users.values())
            assert users[0].view == "live"

    def test_connection_tracked_with_its_user_id(self, client: TestClient, valid_token: str):
        """Presence records the opaque id, so a person's tabs can be grouped."""
        with ws_connect(client, valid_token, session_id="s1") as ws:
            ws.receive_json()  # Consume connection_ack

            assert only_presence().user_id == expected_user_id("local:testuser")

    def test_empty_live_slot_from_a_pre_r2_bundle_is_no_channel(
        self, client: TestClient, valid_token: str
    ):
        """An old bundle reports the empty Live slot as 'Live'; nobody is watching it."""
        output = StringIO()
        handler_id = logger.add(
            output, format="{extra[event]}", level="INFO", filter=lambda r: "event" in r["extra"]
        )
        try:
            with ws_connect(client, valid_token) as ws:
                ws.receive_json()  # Consume connection_ack
                ws.send_json(
                    {
                        "type": "channel_update",
                        "channel": "Live",
                        "channelId": "live-channel-0",
                        "view": "live",
                    }
                )
                ws.send_json({"type": "ping"})
                assert ws.receive_json()["type"] == "pong"

                user = only_presence()
                assert user.current_channel is None
                assert user.current_channel_id is None
        finally:
            logger.remove(handler_id)
        assert "watch.start" not in output.getvalue()

    def test_channel_update_records_whether_the_client_follows_live(
        self, client: TestClient, valid_token: str
    ):
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # Consume connection_ack
            ws.send_json(
                {
                    "type": "channel_update",
                    "channel": "RDS",
                    "channelId": "uuid-rds",
                    "view": "live",
                    "onLive": True,
                }
            )
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"

            assert only_presence().on_live is True

    def test_nickname_is_recorded_in_presence(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """An accepted nickname is shown in presence; clearing it restores the username."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token, session_id="s1") as ws:
            ws.receive_json()  # Consume connection_ack
            ws.send_json({"type": "set_nickname", "nickname": "  Jonny  "})
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"

            assert only_presence().nickname == "Jonny"

            ws.send_json({"type": "set_nickname", "nickname": ""})
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"

            assert only_presence().nickname is None

    def test_refused_nickname_is_not_recorded_in_presence(
        self,
        client: TestClient,
        valid_token: str,
        admin_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Another member's sign-in name never reaches presence either."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token) as ws1:
            ws1.receive_json()  # connection_ack
            with ws_connect(client, admin_token, session_id="a1") as ws2:
                ws2.receive_json()  # connection_ack
                ws2.send_json({"type": "set_nickname", "nickname": "testuser"})
                assert ws2.receive_json()["code"] == "nickname_taken"

                assert presence_of("admin").nickname is None

    def test_presence_prefs_set_hide_activity(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """set_presence_prefs records "Hide what I'm watching" for the connection."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token, session_id="s1") as ws:
            ws.receive_json()  # Consume connection_ack
            ws.send_json({"type": "set_presence_prefs", "hideActivity": True})
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"

            assert only_presence().hide_activity is True

            ws.send_json({"type": "set_presence_prefs", "hideActivity": False})
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"

            assert only_presence().hide_activity is False

    def test_hide_preference_in_the_auth_message_covers_the_first_channel(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """A hider's channel_update sent right after auth is never shown to others."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        monkeypatch.setattr(app_settings, "_presence_visible", True)
        with client.websocket_connect("/api/ws?session_id=0badcafe") as ws:
            ws.send_json({"type": "auth", "token": valid_token, "hideActivity": True})
            ws.send_json({"type": "channel_update", "channel": "RDS", "view": "live"})
            assert ws.receive_json()["type"] == "connection_ack"
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"

            user = only_presence()
            assert user.current_channel == "RDS"  # The admin list still has it
            assert presence_broadcast.shown_channel(user.connection_id) is None
            assert [entry["channelName"] for entry in presence_broadcast.build_snapshot()] == [None]

    @pytest.mark.parametrize(
        "message",
        [
            {"type": "set_presence_prefs"},
            {"type": "set_presence_prefs", "hideActivity": "true"},
            {"type": "set_presence_prefs", "hideActivity": 1},
            {"type": "set_presence_prefs", "hideActivity": None},
        ],
    )
    def test_invalid_presence_prefs_are_rejected(
        self,
        client: TestClient,
        valid_token: str,
        monkeypatch: pytest.MonkeyPatch,
        message: dict[str, object],
    ):
        """A malformed prefs message gets invalid_message and changes nothing."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token, session_id="s1") as ws:
            ws.receive_json()  # Consume connection_ack
            ws.send_json(message)

            assert ws.receive_json() == {"type": "error", "code": "invalid_message"}
            assert only_presence().hide_activity is False

    def test_multiple_users_tracked(self, client: TestClient, valid_token: str, admin_token: str):
        """Multiple users should be tracked separately."""
        with ws_connect(client, valid_token, view="live") as ws1:
            ws1.receive_json()
            assert len(presence._active_users) == 1

            with ws_connect(client, admin_token, view="ersatztv") as ws2:
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


class TestPresenceKeys:
    """Presence is keyed per connection by the server, never by the client's session_id."""

    @staticmethod
    def set_nickname(ws, nickname: str) -> None:
        ws.send_json({"type": "set_nickname", "nickname": nickname})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

    def test_duplicated_tab_keeps_both_connections(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Two sockets sending the same session_id (Duplicate tab) keep their own entries."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token, session_id="0badcafe") as first:
            first.receive_json()  # connection_ack
            self.set_nickname(first, "First")
            with ws_connect(client, valid_token, session_id="0badcafe") as second:
                second.receive_json()  # connection_ack
                self.set_nickname(second, "Second")

                assert sorted(u.nickname or "" for u in presence._active_users.values()) == [
                    "First",
                    "Second",
                ]

            assert only_presence().nickname == "First"
            assert [name for _, name in websocket_router._nickname_map.values()] == ["First"]

    def test_another_user_with_the_same_session_id_takes_nothing_over(
        self,
        client: TestClient,
        valid_token: str,
        admin_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Reusing someone's session_id neither evicts them nor renames them."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token, session_id="0badcafe") as victim:
            victim.receive_json()  # connection_ack
            self.set_nickname(victim, "Victim")
            with ws_connect(client, admin_token, session_id="0badcafe") as other:
                other.receive_json()  # connection_ack
                self.set_nickname(other, "Impostor")

                assert presence_of("testuser").nickname == "Victim"
                assert presence_of("admin").nickname == "Impostor"

            assert presence_of("testuser").nickname == "Victim"
            assert [name for _, name in websocket_router._nickname_map.values()] == ["Victim"]

    def test_stale_sweep_closes_the_socket_with_4000(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """A swept connection is closed, so its client reconnects; nothing is left behind."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            self.set_nickname(ws, "Sleepy")
            only_presence().last_activity_mono -= presence.STALE_USER_TIMEOUT_SECONDS + 1

            assert client.portal is not None
            assert client.portal.call(presence.cleanup_stale_users) == 1

            ws.send_json({"type": "ping"})
            with pytest.raises(WebSocketDisconnect) as closed:
                ws.receive_json()
            assert closed.value.code == 4000
        assert not presence._active_users
        assert not websocket_router._nickname_map
        assert channel_state.get_connection_count() == 0

    def test_any_valid_message_refreshes_activity(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """A channel_update, not only a ping, shows the connection is in use."""
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            old = datetime.now(UTC) - timedelta(hours=1)
            user = only_presence()
            user.last_activity = old
            user.last_activity_mono -= 3600
            old_mono = user.last_activity_mono

            ws.send_json({"type": "channel_update", "channel": "RDS", "view": "live"})
            # An invalid message is answered without refreshing, and after the update
            ws.send_json({"type": "set_presence_prefs"})
            assert ws.receive_json()["code"] == "invalid_message"

            assert user.last_activity > old
            assert user.last_activity_mono > old_mono


class TestChatMessages:
    """Tests for chat message functionality."""

    def test_chat_message_broadcast_when_enabled(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Chat messages are broadcast when chat is enabled."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with ws_connect(client, valid_token) as ws1:
            ws1.receive_json()  # connection_ack
            ws1.receive_json()  # chat_history (empty)

            with ws_connect(client, valid_token) as ws2:
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
                assert msg1["userId"] == expected_user_id("local:testuser")
                assert "messageId" in msg1
                assert "timestamp" in msg1

                assert msg2["type"] == "chat_message"
                assert msg2["content"] == "Hello everyone!"

    def test_chat_message_from_plex_sign_in_carries_plex_derived_id(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ):
        """Messages from a Plex sign-in are stamped with the id derived from plex_id."""
        monkeypatch.setattr(settings, "chat_enabled", True)
        token = create_access_token({"sub": "plexuser", "role": "viewer", "plex_id": "12345"})

        with ws_connect(client, token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            ws.send_json({"type": "chat_message", "content": "Hi"})
            msg = ws.receive_json()

            assert msg["userId"] == expected_user_id("plex:12345")

    def test_chat_history_carries_user_ids(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """History sent on connect keeps each message's userId."""
        monkeypatch.setattr(settings, "chat_enabled", True)
        chat.add_message("someone", "Earlier", user_id="u_0123456789abcdef")

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            history = ws.receive_json()

            assert history["type"] == "chat_history"
            assert history["messages"][0]["userId"] == "u_0123456789abcdef"

    def test_chat_message_ignored_when_disabled(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Chat messages are ignored when chat is disabled."""
        monkeypatch.setattr(settings, "chat_enabled", False)

        with ws_connect(client, valid_token) as ws:
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

        with ws_connect(client, valid_token) as ws:
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

        with ws_connect(client, valid_token) as ws:
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

        with ws_connect(client, valid_token) as ws:
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

        with ws_connect(client, valid_token) as ws:
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

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            history = ws.receive_json()

            assert history["type"] == "chat_history"
            assert len(history["messages"]) == 50
            # Should have messages 10-59 (most recent 50)
            assert history["messages"][0]["content"] == "Message 10"
            assert history["messages"][49]["content"] == "Message 59"


class TestChatChannelStamp:
    """Chat messages carry the sender's channel only when presence lets others see it."""

    CHANNEL_FIELDS = ("channelId", "channelName", "programme", "view")

    @pytest.fixture(autouse=True)
    def chat_on(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "chat_enabled", True)

    @pytest.fixture
    def visible(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(app_settings, "_presence_visible", True)

    @staticmethod
    def watch(ws, channel: str = "Cartoons") -> None:
        """Report a channel and wait until the server has it."""
        ws.send_json(
            {
                "type": "channel_update",
                "channel": channel,
                "channelId": "etv-2",
                "programme": "Futurama",
                "view": "ersatztv",
            }
        )
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

    def say(self, ws, content: str = "lol") -> dict:
        ws.send_json({"type": "chat_message", "content": content})
        msg = ws.receive_json()
        assert msg["type"] == "chat_message"
        return msg

    def test_no_channel_while_presence_is_off(self, client: TestClient, valid_token: str):
        """The default: messages say nothing about what the sender watches."""
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history
            self.watch(ws)

            msg = self.say(ws)

        assert all(msg[field] is None for field in self.CHANNEL_FIELDS)

    @pytest.mark.usefixtures("visible")
    def test_stamped_with_the_senders_channel_when_visible(
        self, client: TestClient, valid_token: str, admin_token: str
    ):
        with ws_connect(client, valid_token) as ws1:
            ws1.receive_json()  # connection_ack
            ws1.receive_json()  # chat_history
            self.watch(ws1)
            with ws_connect(client, admin_token) as ws2:
                ws2.receive_json()  # connection_ack
                ws2.receive_json()  # chat_history

                self.say(ws1)
                received = ws2.receive_json()

        assert received["channelId"] == "etv-2"
        assert received["channelName"] == "Cartoons"
        assert received["programme"] == "Futurama"
        assert received["view"] == "ersatztv"

    @pytest.mark.usefixtures("visible")
    def test_chip_is_named_from_the_catalogue(self, client: TestClient, valid_token: str):
        """The chip shows the catalogue's name for the reported id, not the reported name."""
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history
            self.watch(ws, channel="Game 7")

            msg = self.say(ws)

        assert msg["channelName"] == "Cartoons"
        assert msg["channelId"] == "etv-2"

    @pytest.mark.usefixtures("visible")
    def test_no_chip_for_a_channel_not_in_the_catalogue(self, client: TestClient, valid_token: str):
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history
            ws.send_json({"type": "channel_update", "channel": "Game 7", "channelId": "nope"})

            msg = self.say(ws)

        assert msg["content"] == "lol"
        assert all(msg[field] is None for field in self.CHANNEL_FIELDS)

    @pytest.mark.usefixtures("visible")
    def test_no_channel_for_a_sender_who_hides(self, client: TestClient, valid_token: str):
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history
            ws.send_json({"type": "set_presence_prefs", "hideActivity": True})
            self.watch(ws)

            msg = self.say(ws)

        assert all(msg[field] is None for field in self.CHANNEL_FIELDS)

    @pytest.mark.usefixtures("visible")
    def test_hiding_on_another_connection_keeps_the_channel_off(
        self, client: TestClient, valid_token: str
    ):
        """Hiding on the phone also covers what the laptop sends."""
        with ws_connect(client, valid_token, session_id="phone") as phone:
            phone.receive_json()  # connection_ack
            phone.receive_json()  # chat_history
            phone.send_json({"type": "set_presence_prefs", "hideActivity": True})
            phone.send_json({"type": "ping"})
            assert phone.receive_json()["type"] == "pong"
            with ws_connect(client, valid_token, session_id="laptop") as laptop:
                laptop.receive_json()  # connection_ack
                laptop.receive_json()  # chat_history
                self.watch(laptop)

                msg = self.say(laptop)

        assert msg["channelName"] is None

    @pytest.mark.usefixtures("visible")
    def test_no_channel_before_the_sender_reports_one(self, client: TestClient, valid_token: str):
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            msg = self.say(ws)

        assert msg["channelName"] is None

    def test_client_sent_channel_fields_are_ignored(self, client: TestClient, valid_token: str):
        """Only the server's presence stamps a channel; a client can't claim one."""
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history
            ws.send_json(
                {
                    "type": "chat_message",
                    "content": "hi",
                    "channelName": "Fake",
                    "channelId": "x",
                    "view": "live",
                }
            )
            msg = ws.receive_json()

        assert msg["content"] == "hi"
        assert msg["channelName"] is None
        assert msg["channelId"] is None

    @pytest.mark.usefixtures("visible")
    def test_history_keeps_stamps_while_visible(self, client: TestClient, valid_token: str):
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history
            self.watch(ws)
            self.say(ws)

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            [message] = ws.receive_json()["messages"]

        assert message["channelName"] == "Cartoons"

    def test_history_drops_stamps_once_presence_is_off(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Turning presence off also covers what was stamped while it was on."""
        monkeypatch.setattr(app_settings, "_presence_visible", True)
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history
            self.watch(ws)
            assert self.say(ws)["channelName"] == "Cartoons"

        monkeypatch.setattr(app_settings, "_presence_visible", False)
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            [message] = ws.receive_json()["messages"]

        assert message["content"] == "lol"
        assert all(message[field] is None for field in self.CHANNEL_FIELDS)

    @pytest.mark.usefixtures("visible")
    def test_history_drops_stamps_of_a_sender_who_now_hides(
        self, client: TestClient, valid_token: str, admin_token: str
    ):
        with ws_connect(client, valid_token) as sender:
            sender.receive_json()  # connection_ack
            sender.receive_json()  # chat_history
            self.watch(sender)
            assert self.say(sender)["channelName"] == "Cartoons"
            sender.send_json({"type": "set_presence_prefs", "hideActivity": True})
            sender.send_json({"type": "ping"})
            assert sender.receive_json()["type"] == "pong"

            with ws_connect(client, admin_token) as reader:
                reader.receive_json()  # connection_ack
                [message] = reader.receive_json()["messages"]

        assert message["channelName"] is None


class TestShareMessage:
    """'Share what I'm watching' posts a card whose channel the server fills from presence."""

    @pytest.fixture(autouse=True)
    def chat_on(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "chat_enabled", True)

    @pytest.fixture
    def visible(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(app_settings, "_presence_visible", True)

    @staticmethod
    def open_chat(ws) -> None:
        ws.receive_json()  # connection_ack
        ws.receive_json()  # chat_history

    @staticmethod
    def watch(ws) -> None:
        """Report a live channel and wait until the server has it."""
        ws.send_json(
            {
                "type": "channel_update",
                "channel": "TSN 5",
                "channelId": "42",
                "programme": "CFL Football",
                "view": "live",
            }
        )
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

    @staticmethod
    def assert_nothing_broadcast(ws) -> None:
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

    @pytest.mark.usefixtures("visible")
    def test_share_is_broadcast_as_a_card_with_the_servers_channel(
        self, client: TestClient, valid_token: str, admin_token: str
    ):
        with ws_connect(client, valid_token) as ws1:
            self.open_chat(ws1)
            self.watch(ws1)
            with ws_connect(client, admin_token) as ws2:
                self.open_chat(ws2)

                ws1.send_json({"type": "share", "clientMessageId": "s-1"})
                card = ws2.receive_json()
                # The ack comes first: it confirms the stored message, before the broadcast
                ack = ws1.receive_json()
                own = ws1.receive_json()

        assert card["type"] == "chat_message"
        assert card["kind"] == "share"
        assert card["username"] == "testuser"
        assert card["userId"] == expected_user_id("local:testuser")
        assert card["channelId"] == "42"
        assert card["channelName"] == "TSN 5"
        assert card["programme"] == "CFL Football"
        assert card["view"] == "live"
        # Clients that predate share cards show the same thing as text
        assert card["content"] == "Watching TSN 5 · CFL Football"
        assert own["messageId"] == card["messageId"]
        assert ack == {
            "type": "chat_ack",
            "clientMessageId": "s-1",
            "accepted": True,
            "messageId": card["messageId"],
        }
        [stored] = chat.get_history()
        assert stored.kind == "share"

    @pytest.mark.usefixtures("visible")
    def test_client_sent_channel_names_are_ignored(self, client: TestClient, valid_token: str):
        """The card names the channel presence has, whatever the client claims."""
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)
            self.watch(ws)

            ws.send_json(
                {
                    "type": "share",
                    "channelName": "Fake",
                    "channelId": "666",
                    "programme": "Not this",
                    "content": "spoof",
                }
            )
            card = ws.receive_json()

        assert card["channelName"] == "TSN 5"
        assert card["channelId"] == "42"
        assert card["programme"] == "CFL Football"
        assert card["content"] == "Watching TSN 5 · CFL Football"

    @staticmethod
    def report(ws, channel: str, channel_id: str) -> None:
        """Report a channel under any name and wait until the server has it."""
        ws.send_json({"type": "channel_update", "channel": channel, "channelId": channel_id})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

    @pytest.mark.usefixtures("visible")
    @pytest.mark.parametrize(
        ("channel_id", "name"), [("42", "TSN 5"), ("etv-2", "Cartoons")], ids=["live", "ersatztv"]
    )
    def test_card_is_named_from_the_catalogue_not_the_reported_name(
        self, client: TestClient, valid_token: str, channel_id: str, name: str
    ):
        """A client reporting 'Fake' for a real channel id still posts the catalogue's name."""
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)
            self.report(ws, "Fake", channel_id)

            ws.send_json({"type": "share", "clientMessageId": "s-1"})
            assert ws.receive_json()["accepted"] is True
            card = ws.receive_json()

        assert card["channelName"] == name
        assert card["channelId"] == channel_id
        assert card["content"] == f"Watching {name}"
        [stored] = chat.get_history()
        assert stored.channel is not None
        assert stored.channel.channel_name == name

    @pytest.mark.usefixtures("visible")
    def test_refused_for_a_channel_not_in_the_catalogue(self, client: TestClient, valid_token: str):
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)
            self.report(ws, "Game 7", "not-a-channel")

            ws.send_json({"type": "share", "clientMessageId": "s-1"})
            ack = ws.receive_json()
            self.assert_nothing_broadcast(ws)

        assert ack == {"type": "chat_ack", "clientMessageId": "s-1", "accepted": False}
        assert chat.get_history() == []

    def test_refused_while_presence_is_off(self, client: TestClient, valid_token: str):
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)
            self.watch(ws)

            ws.send_json({"type": "share", "clientMessageId": "s-1"})
            ack = ws.receive_json()
            self.assert_nothing_broadcast(ws)

        assert ack == {"type": "chat_ack", "clientMessageId": "s-1", "accepted": False}
        assert chat.get_history() == []

    @pytest.mark.usefixtures("visible")
    def test_refused_for_a_sender_who_hides(self, client: TestClient, valid_token: str):
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)
            ws.send_json({"type": "set_presence_prefs", "hideActivity": True})
            self.watch(ws)

            ws.send_json({"type": "share", "clientMessageId": "s-1"})
            ack = ws.receive_json()
            self.assert_nothing_broadcast(ws)

        assert ack["accepted"] is False

    @pytest.mark.usefixtures("visible")
    def test_refused_before_the_sender_reports_a_channel(
        self, client: TestClient, valid_token: str
    ):
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)

            ws.send_json({"type": "share", "clientMessageId": "s-1"})
            ack = ws.receive_json()

        assert ack["accepted"] is False

    @pytest.mark.usefixtures("visible")
    def test_refused_while_chat_is_off(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            self.watch(ws)

            ws.send_json({"type": "share", "clientMessageId": "s-1"})
            ack = ws.receive_json()

        assert ack["accepted"] is False

    @pytest.mark.usefixtures("visible")
    def test_retried_share_is_acknowledged_without_reposting(
        self, client: TestClient, valid_token: str
    ):
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)
            self.watch(ws)
            ws.send_json({"type": "share", "clientMessageId": "s-1"})
            card = ws.receive_json()
            ws.receive_json()  # chat_ack

            ws.send_json({"type": "share", "clientMessageId": "s-1"})
            ack = ws.receive_json()
            self.assert_nothing_broadcast(ws)

        assert ack["messageId"] == card["messageId"]
        assert len(chat.get_history()) == 1

    def test_invalid_share_is_rejected(self, client: TestClient, valid_token: str):
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)

            ws.send_json({"type": "share", "clientMessageId": 7})

            assert ws.receive_json() == {"type": "error", "code": "invalid_message"}

    @pytest.mark.usefixtures("visible")
    def test_history_keeps_a_share_after_presence_turns_off(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """A share is the sender's own post, so it keeps its channel."""
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)
            self.watch(ws)
            ws.send_json({"type": "share"})
            ws.receive_json()  # the card

        monkeypatch.setattr(app_settings, "_presence_visible", False)
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            [card] = ws.receive_json()["messages"]

        assert card["kind"] == "share"
        assert card["channelName"] == "TSN 5"


class TestSuggestMessage:
    """'Suggest' posts a card for a channel the server resolves from its catalogue."""

    @pytest.fixture(autouse=True)
    def chat_on(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "chat_enabled", True)

    @pytest.fixture
    def catalogue(self) -> AsyncMock:
        """The cached grouped catalogue (cached_catalogue): only TSN 5 (id 42) is live."""
        grouped = websocket_router.get_grouped_channels
        assert isinstance(grouped, AsyncMock)
        return grouped

    @staticmethod
    def open_chat(ws) -> None:
        ws.receive_json()  # connection_ack
        ws.receive_json()  # chat_history

    @staticmethod
    def assert_nothing_broadcast(ws) -> None:
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"

    def test_suggestion_is_broadcast_with_the_catalogues_channel(
        self, client: TestClient, valid_token: str, admin_token: str, catalogue: AsyncMock
    ):
        with ws_connect(client, valid_token) as ws1:
            self.open_chat(ws1)
            with ws_connect(client, admin_token) as ws2:
                self.open_chat(ws2)

                ws1.send_json({"type": "suggest", "channelId": "42", "clientMessageId": "g-1"})
                card = ws2.receive_json()
                # The ack comes first: it confirms the stored message, before the broadcast
                ack = ws1.receive_json()
                own = ws1.receive_json()

        assert catalogue.await_count == 1
        assert card["type"] == "chat_message"
        assert card["kind"] == "suggestion"
        assert card["username"] == "testuser"
        assert card["userId"] == expected_user_id("local:testuser")
        assert card["channelId"] == "42"
        assert card["channelName"] == "TSN 5"
        assert card["view"] is None
        # Clients that predate suggestion cards show the same thing as text
        assert card["content"] == "Suggests putting TSN 5 on live TV"
        assert own["messageId"] == card["messageId"]
        assert ack == {
            "type": "chat_ack",
            "clientMessageId": "g-1",
            "accepted": True,
            "messageId": card["messageId"],
        }
        [stored] = chat.get_history()
        assert stored.kind == "suggestion"

    def test_client_sent_names_are_ignored(self, client: TestClient, valid_token: str):
        """The card names the channel the catalogue has, whatever the client claims."""
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)

            ws.send_json(
                {
                    "type": "suggest",
                    "channelId": "42",
                    "channelName": "Fake",
                    "content": "spoof",
                }
            )
            card = ws.receive_json()

        assert card["channelName"] == "TSN 5"
        assert card["content"] == "Suggests putting TSN 5 on live TV"

    def test_refused_for_a_channel_not_in_the_catalogue(self, client: TestClient, valid_token: str):
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)

            ws.send_json({"type": "suggest", "channelId": "666", "clientMessageId": "g-1"})
            ack = ws.receive_json()
            self.assert_nothing_broadcast(ws)

        assert ack == {"type": "chat_ack", "clientMessageId": "g-1", "accepted": False}
        assert chat.get_history() == []

    def test_unknown_channel_makes_no_upstream_request(
        self,
        client: TestClient,
        valid_token: str,
        monkeypatch: pytest.MonkeyPatch,
        catalogue: AsyncMock,
    ):
        """Only the cached grouped catalogue is consulted: no ErsatzTV lookup."""
        from app.services import media_source

        uncached: list[str] = []

        def record(name: str):
            async def called(*args, **kwargs):
                uncached.append(name)
                raise AssertionError(f"{name} called")

            return called

        # The switch path's own lookups, in case a suggestion goes through it again
        monkeypatch.setattr(media_source, "get_grouped_channels", catalogue)
        monkeypatch.setattr(media_source, "run_feed_lookup", record("ersatztv lookup"))
        monkeypatch.setattr(websocket_router, "run_feed_lookup", record("run_feed_lookup"))
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)

            ws.send_json({"type": "suggest", "channelId": "etv-2", "clientMessageId": "g-1"})
            ack = ws.receive_json()
            ws.send_json({"type": "suggest", "channelId": "unknown", "clientMessageId": "g-2"})
            second = ws.receive_json()

        assert ack["accepted"] is False
        assert second["accepted"] is False
        assert uncached == []

    def test_refused_while_chat_is_off(
        self,
        client: TestClient,
        valid_token: str,
        monkeypatch: pytest.MonkeyPatch,
        catalogue: AsyncMock,
    ):
        monkeypatch.setattr(settings, "chat_enabled", False)
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack

            ws.send_json({"type": "suggest", "channelId": "42", "clientMessageId": "g-1"})
            ack = ws.receive_json()

        assert ack["accepted"] is False
        assert catalogue.await_count == 0
        assert chat.get_history() == []

    def test_retried_suggestion_is_acknowledged_without_reposting(
        self, client: TestClient, valid_token: str
    ):
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)
            ws.send_json({"type": "suggest", "channelId": "42", "clientMessageId": "g-1"})
            ws.receive_json()  # chat_ack
            card = ws.receive_json()

            ws.send_json({"type": "suggest", "channelId": "42", "clientMessageId": "g-1"})
            ack = ws.receive_json()
            self.assert_nothing_broadcast(ws)

        assert ack["messageId"] == card["messageId"]
        assert len(chat.get_history()) == 1

    @pytest.mark.parametrize(
        "message",
        [
            {"type": "suggest"},
            {"type": "suggest", "channelId": 42},
            {"type": "suggest", "channelId": "4" * 513},
            {"type": "suggest", "channelId": "42", "clientMessageId": 7},
        ],
    )
    def test_invalid_suggestion_is_rejected(
        self,
        client: TestClient,
        valid_token: str,
        message: dict[str, object],
        catalogue: AsyncMock,
    ):
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)

            ws.send_json(message)

            assert ws.receive_json() == {"type": "error", "code": "invalid_message"}
        assert catalogue.await_count == 0

    def test_history_keeps_the_suggested_channel_while_presence_is_off(
        self, client: TestClient, valid_token: str
    ):
        """Presence privacy is about where people are, not the channel they suggest."""
        with ws_connect(client, valid_token) as ws:
            self.open_chat(ws)
            ws.send_json({"type": "suggest", "channelId": "42"})
            ws.receive_json()  # the card

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            [card] = ws.receive_json()["messages"]

        assert card["kind"] == "suggestion"
        assert card["channelId"] == "42"
        assert card["channelName"] == "TSN 5"


class TestChatNickname:
    """Tests for chat nickname functionality."""

    def test_set_nickname_changes_display_name(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Setting nickname changes the display name for chat messages."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with ws_connect(client, valid_token) as ws:
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

    def test_renaming_keeps_the_user_id(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Messages sent before and after a rename carry the same userId."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            ws.send_json({"type": "chat_message", "content": "Before"})
            before = ws.receive_json()
            ws.send_json({"type": "set_nickname", "nickname": "NewName"})
            ws.send_json({"type": "chat_message", "content": "After"})
            after = ws.receive_json()

            assert before["username"] == "testuser"
            assert after["username"] == "NewName"
            assert before["userId"] == after["userId"] == expected_user_id("local:testuser")

    def test_set_nickname_trims_whitespace(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Nickname is trimmed of whitespace."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with ws_connect(client, valid_token) as ws:
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

        with ws_connect(client, valid_token) as ws:
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

        with ws_connect(client, valid_token) as ws:
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

        with ws_connect(client, valid_token) as ws:
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

        with ws_connect(client, valid_token) as ws1:
            ws1.receive_json()  # connection_ack
            ws1.receive_json()  # chat_history

            with ws_connect(client, admin_token) as ws2:
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


class TestNicknameTaken:
    """A nickname can't be another connected member's sign-in name."""

    def test_colliding_nickname_is_refused_and_name_unchanged(
        self,
        client: TestClient,
        valid_token: str,
        admin_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Taking a connected member's sign-in name (any case) is refused; the old name stays."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with ws_connect(client, valid_token) as ws1:
            ws1.receive_json()  # connection_ack
            ws1.receive_json()  # chat_history

            with ws_connect(client, admin_token) as ws2:
                ws2.receive_json()  # connection_ack
                ws2.receive_json()  # chat_history

                ws2.send_json({"type": "set_nickname", "nickname": "Ace"})
                ws2.send_json({"type": "set_nickname", "nickname": "  TestUser  "})
                # Named as sent, so the client recognises its own request
                assert ws2.receive_json() == {
                    "type": "error",
                    "code": "nickname_taken",
                    "nickname": "  TestUser  ",
                }

                ws2.send_json({"type": "chat_message", "content": "Still me"})
                msg = ws2.receive_json()
                ws1.receive_json()  # ws1 also receives the broadcast

                assert msg["type"] == "chat_message"
                assert msg["username"] == "Ace"

    def test_refused_first_nickname_keeps_the_sign_in_name(
        self,
        client: TestClient,
        valid_token: str,
        admin_token: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """With no earlier nickname, a refused one leaves the sign-in name in use."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with ws_connect(client, valid_token) as ws1:
            ws1.receive_json()  # connection_ack
            ws1.receive_json()  # chat_history

            with ws_connect(client, admin_token) as ws2:
                ws2.receive_json()  # connection_ack
                ws2.receive_json()  # chat_history

                ws2.send_json({"type": "set_nickname", "nickname": "testuser"})
                assert ws2.receive_json()["code"] == "nickname_taken"

                ws2.send_json({"type": "chat_message", "content": "Hi"})
                msg = ws2.receive_json()
                ws1.receive_json()

                assert msg["username"] == "admin"

    @pytest.mark.parametrize(
        "nickname",
        [
            "Live TV",
            "live tv",
            "\uff21ce",
            "jo\u200bn",
            "\u200eJON\u200f",
            "Live  TV",
            "Live\u00a0\u3000TV",
            "jo\u034fn",
            "jon\ufe0f",
            "jon\U000e0100",
            "jon\u3164",
            "jo\u115fn",
            "jon\uffa0",
            "jon\u2800",
        ],
    )
    def test_system_name_nicknames_and_invisible_variants_are_refused(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, nickname: str
    ):
        """'Live TV', another member's nickname and look-alikes of a sign-in name are taken."""
        monkeypatch.setattr(settings, "chat_enabled", True)
        jon = create_access_token({"sub": "jon", "role": "viewer"})
        ace = create_access_token({"sub": "ace-account", "role": "viewer"})
        other = create_access_token({"sub": "other", "role": "viewer"})

        with ws_connect(client, jon) as ws1, ws_connect(client, ace) as ws2:
            for ws in (ws1, ws2):
                ws.receive_json()  # connection_ack
                ws.receive_json()  # chat_history
            ws2.send_json({"type": "set_nickname", "nickname": "Ace"})
            ws2.send_json({"type": "ping"})
            assert ws2.receive_json()["type"] == "pong"
            with ws_connect(client, other) as ws3:
                ws3.receive_json()  # connection_ack
                ws3.receive_json()  # chat_history

                ws3.send_json({"type": "set_nickname", "nickname": nickname})
                ws3.send_json({"type": "ping"})
                refusal = ws3.receive_json()
                kept = presence_of("other").nickname

        assert refusal["type"] == "error"
        assert refusal["code"] == "nickname_taken"
        # The look-alike as sent, not its normalized form, so the client matches it
        assert refusal["nickname"] == nickname
        assert kept is None

    def test_own_sign_in_name_is_allowed_while_another_member_has_it_as_a_nickname(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ):
        monkeypatch.setattr(settings, "chat_enabled", True)
        bob = create_access_token({"sub": "bob", "role": "viewer"})
        other = create_access_token({"sub": "other", "role": "viewer"})

        with ws_connect(client, other) as ws1:
            ws1.receive_json()  # connection_ack
            ws1.receive_json()  # chat_history
            # Taken while bob is offline
            ws1.send_json({"type": "set_nickname", "nickname": "Bob"})
            ws1.send_json({"type": "ping"})
            assert ws1.receive_json()["type"] == "pong"

            with ws_connect(client, bob) as ws2:
                ws2.receive_json()  # connection_ack
                ws2.receive_json()  # chat_history
                ws2.send_json({"type": "set_nickname", "nickname": "BOB"})
                ws2.send_json({"type": "ping"})
                answer = ws2.receive_json()
                kept = presence_of("bob").nickname

        assert answer["type"] == "pong"
        assert kept == "BOB"

    def test_nickname_is_stored_normalized(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Invisible characters are dropped and compatibility forms folded before storing."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            ws.send_json({"type": "set_nickname", "nickname": " \uff23ool\u200bCat\u0007 "})
            ws.send_json({"type": "chat_message", "content": "Hi"})
            msg = ws.receive_json()
            stored = only_presence().nickname

        assert msg["username"] == "CoolCat"
        assert stored == "CoolCat"

    @pytest.mark.parametrize(
        ("nickname", "expected"),
        [
            ("Live TV" + " " * 24 + "x", "Live TV x"),
            ("jon" + " " * 27 + "x", "jon x"),
            ("A" * 29 + " yz", "A" * 29),
        ],
    )
    def test_nickname_spaces_are_collapsed_and_trimmed_after_the_cut(
        self,
        client: TestClient,
        valid_token: str,
        monkeypatch: pytest.MonkeyPatch,
        nickname: str,
        expected: str,
    ):
        """Space runs can't hide a suffix, and the length cut leaves no trailing space."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            ws.send_json({"type": "set_nickname", "nickname": nickname})
            ws.send_json({"type": "chat_message", "content": "Hi"})
            msg = ws.receive_json()
            stored = only_presence().nickname

        assert msg["username"] == expected
        assert stored == expected

    def test_own_nickname_on_another_connection_is_allowed(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """A member's second tab may take the nickname their first tab uses."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with ws_connect(client, valid_token) as ws1, ws_connect(client, valid_token) as ws2:
            for ws in (ws1, ws2):
                ws.receive_json()  # connection_ack
                ws.receive_json()  # chat_history
            ws1.send_json({"type": "set_nickname", "nickname": "Ace"})
            ws1.send_json({"type": "ping"})
            assert ws1.receive_json()["type"] == "pong"

            ws2.send_json({"type": "set_nickname", "nickname": "ace"})
            ws2.send_json({"type": "ping"})
            assert ws2.receive_json()["type"] == "pong"
            nicknames = sorted(str(u.nickname) for u in presence._active_users.values())

        assert nicknames == ["Ace", "ace"]

    def test_own_sign_in_name_is_allowed(
        self, client: TestClient, valid_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Members may use their own sign-in name in any case."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            ws.send_json({"type": "set_nickname", "nickname": "TestUser"})
            ws.send_json({"type": "chat_message", "content": "Hi"})
            msg = ws.receive_json()

            assert msg["type"] == "chat_message"
            assert msg["username"] == "TestUser"

    def test_name_of_someone_not_connected_is_allowed(
        self, client: TestClient, admin_token: str, monkeypatch: pytest.MonkeyPatch
    ):
        """Only connected members' names are known, so an offline member's name is free."""
        monkeypatch.setattr(settings, "chat_enabled", True)

        with ws_connect(client, admin_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history

            ws.send_json({"type": "set_nickname", "nickname": "testuser"})
            ws.send_json({"type": "chat_message", "content": "Hi"})
            msg = ws.receive_json()

            assert msg["type"] == "chat_message"
            assert msg["username"] == "testuser"


@pytest.mark.parametrize(
    "message",
    [
        [],
        None,
        4,
        "text",
        {"type": "channel_update", "channel": {}},
        {"type": "channel_update", "channel": []},
        {"type": "channel_update", "channel": 4},
        {"type": "channel_update", "programme": {}},
        {"type": "channel_update", "programme": []},
        {"type": "channel_update", "programme": 4},
        {"type": "channel_update", "channel": "x" * 513},
        {"type": "set_nickname", "nickname": {}},
        {"type": "chat_message", "content": 42},
    ],
)
@pytest.mark.usefixtures("uncoalesced")
def test_sec05_invalid_messages_cannot_poison_presence(client, valid_token, admin_token, message):
    with ws_connect(client, valid_token, session_id="validated") as ws:
        assert ws.receive_json()["type"] == "connection_ack"
        ws.send_json(message)
        assert ws.receive_json() == {"type": "error", "code": "invalid_message"}
        response = client.get(
            "/api/admin/active-users", headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        assert only_presence().current_channel is None
        ws.send_json({"type": "channel_update", "channel": "Channel", "programme": "Programme"})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        assert only_presence().current_programme == "Programme"
        ws.send_json({"type": "channel_update", "channel": None, "programme": None})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        assert only_presence().current_programme is None


def test_sec05_oversize_message_closes_before_mutation(client, valid_token):
    with ws_connect(client, valid_token) as ws:
        ws.receive_json()
        ws.send_json({"type": "chat_message", "content": "x" * 17000})
        with pytest.raises(WebSocketDisconnect) as error:
            ws.receive_json()
        assert error.value.code == 1009
    assert chat.get_history() == []


@pytest.mark.parametrize("active", [False, True])
def test_sec06_socket_expires_and_cleans_all_state(client, monkeypatch, active):
    import time

    from jose import jwt

    monkeypatch.setattr(settings, "chat_enabled", True)
    # Use a fractional deadline in the verified payload for fast deterministic
    # transport lifecycle testing, while retaining a genuinely signed valid JWT.
    original_verify = websocket_router.verify_websocket_token

    async def short_lived(token):
        payload = await original_verify(token)
        assert payload is not None
        payload["exp"] = time.time() + 0.15
        return payload

    monkeypatch.setattr(websocket_router, "verify_websocket_token", short_lived)
    token = jwt.encode(
        {"sub": "expiring", "role": "viewer", "exp": time.time() + 5},
        settings.jwt_secret,
        algorithm="HS256",
    )
    with ws_connect(client, token, session_id="expiring") as ws:
        assert ws.receive_json()["type"] == "connection_ack"
        assert ws.receive_json()["type"] == "chat_history"
        ws.send_json({"type": "set_nickname", "nickname": "Temporary"})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        if active:
            ws.send_json({"type": "chat_message", "content": "before expiry"})
            assert ws.receive_json()["type"] == "chat_message"
        with pytest.raises(WebSocketDisconnect) as error:
            ws.receive_json()
        assert error.value.code == 4001
    assert not presence._active_users
    assert not websocket_router._nickname_map
    assert channel_state.get_connection_count() == 0
    assert [message.content for message in chat.get_history()] == (
        ["before expiry"] if active else []
    )


def test_reauth_moves_the_deadline_past_the_first_expiry(client, monkeypatch):
    """A refreshed token sent in-band keeps the socket open past the old token's expiry."""
    import time

    monkeypatch.setattr(settings, "chat_enabled", False)
    first = create_access_token({"sub": "renewing", "role": "viewer"})
    # auth_time differs, so the two tokens differ even within the same second
    second = create_access_token({"sub": "renewing", "role": "viewer", "auth_time": 1})
    original_verify = websocket_router.verify_websocket_token

    async def first_expires_soon(token):
        payload = await original_verify(token)
        if payload is not None and token == first:
            payload["exp"] = time.time() + 0.3
        return payload

    monkeypatch.setattr(websocket_router, "verify_websocket_token", first_expires_soon)
    original_handle = websocket_router.handle_client_message
    handled: list[str] = []

    async def recording_handle(websocket, message, *args):
        handled.append(message["type"])
        await original_handle(websocket, message, *args)

    monkeypatch.setattr(websocket_router, "handle_client_message", recording_handle)
    with ws_connect(client, first, session_id="renewing") as ws:
        assert ws.receive_json()["type"] == "connection_ack"
        ws.send_json({"type": "reauth", "token": second})
        time.sleep(0.5)
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
        assert len(presence._active_users) == 1
    assert handled == ["ping"]


@pytest.mark.parametrize(
    "claims",
    [
        {"sub": "someone-else", "role": "viewer"},
        {"sub": "testuser", "role": "viewer", "plex_id": "12345"},
        None,
    ],
    ids=["other-sub", "other-plex-id", "invalid"],
)
def test_reauth_for_another_account_or_invalid_token_closes_4001(client, valid_token, claims):
    """Reauth only renews the same account; anything else ends the socket."""
    token = create_access_token(claims) if claims else "invalid_token"
    with ws_connect(client, valid_token, session_id="reauth") as ws:
        assert ws.receive_json()["type"] == "connection_ack"
        ws.send_json({"type": "reauth", "token": token})
        with pytest.raises(WebSocketDisconnect) as error:
            ws.receive_json()
        assert error.value.code == 4001
    assert not presence._active_users
    assert channel_state.get_connection_count() == 0


async def test_sec06_verified_payload_retains_signed_expiry(valid_token):
    from app.services.auth import verify_token

    payload = await websocket_router.verify_websocket_token(valid_token)
    assert payload is not None
    assert payload["exp"] == verify_token(valid_token).exp.timestamp()


async def test_verified_payload_carries_plex_id():
    """The WebSocket payload keeps a Plex sign-in's account id; local tokens have none."""
    plex_token = create_access_token({"sub": "plexuser", "role": "viewer", "plex_id": "12345"})
    local_token = create_access_token({"sub": "testuser", "role": "viewer"})

    plex_payload = await websocket_router.verify_websocket_token(plex_token)
    local_payload = await websocket_router.verify_websocket_token(local_token)

    assert plex_payload is not None
    assert plex_payload["plex_id"] == "12345"
    assert local_payload is not None
    assert local_payload["plex_id"] is None


async def test_sec07_failed_broadcast_closes_and_cleans_endpoint(monkeypatch, valid_token):
    import asyncio
    from unittest.mock import AsyncMock, MagicMock

    from fastapi.websockets import WebSocketState

    ws = MagicMock()
    ws.application_state = WebSocketState.CONNECTED
    ws.accept = AsyncMock()
    ws.close = AsyncMock()
    ws.send_json = AsyncMock()
    ws.send_text = AsyncMock(side_effect=TimeoutError)
    ws.receive_text = AsyncMock(side_effect=lambda: asyncio.sleep(3600))

    # AsyncMock does not await returned awaitables; use an actual blocking receive.
    async def receive():
        await asyncio.Event().wait()

    ws.receive_text = receive
    cleanup = MagicMock(wraps=presence.remove_user)
    monkeypatch.setattr(presence, "remove_user", cleanup)
    task = asyncio.create_task(
        websocket_router.websocket_endpoint(ws, valid_token, "live", "failed")
    )
    for _ in range(20):
        await asyncio.sleep(0)
        if channel_state.get_connection_count():
            break
    (client_id,) = presence._active_users
    await websocket_router.handle_client_message(
        ws, {"type": "set_nickname", "nickname": "temp"}, client_id, "user", "u_0123456789abcdef"
    )
    healthy = MagicMock()
    healthy.application_state = WebSocketState.CONNECTED
    healthy.send_text = AsyncMock()
    await channel_state.connect(healthy)
    await channel_state.broadcast({"type": "channel_update", "channel": None})
    with pytest.raises(asyncio.CancelledError):
        await task
    ws.close.assert_awaited_once_with(code=1011, reason="Broadcast failed; reconnect")
    cleanup.assert_called_once_with(client_id, ws)
    assert not presence._active_users
    assert not websocket_router._nickname_map
    await channel_state.broadcast({"type": "resynchronized"})
    assert healthy.send_text.await_count == 2
    assert ws.send_text.await_count == 1
    channel_state.disconnect(healthy)


async def test_chat_ack_is_not_held_up_by_a_stalled_peer(monkeypatch):
    """The sender's ack confirms the stored message; a peer that won't read can't delay it."""
    import asyncio

    monkeypatch.setattr(settings, "chat_enabled", True)
    monkeypatch.setattr(channel_state, "BROADCAST_SEND_TIMEOUT_SECONDS", 0.5)

    async def hang(*args, **kwargs):
        await asyncio.Event().wait()

    peer = MagicMock()
    peer.send_text = AsyncMock(side_effect=hang)
    peer.close = AsyncMock(side_effect=hang)
    await channel_state.connect(peer)
    loop = asyncio.get_running_loop()
    acked: asyncio.Future[float] = loop.create_future()

    async def sender_send_json(message):
        if message.get("type") == "chat_ack" and not acked.done():
            acked.set_result(loop.time())

    sender = MagicMock()
    sender.send_json = AsyncMock(side_effect=sender_send_json)
    started = loop.time()
    handling = asyncio.create_task(
        websocket_router.handle_client_message(
            sender,
            {"type": "chat_message", "content": "hi", "clientMessageId": "c-1"},
            "sender-conn",
            "testuser",
            "u_0123456789abcdef",
        )
    )

    assert await asyncio.wait_for(acked, timeout=2) - started < 0.1
    await handling
    await channel_state.stop_failed_closes()


def _recording_socket() -> tuple[MagicMock, list[dict]]:
    """A mock WebSocket and the list of what was sent to it with send_json."""
    sent: list[dict] = []
    socket = MagicMock()
    socket.send_json = AsyncMock(side_effect=sent.append)
    return socket, sent


async def test_retry_while_the_first_send_is_pending_posts_once(monkeypatch):
    """A retry racing a slow send (a reconnected socket) is refused, not posted twice."""
    import asyncio

    monkeypatch.setattr(settings, "chat_enabled", True)
    release = asyncio.Event()
    grouped = websocket_router.get_grouped_channels

    async def slow_catalogue():
        await release.wait()
        return await grouped()

    monkeypatch.setattr(websocket_router, "get_grouped_channels", slow_catalogue)
    suggest = {"type": "suggest", "channelId": "42", "clientMessageId": "g-1"}
    first_socket, first_sent = _recording_socket()
    retry_socket, retry_sent = _recording_socket()

    first = asyncio.create_task(
        websocket_router.handle_client_message(
            first_socket, suggest, "conn-1", "testuser", "u_0123456789abcdef"
        )
    )
    await asyncio.sleep(0)  # the first send is now waiting on the catalogue
    # Refused at once; without the in-flight mark it would wait on the catalogue too
    await asyncio.wait_for(
        websocket_router.handle_client_message(
            retry_socket, suggest, "conn-2", "testuser", "u_0123456789abcdef"
        ),
        timeout=1,
    )
    release.set()
    await first

    assert retry_sent == [{"type": "chat_ack", "clientMessageId": "g-1", "accepted": False}]
    assert first_sent[0]["accepted"] is True
    assert len(chat.get_history()) == 1


async def test_a_send_that_fails_can_be_retried(monkeypatch):
    """The in-flight mark is cleared when handling raises, so the retry posts."""
    monkeypatch.setattr(settings, "chat_enabled", True)
    original = websocket_router._suggested_channel
    calls = 0

    async def fails_once(channel_id):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("boom")
        return await original(channel_id)

    monkeypatch.setattr(websocket_router, "_suggested_channel", fails_once)
    suggest = {"type": "suggest", "channelId": "42", "clientMessageId": "g-1"}
    socket, sent = _recording_socket()

    with pytest.raises(RuntimeError):
        await websocket_router.handle_client_message(
            socket, suggest, "conn-1", "testuser", "u_0123456789abcdef"
        )
    await websocket_router.handle_client_message(
        socket, suggest, "conn-1", "testuser", "u_0123456789abcdef"
    )

    assert sent[0]["accepted"] is True
    assert len(chat.get_history()) == 1


class TestMessageBudget:
    """Chat sends and nickname changes share a per-connection budget; nothing closes the socket."""

    @pytest.fixture(autouse=True)
    def chat_on(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "chat_enabled", True)

    @pytest.fixture
    def no_refill(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Only the burst, so the count doesn't depend on how fast the test runs."""
        monkeypatch.setattr(websocket_router, "MESSAGE_REFILL_PER_SECOND", 0.0)

    @staticmethod
    def until_pong(ws) -> list[dict]:
        """Send a ping and collect every frame up to its pong."""
        ws.send_json({"type": "ping"})
        frames = []
        while (frame := ws.receive_json())["type"] != "pong":
            frames.append(frame)
        return frames

    @pytest.mark.usefixtures("no_refill")
    def test_rapid_chat_is_capped_at_the_burst_and_the_rest_refused(
        self, client: TestClient, valid_token: str
    ):
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history
            for n in range(20):
                ws.send_json(
                    {"type": "chat_message", "content": f"m{n}", "clientMessageId": f"c{n}"}
                )
            frames = self.until_pong(ws)

            # Exempt, and the socket is still open
            ws.send_json({"type": "set_presence_prefs", "hideActivity": True})
            assert self.until_pong(ws) == []
            hidden = only_presence().hide_activity

        broadcasts = [f for f in frames if f["type"] == "chat_message"]
        acks = [f for f in frames if f["type"] == "chat_ack"]
        assert len(broadcasts) == websocket_router.MESSAGE_BURST
        assert [a["accepted"] for a in acks] == [True] * 5 + [False] * 15
        assert len(chat.get_history()) == 5
        assert hidden is True

    @pytest.mark.usefixtures("no_refill")
    def test_a_retry_of_a_stored_send_is_confirmed_even_over_budget(
        self, client: TestClient, valid_token: str
    ):
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history
            for n in range(websocket_router.MESSAGE_BURST):
                ws.send_json(
                    {"type": "chat_message", "content": f"m{n}", "clientMessageId": f"c{n}"}
                )
            frames = self.until_pong(ws)
            stored = {
                f["clientMessageId"]: f["messageId"] for f in frames if f["type"] == "chat_ack"
            }

            # Budget spent; the client retries the first send, whose ack it missed
            ws.send_json({"type": "chat_message", "content": "m0", "clientMessageId": "c0"})
            (ack,) = [f for f in self.until_pong(ws) if f["type"] == "chat_ack"]

        assert ack["accepted"] is True
        assert ack["messageId"] == stored["c0"]

    @pytest.mark.usefixtures("no_refill")
    def test_nickname_over_budget_is_refused_as_rate_limited(
        self, client: TestClient, valid_token: str
    ):
        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.receive_json()  # chat_history
            for n in range(6):
                ws.send_json({"type": "set_nickname", "nickname": f"Nick{n}"})
            frames = self.until_pong(ws)
            nickname = only_presence().nickname

        assert frames == [{"type": "error", "code": "rate_limited", "nickname": "Nick5"}]
        assert nickname == "Nick4"

    def test_budget_refills_one_a_second(self, monkeypatch: pytest.MonkeyPatch):
        now = [100.0]
        monkeypatch.setattr(websocket_router.time, "monotonic", lambda: now[0])
        budget = websocket_router._MessageBudget("conn")

        assert all(budget.take() for _ in range(5))
        assert budget.take() is False
        now[0] += 1.0
        assert budget.take() is True
        assert budget.take() is False
        now[0] += 60.0
        assert sum(budget.take() for _ in range(10)) == 5

    def test_one_warning_per_window_with_a_count(self, monkeypatch: pytest.MonkeyPatch):
        now = [100.0]
        monkeypatch.setattr(websocket_router.time, "monotonic", lambda: now[0])
        log = MagicMock()
        monkeypatch.setattr(websocket_router, "log", log)
        budget = websocket_router._MessageBudget("conn")
        for _ in range(5):
            budget.take()

        for _ in range(20):
            budget.take()
        assert log.warning.call_count == 1

        now[0] += websocket_router.RATE_LIMIT_WARNING_SECONDS
        budget.take()  # refilled
        for _ in range(10):
            budget.take()
        assert log.warning.call_count == 2
        # The second warning counts everything refused since the first: the
        # 19 after it, and the refusal that starts the new window
        assert log.warning.call_args.args[-1] == 19 + 1


class TestChannelUpdateCoalescing:
    """A connection's channel updates apply at most about once a second; the last one wins."""

    @pytest.fixture
    def applied(self, monkeypatch: pytest.MonkeyPatch) -> list[str | None]:
        """The channel of every update presence actually applied."""
        channels: list[str | None] = []
        original = presence.update_user_channel

        def record(connection_id, channel_name, *args, **kwargs):
            channels.append(channel_name)
            return original(connection_id, channel_name, *args, **kwargs)

        monkeypatch.setattr(presence, "update_user_channel", record)
        return channels

    def test_a_flood_applies_a_handful_and_ends_on_the_last(
        self, client: TestClient, valid_token: str, applied: list[str | None]
    ):
        import time

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            for n in range(100):
                channel = "A" if n % 2 else "B"
                ws.send_json({"type": "channel_update", "channel": channel, "channelId": channel})
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"
            time.sleep(websocket_router.CHANNEL_UPDATE_INTERVAL_SECONDS + 0.3)
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"
            final = only_presence().current_channel

        assert 1 < len(applied) <= 3
        assert applied[0] == "B"
        assert applied[-1] == "A"
        assert final == "A"

    def test_a_pending_update_is_dropped_when_the_socket_ends(
        self, client: TestClient, valid_token: str, applied: list[str | None]
    ):
        import time

        with ws_connect(client, valid_token) as ws:
            ws.receive_json()  # connection_ack
            ws.send_json({"type": "channel_update", "channel": "A"})
            ws.send_json({"type": "channel_update", "channel": "B"})
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"
        time.sleep(websocket_router.CHANNEL_UPDATE_INTERVAL_SECONDS + 0.3)

        assert applied == ["A"]
        assert not presence._active_users
