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
    # Two to three seconds left: the token must outlive a slow runner's connect
    # and auth frame (exp is whole seconds), then expire while the socket idles
    minted, started = time.time(), time.monotonic()
    expiry = int(minted) + 3
    token = jwt.encode(
        {"sub": "synthetic-expiry", "role": "viewer", "exp": expiry, "typ": "session"},
        settings.jwt_secret.get_secret_value(),
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
        # Timed on the monotonic clock the server's deadline uses: a stepped wall
        # clock (as on a VM syncing its time) would make time.time() misreport it
        assert time.monotonic() - started >= expiry - minted - 0.05
    assert not presence._active_users
    assert not websocket._nickname_map
    assert not channel_state._active_connections
    assert len(chat.get_history()) == before
    # The server judges a new socket's token by the wall clock (exp is wall
    # time), so wait until that clock agrees the token has expired. Whether or
    # not decode still accepts the expiry second, the endpoint's deadline closes
    # immediately, before an ack/message.
    while time.time() < expiry:
        time.sleep(0.05)
    with ws_connect(client, token) as expired:
        with pytest.raises(WebSocketDisconnect) as closed:
            expired.receive_json()
        assert closed.value.code == 4001
