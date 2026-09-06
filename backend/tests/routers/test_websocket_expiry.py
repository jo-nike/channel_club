"""SEC-06 signed-token expiry through the actual ASGI endpoint."""

import time

import pytest
from fastapi.testclient import TestClient
from jose import jwt
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.main import app
from app.routers import websocket
from app.services import channel_state, chat, presence


def test_signed_jwt_deadline_closes_idle_socket_and_rejects_reuse(monkeypatch):
    monkeypatch.setattr(settings, "chat_enabled", False)
    expiry = int(time.time()) + 1
    token = jwt.encode(
        {"sub": "synthetic-expiry", "role": "viewer", "exp": expiry},
        settings.jwt_secret,
        algorithm="HS256",
    )
    before = len(chat.get_history())
    client = TestClient(app)
    with client.websocket_connect(f"/api/ws?token={token}&session_id=signed-expiry") as ws:
        assert ws.receive_json()["type"] == "connection_ack"
        ws.send_json({"type": "set_nickname", "nickname": "Expires"})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4001
        assert time.time() >= expiry
    assert "signed-expiry" not in presence._active_users
    assert "signed-expiry" not in websocket._nickname_map
    assert not channel_state._active_connections
    assert len(chat.get_history()) == before
    # jose's integer timestamp compatibility permits the equality second;
    # the endpoint's deadline still closes immediately, before an ack/message.
    with client.websocket_connect(f"/api/ws?token={token}") as expired:
        with pytest.raises(WebSocketDisconnect) as closed:
            expired.receive_json()
        assert closed.value.code == 4001
