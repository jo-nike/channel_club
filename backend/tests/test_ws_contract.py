"""The WebSocket contract: every server-to-client message, exactly as it goes on the wire.

Each message type is built through the code that sends it in production and
compared with a literal dict, so a refactor can't add, drop or rename a key,
or turn a null into an absent key (browsers still running an older bundle read
these payloads). The guards below keep every send on the typed models and
the committed JSON Schema in step with them.
"""

import ast
import json
from collections.abc import Awaitable, Callable, Iterator
from datetime import UTC, datetime
from io import StringIO
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from loguru import logger

from app.config import settings
from app.main import app
from app.models.auth import TokenPayload
from app.models.channel import Channel
from app.models.websocket import server_message_adapter
from app.routers import admin
from app.routers import websocket as websocket_router
from app.services import (
    app_settings,
    channel_state,
    chat,
    config_apply,
    presence,
    presence_broadcast,
)
from app.services.auth import create_access_token
from tests.ws_helpers import ws_connect

MESSAGE_ID = "00000000-0000-4000-8000-000000000001"
SENT_AT = datetime(2026, 9, 28, 12, 0, tzinfo=UTC)
TSN = Channel(id="42", name="TSN 5", stream_url="http://streams/42", guide_id="tsn5")
TSN_WIRE = {
    "id": "42",
    "name": "TSN 5",
    "streamUrl": "http://streams/42",
    "guideId": "tsn5",
    "logoUrl": None,
}
NO_CHANNEL = {"channelId": None, "channelName": None, "programme": None, "view": None}


class _FixedDatetime(datetime):
    """datetime whose now() is SENT_AT, so chat timestamps are known."""

    @classmethod
    def now(cls, tz=None):  # pyright: ignore[reportIncompatibleMethodOverride]
        return SENT_AT


