"""Tests for WebSocket router."""

from datetime import UTC

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import channel_state
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
    yield
    channel_state.clear_current_channel()
    channel_state._active_connections.clear()


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

    def test_ping_receives_pong_response(self, client: TestClient, valid_token: str):
        """Ping message receives pong response."""
        with client.websocket_connect(f"/api/ws?token={valid_token}") as ws:
            ws.receive_json()  # Consume connection_ack
            ws.send_json({"type": "ping"})
            data = ws.receive_json()
            assert data["type"] == "pong"

    def test_unknown_message_type_handled_gracefully(self, client: TestClient, valid_token: str):
        """Unknown message types are handled without error."""
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
        self, client: TestClient, valid_token: str, admin_token: str
    ):
        """Broadcast channel_update when admin sets channel via API."""

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
        self, client: TestClient, valid_token: str, admin_token: str
    ):
        """All connected clients receive broadcast."""
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
