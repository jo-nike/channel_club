"""SEC-06 signed-token expiry through the actual ASGI endpoint."""

import time

import jwt
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.main import app
from app.routers import websocket
from app.services import channel_state, chat, presence
from tests.ws_helpers import ws_connect


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
    with ws_connect(client, token, session_id="signed-expiry") as ws:
        assert ws.receive_json()["type"] == "connection_ack"
        ws.send_json({"type": "set_nickname", "nickname": "Expires"})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4001
        assert time.time() >= expiry
    assert not presence._active_users
    assert not websocket._nickname_map
    assert not channel_state._active_connections
    assert len(chat.get_history()) == before
    # Whether or not decode still accepts the expiry second, the endpoint's
    # deadline closes immediately, before an ack/message.
    with ws_connect(client, token) as expired:
        with pytest.raises(WebSocketDisconnect) as closed:
            expired.receive_json()
        assert closed.value.code == 4001
