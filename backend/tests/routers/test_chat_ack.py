"""FE-11 server acceptance acknowledgements, using synthetic local WebSockets."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from app.config import settings
from app.main import app
from app.services import chat
from app.services.auth import create_access_token
from tests.ws_helpers import ws_connect


@pytest.fixture(autouse=True)
def reset_recent_chat_sends() -> Iterator[None]:
    chat._recent_sends.clear()
    yield
    chat._recent_sends.clear()


def test_chat_ack_identifies_the_stored_message(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "chat_enabled", True)
    chat.clear_history()
    token = create_access_token({"sub": "synthetic-sender", "role": "viewer"})
    with ws_connect(TestClient(app), token) as socket:
        socket.receive_json()
        socket.receive_json()
        socket.send_json(
            {
                "type": "chat_message",
                "content": "Retain until accepted",
                "clientMessageId": "request-001",
            }
        )
        # The ack comes first: it confirms the stored message, before the broadcast
        ack = socket.receive_json()
        message = socket.receive_json()
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
    with ws_connect(TestClient(app), token) as socket:
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


def _send_chat(socket: WebSocketTestSession, content: str, client_message_id: str) -> None:
    socket.send_json(
        {"type": "chat_message", "content": content, "clientMessageId": client_message_id}
    )


def _skip_greeting(socket: WebSocketTestSession) -> None:
    socket.receive_json()  # connection_ack
    socket.receive_json()  # chat_history


def test_repeated_client_message_id_is_acknowledged_without_reposting(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "chat_enabled", True)
    chat.clear_history()
    token = create_access_token({"sub": "synthetic-retrier", "role": "viewer"})
    client = TestClient(app)
    with ws_connect(client, token) as socket:
        _skip_greeting(socket)
        _send_chat(socket, "Only once", "retry-001")
        assert socket.receive_json()["accepted"] is True
        original = socket.receive_json()
        assert original["type"] == "chat_message"

        _send_chat(socket, "Only once", "retry-001")
        # No second broadcast: the very next frame is the repeated acknowledgement
        assert socket.receive_json() == {
            "type": "chat_ack",
            "clientMessageId": "retry-001",
            "accepted": True,
            "messageId": original["messageId"],
        }
        socket.send_json({"type": "ping"})
        assert socket.receive_json() == {"type": "pong"}

    # A retry after reconnecting (a new socket) is recognised too
    with ws_connect(client, token) as socket:
        _skip_greeting(socket)
        _send_chat(socket, "Only once", "retry-001")
        assert socket.receive_json() == {
            "type": "chat_ack",
            "clientMessageId": "retry-001",
            "accepted": True,
            "messageId": original["messageId"],
        }

    assert [m.message_id for m in chat.get_history()] == [original["messageId"]]
    chat.clear_history()


def test_the_same_client_message_id_from_another_user_is_posted(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(settings, "chat_enabled", True)
    chat.clear_history()
    client = TestClient(app)
    ids: list[str] = []
    for sub in ("synthetic-alice", "synthetic-bob"):
        token = create_access_token({"sub": sub, "role": "viewer"})
        with ws_connect(client, token) as socket:
            _skip_greeting(socket)
            _send_chat(socket, f"Hello from {sub}", "shared-id")
            ack = socket.receive_json()
            message = socket.receive_json()
            assert message["type"] == "chat_message"
            assert ack["messageId"] == message["messageId"]
            ids.append(message["messageId"])
    assert len(set(ids)) == 2
    assert len(chat.get_history()) == 2
    chat.clear_history()


def test_recent_sends_are_bounded_oldest_first(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "chat_enabled", True)
    monkeypatch.setattr(chat, "MAX_RECENT_SENDS", 2)
    chat.clear_history()
    token = create_access_token({"sub": "synthetic-busy", "role": "viewer"})
    with ws_connect(TestClient(app), token) as socket:
        _skip_greeting(socket)
        for client_message_id in ("bound-1", "bound-2", "bound-3"):
            _send_chat(socket, client_message_id, client_message_id)
            socket.receive_json()
            socket.receive_json()
        assert list(chat._recent_sends) == [
            ("synthetic-busy", "bound-2"),
            ("synthetic-busy", "bound-3"),
        ]
        # The evicted id is no longer recognised, so it posts again
        _send_chat(socket, "bound-1", "bound-1")
        assert socket.receive_json()["accepted"] is True
        assert socket.receive_json()["type"] == "chat_message"
    chat.clear_history()


def test_clearing_history_forgets_recent_sends(monkeypatch: pytest.MonkeyPatch):
    """A retry of a pre-clear send posts a new message instead of acking a deleted one."""
    monkeypatch.setattr(settings, "chat_enabled", True)
    monkeypatch.setattr(settings, "admin_username", "synthetic-admin")
    chat.clear_history()
    admin_token = create_access_token({"sub": "synthetic-admin", "role": "admin"})
    token = create_access_token({"sub": "synthetic-resender", "role": "viewer"})
    client = TestClient(app)
    with ws_connect(client, token) as socket:
        _skip_greeting(socket)
        _send_chat(socket, "Before the clear", "resend-001")
        ack = socket.receive_json()
        original = socket.receive_json()
        assert original["type"] == "chat_message"
        assert ack["messageId"] == original["messageId"]

        response = client.delete(
            "/api/admin/chat-history", headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        assert socket.receive_json() == {"type": "chat_history", "messages": []}

        _send_chat(socket, "Before the clear", "resend-001")
        ack = socket.receive_json()
        reposted = socket.receive_json()
        assert reposted["type"] == "chat_message"
        assert reposted["messageId"] != original["messageId"]
        assert ack == {
            "type": "chat_ack",
            "clientMessageId": "resend-001",
            "accepted": True,
            "messageId": reposted["messageId"],
        }

    assert [m.message_id for m in chat.get_history()] == [reposted["messageId"]]
    chat.clear_history()