@pytest.fixture(autouse=True)
def fixed_chat_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every chat message gets MESSAGE_ID and SENT_AT."""
    monkeypatch.setattr(chat, "uuid4", lambda: UUID(MESSAGE_ID))
    monkeypatch.setattr(chat, "datetime", _FixedDatetime)


@pytest.fixture(autouse=True)
def reset_sockets() -> Iterator[None]:
    """No connection or nickname left over from another test."""
    channel_state._active_connections.clear()
    websocket_router._nickname_map.clear()
    yield
    channel_state._active_connections.clear()
    websocket_router._nickname_map.clear()


@pytest.fixture
def client() -> Iterator[TestClient]:
    with (
        patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
        TestClient(app) as client,
    ):
        yield client


@pytest.fixture
def token() -> str:
    return create_access_token({"sub": "testuser", "role": "viewer"})


@pytest.fixture
def chat_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "chat_enabled", True)


YOU = {"username": "testuser", "userId": chat.user_id_for("testuser", None)}


async def _broadcasts(send: Callable[[], Awaitable[object]]) -> list[dict]:
    """Run send() with one listening connection and return what it received, parsed."""
    peer = MagicMock()
    peer.send_text = AsyncMock()
    await channel_state.connect(peer)
    await send()
    return [json.loads(call.args[0]) for call in peer.send_text.await_args_list]


class TestDirectSends:
    """Messages sent to one socket by the WebSocket endpoint."""

    def test_connection_ack_with_live(self, client: TestClient, token: str) -> None:
        channel_state._current_channel = TSN
        with ws_connect(client, token) as ws:
            assert ws.receive_json() == {
                "type": "connection_ack",
                "currentChannel": TSN_WIRE,
                "settings": {"userChannelSelection": False, "presenceVisible": False},
                "you": YOU,
                "presence": [],
                "buildId": "dev",
                "features": {"chat": False, "gif": False, "nhl": False},
            }

    def test_connection_ack_without_live(self, client: TestClient, token: str) -> None:
        with ws_connect(client, token) as ws:
            assert ws.receive_json()["currentChannel"] is None

    @pytest.mark.usefixtures("chat_on")
    def test_chat_history(self, client: TestClient, token: str) -> None:
        chat.add_message("alice", "hi", user_id="u_alice")
        with ws_connect(client, token) as ws:
            ws.receive_json()
            assert ws.receive_json() == {
                "type": "chat_history",
                "messages": [
                    {
                        "messageId": MESSAGE_ID,
                        "username": "alice",
                        "userId": "u_alice",
                        "content": "hi",
                        "timestamp": "2026-09-28T12:00:00+00:00",
                        "kind": "user",
                        **NO_CHANNEL,
                    }
                ],
            }

    @pytest.mark.usefixtures("chat_on")
    def test_chat_ack_accepted_then_chat_message(self, client: TestClient, token: str) -> None:
        with ws_connect(client, token) as ws:
            ws.receive_json()
            ws.receive_json()  # chat_history
            ws.send_json({"type": "chat_message", "content": "hello", "clientMessageId": "c1"})
            assert ws.receive_json() == {
                "type": "chat_ack",
                "clientMessageId": "c1",
                "accepted": True,
                "messageId": MESSAGE_ID,
            }
            assert ws.receive_json() == {
                "type": "chat_message",
                "messageId": MESSAGE_ID,
                "username": "testuser",
                "userId": YOU["userId"],
                "content": "hello",
                "timestamp": "2026-09-28T12:00:00+00:00",
                "kind": "user",
                **NO_CHANNEL,
            }

    def test_chat_ack_refused_has_no_message_id(self, client: TestClient, token: str) -> None:
        with ws_connect(client, token) as ws:
            ws.receive_json()
            ws.send_json({"type": "chat_message", "content": "hello", "clientMessageId": "c1"})
            assert ws.receive_json() == {
                "type": "chat_ack",
                "clientMessageId": "c1",
                "accepted": False,
            }

    def test_pong(self, client: TestClient, token: str) -> None:
        with ws_connect(client, token) as ws:
            ws.receive_json()
            ws.send_json({"type": "ping"})
            assert ws.receive_json() == {"type": "pong"}

    def test_invalid_message_error(self, client: TestClient, token: str) -> None:
        with ws_connect(client, token) as ws:
            ws.receive_json()
            ws.send_json({"type": "chat_message", "content": 5})
            assert ws.receive_json() == {"type": "error", "code": "invalid_message"}

    def test_rate_limited_error(
        self, client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(websocket_router, "MESSAGE_BURST", 0)
        with ws_connect(client, token) as ws:
            ws.receive_json()
            ws.send_json({"type": "set_nickname", "nickname": "Neo"})
            assert ws.receive_json() == {
                "type": "error",
                "code": "rate_limited",
                "nickname": "Neo",
            }

    def test_nickname_taken_error(self, client: TestClient, token: str) -> None:
        with ws_connect(client, token) as ws:
            ws.receive_json()
            ws.send_json({"type": "set_nickname", "nickname": "Live TV"})
            assert ws.receive_json() == {
                "type": "error",
                "code": "nickname_taken",
                "nickname": "Live TV",
            }


class TestFeatures:
    """The server tells clients which of chat and GIFs are on (G-06)."""

    @pytest.mark.parametrize("chat_enabled", [True, False])
    @pytest.mark.parametrize("giphy_api_key", ["giphy-key", None, ""])
    def test_ack_carries_the_server_switches(
        self,
        client: TestClient,
        token: str,
        monkeypatch: pytest.MonkeyPatch,
        chat_enabled: bool,
        giphy_api_key: str | None,
    ) -> None:
        monkeypatch.setattr(settings, "chat_enabled", chat_enabled)
        monkeypatch.setattr(settings, "giphy_api_key", giphy_api_key)
        with ws_connect(client, token) as ws:
            assert ws.receive_json()["features"] == {
                "chat": chat_enabled,
                "gif": giphy_api_key == "giphy-key",
                "nhl": False,
            }

    def test_ack_carries_the_nhl_switch(
        self, client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "nhl_enabled", True)
        with ws_connect(client, token) as ws:
            assert ws.receive_json()["features"]["nhl"] is True

    @pytest.mark.parametrize("chat_enabled", [True, False])
    def test_startup_warns_when_chat_is_off(
        self, monkeypatch: pytest.MonkeyPatch, chat_enabled: bool
    ) -> None:
        monkeypatch.setattr(settings, "chat_enabled", chat_enabled)
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="WARNING")
        try:
            with (
                patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
                TestClient(app),
            ):
                pass
        finally:
            logger.remove(handler_id)

        warning = "WARNING | Chat is off: CHAT_ENABLED is false, so clients hide chat"
        assert (warning in output.getvalue()) is not chat_enabled


class TestBroadcasts:
    """Messages broadcast to every connection by the services."""

    async def test_channel_update(self) -> None:
        sent = await _broadcasts(lambda: channel_state.broadcast_channel_update(TSN, "alice"))
        assert sent == [{"type": "channel_update", "channel": TSN_WIRE, "changedBy": "alice"}]

    async def test_channel_update_on_clear(self) -> None:
        sent = await _broadcasts(lambda: channel_state.clear_current_channel_async())
        assert sent == [{"type": "channel_update", "channel": None, "changedBy": None}]

    @pytest.mark.usefixtures("chat_on")
    async def test_system_chat_line(self) -> None:
        sent = await _broadcasts(lambda: channel_state._broadcast_system_line("alice put on TSN"))
        assert sent == [
            {
                "type": "chat_message",
                "messageId": MESSAGE_ID,
                "username": chat.SYSTEM_USERNAME,
                "userId": "",
                "content": "alice put on TSN",
                "timestamp": "2026-09-28T12:00:00+00:00",
                "kind": "system",
                **NO_CHANNEL,
            }
        ]

    async def test_settings_update(self) -> None:
        sent = await _broadcasts(app_settings.broadcast_settings_update)
        assert sent == [
            {
                "type": "settings_update",
                "settings": {"userChannelSelection": False, "presenceVisible": False},
            }
        ]

    @pytest.mark.usefixtures("chat_on")
    async def test_features_update(self) -> None:
        sent = await _broadcasts(config_apply.broadcast_features_update)
        assert sent == [
            {"type": "features_update", "features": {"chat": True, "gif": False, "nhl": False}}
        ]

    async def test_presence_update(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(presence_broadcast, "BROADCAST_DEBOUNCE_SECONDS", 0)
        monkeypatch.setattr(app_settings, "_presence_visible", True)
        presence.track_user("c1", "alice", "live", user_id="u_alice")
        presence.update_user_channel("c1", "TSN 5", "Hockey", "live", channel_id="42")
        presence._active_users["c1"].channel_since = SENT_AT
        presence.track_user("c2", "bob", "ersatztv", user_id="u_bob", hide_activity=True)
        presence.update_user_channel("c2", "Cartoons", None, "ersatztv", channel_id="etv-2")

        sent = await _broadcasts(presence_broadcast._broadcast_after_debounce)
        assert sent == [
            {
                "type": "presence_update",
                "presence": [
                    {
                        "userId": "u_alice",
                        "displayName": "alice",
                        "channelId": "42",
                        "channelName": "TSN 5",
                        "programme": "Hockey",
                        "view": "live",
                        "since": "2026-09-28T12:00:00+00:00",
                    },
                    {
                        "userId": "u_bob",
                        "displayName": "bob",
                        "channelId": None,
                        "channelName": None,
                        "programme": None,
                        "view": None,
                        "since": None,
                    },
                ],
            }
        ]

    async def test_chat_history_cleared(self) -> None:
        admin_user = TokenPayload(sub="admin", role="admin", exp=SENT_AT)
        sent = await _broadcasts(lambda: admin.clear_chat_history(current_user=admin_user))
        assert sent == [{"type": "chat_history", "messages": []}]


APP_DIR = Path(__file__).parents[1] / "app"
SCHEMA_FILE = Path(__file__).parent / "snapshots" / "ws_server_messages.schema.json"
REGENERATE = (
    'cd backend && uv run --frozen python -c "import json; '
    "from app.models.websocket import server_message_adapter as a; "
    "print(json.dumps(a.json_schema(mode='serialization'), indent=2))\" "
    "> tests/snapshots/ws_server_messages.schema.json"
)


def _is_dict(node: ast.expr, dict_names: set[str]) -> bool:
    """A dict literal or comprehension, a dict() call, or a name assigned one of those."""
    if isinstance(node, ast.Dict | ast.DictComp):
        return True
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        return node.func.id == "dict"
    return isinstance(node, ast.Name) and node.id in dict_names


def _dict_sends(app_dir: Path) -> list[str]:
    """send_json( and broadcast( calls under app_dir that are handed a dict, not a model."""
    found: set[str] = set()
    for path in sorted(app_dir.rglob("*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        for scope in ast.walk(tree):
            if not isinstance(scope, ast.FunctionDef | ast.AsyncFunctionDef):
                continue
            dict_names: set[str] = set()
            for node in ast.walk(scope):
                if isinstance(node, ast.Assign) and _is_dict(node.value, set()):
                    dict_names.update(t.id for t in node.targets if isinstance(t, ast.Name))
                elif (
                    isinstance(node, ast.AnnAssign)
                    and node.value is not None
                    and _is_dict(node.value, set())
                    and isinstance(node.target, ast.Name)
                ):
                    dict_names.add(node.target.id)
            for node in ast.walk(scope):
                if not isinstance(node, ast.Call) or not node.args:
                    continue
                func = node.func
                name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
                if name in ("send_json", "broadcast") and _is_dict(node.args[0], dict_names):
                    found.add(f"{path.relative_to(app_dir.parent)}:{node.lineno} {name}")
    return sorted(found)


def test_no_send_is_handed_a_dict() -> None:
    # A dict skips the models, so its keys can drift from what clients read.
    # Build a ServerMessage model and use channel_state.broadcast or send_message.
    assert _dict_sends(APP_DIR) == []


def test_committed_schema_matches_the_models() -> None:
    generated = server_message_adapter.json_schema(mode="serialization")
    committed = json.loads(SCHEMA_FILE.read_text())
    assert committed == generated, (
        "The server message models changed. Regenerate the schema with\n"
        f"  {REGENERATE}\n"
        "and update frontend/src/types/ws.ts to match."
    )
