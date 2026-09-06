"""FE-11 server acceptance acknowledgements, using synthetic local WebSockets."""

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import chat
from app.services.auth import create_access_token


def test_chat_ack_identifies_the_stored_message(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "chat_enabled", True)
    chat.clear_history()
    token = create_access_token({"sub": "synthetic-sender", "role": "viewer"})
    with TestClient(app).websocket_connect(f"/api/ws?token={token}") as socket:
        socket.receive_json()
        socket.receive_json()
        socket.send_json(
            {
                "type": "chat_message",
                "content": "Retain until accepted",
                "clientMessageId": "request-001",
            }
        )
        message = socket.receive_json()
        ack = socket.receive_json()
        assert message["type"] == "chat_message"
        assert ack == {
            "type": "chat_ack",
            "clientMessageId": "request-001",
            "accepted": True,
            "messageId": message["messageId"],
        }
        assert len(chat.get_history()) == 1
        socket.send_json({"type": "ping"})
        assert socket.receive_json() == {"type": "pong"}  # no duplicate acknowledgement
    chat.clear_history()


@pytest.mark.parametrize("enabled, content", [(False, "disabled"), (True, "   ")])
def test_rejected_chat_is_never_acknowledged_as_accepted(
    monkeypatch: pytest.MonkeyPatch, enabled: bool, content: str
):
    monkeypatch.setattr(settings, "chat_enabled", enabled)
    token = create_access_token({"sub": "synthetic-sender", "role": "viewer"})
    with TestClient(app).websocket_connect(f"/api/ws?token={token}") as socket:
        socket.receive_json()
        if enabled:
            socket.receive_json()
        socket.send_json(
            {"type": "chat_message", "content": content, "clientMessageId": "request-rejected"}
        )
        assert socket.receive_json() == {
            "type": "chat_ack",
            "clientMessageId": "request-rejected",
            "accepted": False,
        }
