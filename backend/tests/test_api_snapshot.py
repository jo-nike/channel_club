"""Snapshots of the JSON the API sends and accepts, so a model refactor can't move a byte.

Three committed files pin the wire: the OpenAPI schema (every request and
response model's property names), a scripted WebSocket session with every
server message type, and a handful of REST bodies. Volatile values (session ids,
the build id) are normalised; payload key order is kept, since the snapshot
text is compared as written.

Regenerate after an intended wire change with
  cd backend && UPDATE_API_SNAPSHOTS=1 uv run --frozen pytest tests/test_api_snapshot.py
and check that the diff is the change you meant, and that the frontend agrees.
"""

import json
import os
from collections.abc import Awaitable, Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.models.auth import TokenPayload
from app.models.channel import Channel, ChannelGroupWithChannels, GroupedChannelsResponse
from app.models.epg import EPGProgrammesResponse, EPGResponse, Program
from app.models.ersatztv import EPGChannel, Programme
from app.models.nhl import NHLBroadcast, NHLGame, NHLScoresResponse, NHLSituation, NHLTeam
from app.models.status import (
    DispatcharrStream,
    DispatchrrStatus,
    EPGHealthStatus,
    ErsatzTVSession,
    ErsatzTVStatus,
    SystemStatusResponse,
)
from app.routers import websocket as websocket_router
from app.routers.auth_deps import require_admin
from app.services import (
    app_settings,
    channel_state,
    chat,
    config_apply,
    presence,
    presence_broadcast,
)
from app.services.auth import create_access_token
from app.services.highlight import Capture
from app.services.media_source import MediaChannel
from tests.ws_helpers import ws_connect

SNAPSHOTS = Path(__file__).parent / "snapshots"
OPENAPI_FILE = SNAPSHOTS / "openapi.json"
WS_FILE = SNAPSHOTS / "ws_payloads.json"
REST_FILE = SNAPSHOTS / "rest_bodies.json"
UPDATE = os.environ.get("UPDATE_API_SNAPSHOTS") == "1"

MESSAGE_ID = "00000000-0000-4000-8000-000000000001"
SENT_AT = datetime(2026, 9, 28, 12, 0, tzinfo=UTC)
LATER = datetime(2026, 9, 28, 13, 0, tzinfo=UTC)
TSN = Channel(
    id="42", name="TSN 5", stream_url="http://streams/42", guide_id="tsn5", logo_url="/logo/42"
)
# Keys whose values change from run to run whatever the input
VOLATILE_KEYS = {"buildId", "session_id", "sessionId"}


class _FixedDatetime(datetime):
    """datetime whose now() is SENT_AT, so chat timestamps are known."""

    @classmethod
    def now(cls, tz=None):  # pyright: ignore[reportIncompatibleMethodOverride]
        return SENT_AT


@pytest.fixture(autouse=True)
def fixed_chat_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(chat, "uuid4", lambda: UUID(MESSAGE_ID))
    monkeypatch.setattr(chat, "datetime", _FixedDatetime)


@pytest.fixture(autouse=True)
def reset_sockets() -> Iterator[None]:
    channel_state._active_connections.clear()
    websocket_router._nickname_map.clear()
    yield
    channel_state._active_connections.clear()
    websocket_router._nickname_map.clear()


@pytest.fixture
def as_admin() -> Iterator[None]:
    """Admin routes without a configured admin: require_admin answers with one."""
    app.dependency_overrides[require_admin] = lambda: TokenPayload(
        sub="admin", role="admin", exp=LATER
    )
    yield
    app.dependency_overrides.pop(require_admin, None)


@pytest.fixture
def client() -> Iterator[TestClient]:
    with (
        patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
        TestClient(app) as client,
    ):
        yield client


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': 'testuser', 'role': 'viewer'})}"}


def _normalise(value: Any, volatile: set[str]) -> Any:
    """Replace volatile keys' values, and any volatile id inside a string."""
    if isinstance(value, dict):
        return {
            key: "<volatile>" if key in VOLATILE_KEYS else _normalise(item, volatile)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_normalise(item, volatile) for item in value]
    if isinstance(value, str):
        for text in volatile:
            value = value.replace(text, "<volatile>")
    return value


def _check(path: Path, text: str) -> None:
    if UPDATE:
        path.write_text(text)
    assert path.read_text() == text, f"{path.name} changed; see this module's docstring"


def _dump(payloads: dict[str, Any], volatile: set[str] | None = None) -> str:
    return json.dumps(_normalise(payloads, volatile or set()), indent=2) + "\n"


def test_openapi_schema() -> None:
    _check(OPENAPI_FILE, json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")


async def _broadcasts(send: Callable[[], Awaitable[object]]) -> list[dict]:
    """Run send() with one listening connection and return what it received, parsed."""
    peer = MagicMock()
    peer.send_text = AsyncMock()
    await channel_state.connect(peer)
    try:
        await send()
    finally:
        channel_state.disconnect(peer)
    return [json.loads(call.args[0]) for call in peer.send_text.await_args_list]


def test_websocket_payloads(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    payloads: dict[str, Any] = {}
    token = create_access_token({"sub": "testuser", "role": "viewer"})
    monkeypatch.setattr(settings, "chat_enabled", True)
    channel_state._current_channel = TSN
    chat.add_message("alice", "hi", user_id="u_alice")
    with ws_connect(client, token) as ws:
        payloads["connection_ack"] = ws.receive_json()
        payloads["chat_history"] = ws.receive_json()
        ws.send_json({"type": "chat_message", "content": "hello", "clientMessageId": "c1"})
        payloads["chat_ack_accepted"] = ws.receive_json()
        payloads["chat_message"] = ws.receive_json()
        ws.send_json({"type": "ping"})
        payloads["pong"] = ws.receive_json()
        ws.send_json({"type": "chat_message", "content": 5, "clientMessageId": "c2"})
        payloads["error_invalid_message"] = ws.receive_json()
        ws.send_json({"type": "set_nickname", "nickname": "Live TV"})
        payloads["error_nickname_taken"] = ws.receive_json()

    monkeypatch.setattr(settings, "chat_enabled", False)
    channel_state._current_channel = None
    with ws_connect(client, token) as ws:
        payloads["connection_ack_no_live"] = ws.receive_json()
        ws.send_json({"type": "chat_message", "content": "hello", "clientMessageId": "c3"})
        payloads["chat_ack_refused"] = ws.receive_json()

    monkeypatch.setattr(presence_broadcast, "BROADCAST_DEBOUNCE_SECONDS", 0)
    monkeypatch.setattr(app_settings, "_presence_visible", True)
    presence.track_user("c1", "alice", "live", user_id="u_alice")
    presence.update_user_channel("c1", "TSN 5", "Hockey", "live", channel_id="42")
    presence._active_users["c1"].channel_since = SENT_AT
    presence.track_user("c2", "bob", "ersatztv", user_id="u_bob", hide_activity=True)

    async def broadcasts() -> None:
        payloads["channel_update"] = await _broadcasts(
            lambda: channel_state.broadcast_channel_update(TSN, "alice")
        )
        payloads["channel_update_cleared"] = await _broadcasts(
            channel_state.clear_current_channel_async
        )
        payloads["settings_update"] = await _broadcasts(app_settings.broadcast_settings_update)
        payloads["features_update"] = await _broadcasts(config_apply.broadcast_features_update)
        payloads["presence_update"] = await _broadcasts(
            presence_broadcast._broadcast_after_debounce
        )

    client.portal.call(broadcasts)  # pyright: ignore[reportOptionalMemberAccess]
    _check(WS_FILE, _dump(payloads))


def _body(response: Any) -> Any:
    assert response.status_code == 200, response.text
    return json.loads(response.text)


def _status() -> SystemStatusResponse:
    return SystemStatusResponse(
        ersatztv=ErsatzTVStatus(
            name="ErsatzTV",
            online=True,
            last_checked=SENT_AT,
            active_sessions=1,
            sessions=[
                ErsatzTVSession(
                    channel_number=3,
                    channel_name="Cartoons",
                    state="running",
                    buffer_seconds=4.5,
                    streaming_mode="hls",
                    resolution="1920x1080",
                    video_codec="h264",
                    video_bitrate=5000,
                    audio_codec="aac",
                    audio_bitrate=128,
                )
            ],
        ),
        dispatcharr=DispatchrrStatus(
            name="Dispatcharr",
            online=True,
            degraded=True,
            last_checked=SENT_AT,
            error="stats unavailable",
            active_streams=1,
            total_viewers=2,
            streams=[
                DispatcharrStream(
                    channel_id="42",
                    stream_name="TSN 5",
                    client_count=2,
                    uptime=60.5,
                    total_bytes=1024,
                    avg_bitrate="4 Mbps",
                    video_codec="h264",
                    resolution="1280x720",
                    source_fps=59.94,
                )
            ],
        ),
        epg=EPGHealthStatus(
            name="EPG",
            online=True,
            last_checked=SENT_AT,
            channel_count=10,
            programme_count=200,
            last_attempt_at=SENT_AT,
            last_success_at=SENT_AT,
        ),
        ersatztv_guide=EPGHealthStatus(
            name="ErsatzTV guide",
            online=False,
            stale=True,
            last_checked=SENT_AT,
            error="HTTP 403",
            next_retry_at=LATER,
        ),
    )


def _grouped() -> GroupedChannelsResponse:
    return GroupedChannelsResponse(
        groups=[ChannelGroupWithChannels(id=1, name="Sports", channel_count=1, channels=[TSN])],
        ungrouped=[Channel(id="9", name="Nine", stream_url="http://streams/9", guide_id="nine")],
    )


def _program(title: str, start: datetime, end: datetime) -> Program:
    return Program(title=title, start_time=start, end_time=end, description=f"{title} tonight")


def _etv_channel() -> EPGChannel:
    return EPGChannel(
        id="3",
        xmltv_id="3.etv",
        name="Cartoons",
        stream_url="http://ersatztv/iptv/channel/3.m3u8",
        logo_url="/api/ersatztv/logos/3",
        original_logo_url="http://ersatztv/logo.png",
        number=3,
        group="Kids",
    )


def _programme(title: str, start: datetime, stop: datetime) -> Programme:
    return Programme(
        id=f"3-{title}",
        channel_id="3",
        title=title,
        description="A cartoon",
        start=start,
        stop=stop,
        category=["Animation"],
        season=1,
        episode=2,
        year="1999",
    )


def _nhl() -> NHLScoresResponse:
    def team(name: str, abbreviation: str, score: int) -> NHLTeam:
        return NHLTeam(
            name=name,
            abbreviation=abbreviation,
            score=score,
            logo=f"https://logo/{abbreviation}.svg",
            logo_dark=f"https://logo/{abbreviation}_dark.svg",
        )

    return NHLScoresResponse(
        games=[
            NHLGame(
                id=2025020001,
                status="live",
                home_team=team("Maple Leafs", "TOR", 2),
                away_team=team("Canadiens", "MTL", 1),
                start_time="2026-09-28T23:00:00Z",
                game_center_link="https://nhl/gamecenter/1",
                period="2nd",
                time_remaining="10:00",
                is_intermission=False,
                situation=NHLSituation(
                    away_strength=4,
                    home_strength=5,
                    time_remaining="1:30",
                    home_description=["PP"],
                ),
                broadcasts=[NHLBroadcast(network="SN", market="N", country_code="CA")],
            ),
            NHLGame(
                id=2025020002,
                status="final",
                home_team=team("Oilers", "EDM", 3),
                away_team=team("Flames", "CGY", 2),
                start_time="2026-09-28T01:00:00Z",
                game_center_link="https://nhl/gamecenter/2",
                outcome_type="OT",
            ),
        ],
        date="2026-09-28",
        live_game_count=1,
    )


@pytest.mark.usefixtures("as_admin")
def test_rest_bodies(client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    bodies: dict[str, Any] = {}
    volatile: set[str] = set()
    viewer = _headers()

    # The sample shows a server with no sign-in method on
    monkeypatch.setattr(settings, "local_auth_enabled", False)
    bodies["GET /api/auth/config"] = _body(client.get("/api/auth/config"))
    monkeypatch.setattr(app_settings, "_user_channel_selection", True)
    bodies["GET /api/settings"] = _body(client.get("/api/settings", headers=viewer))

    with patch(
        "app.routers.admin.status_service.get_system_status", AsyncMock(return_value=_status())
    ):
        bodies["GET /api/admin/status"] = _body(client.get("/api/admin/status", headers=viewer))

    channel_state._current_channel = TSN
    presence.track_user("c1", "alice", "live", user_id="u_alice")
    presence.update_user_channel("c1", "TSN 5", "Hockey", "live", channel_id="42")
    presence._active_users["c1"].connected_since = SENT_AT
    presence.track_user("c2", "bob", "ersatztv", user_id="u_bob")
    presence._active_users["c2"].connected_since = SENT_AT
    bodies["GET /api/admin/active-users"] = _body(
        client.get("/api/admin/active-users", headers=viewer)
    )
    bodies["GET /api/channels/current"] = _body(client.get("/api/channels/current", headers=viewer))

    with patch("app.routers.channels.get_grouped_channels", AsyncMock(return_value=_grouped())):
        bodies["GET /api/channels/grouped"] = _body(
            client.get("/api/channels/grouped", headers=viewer)
        )

    epg = MagicMock()
    epg.get_now_playing = AsyncMock(
        return_value=EPGResponse(
            channel_id="42",
            current_program=_program("Hockey", SENT_AT, LATER),
            next_program=_program("News", LATER, LATER),
        )
    )
    epg.get_now_playing_bulk = AsyncMock(return_value={"42": _program("Hockey", SENT_AT, LATER)})
    epg.get_programmes = AsyncMock(
        return_value=EPGProgrammesResponse(
            channel_id="42", programmes=[_program("Hockey", SENT_AT, LATER)]
        )
    )
    with (
        patch("app.routers.epg.get_epg_service", return_value=epg),
        patch("app.routers.epg.get_grouped_channels", AsyncMock(return_value=_grouped())),
    ):
        bodies["GET /api/epg/now-playing"] = _body(
            client.get("/api/epg/now-playing?channel_id=42", headers=viewer)
        )
        bodies["GET /api/epg/now-playing/all"] = _body(
            client.get("/api/epg/now-playing/all", headers=viewer)
        )
        bodies["GET /api/epg/programmes"] = _body(
            client.get("/api/epg/programmes?channel_id=42", headers=viewer)
        )

    with (
        patch("app.routers.ersatztv.get_channels", return_value=[_etv_channel()]),
        patch("app.routers.ersatztv.get_channel_by_id", return_value=_etv_channel()),
        patch(
            "app.routers.ersatztv.get_current_programme",
            AsyncMock(
                return_value=(_programme("Now", SENT_AT, LATER), _programme("Next", LATER, LATER))
            ),
        ),
        patch(
            "app.routers.ersatztv.get_programmes_by_channel",
            AsyncMock(return_value=[_programme("Now", SENT_AT, LATER)]),
        ),
    ):
        bodies["GET /api/ersatztv/channels"] = _body(
            client.get("/api/ersatztv/channels", headers=viewer)
        )
        bodies["GET /api/ersatztv/current/3"] = _body(
            client.get("/api/ersatztv/current/3", headers=viewer)
        )
        bodies["GET /api/ersatztv/programmes/3"] = _body(
            client.get("/api/ersatztv/programmes/3", headers=viewer)
        )
        session = _body(
            client.post("/api/ersatztv/session", json={"channelId": "3"}, headers=viewer)
        )
        volatile.add(session["sessionId"])
        bodies["POST /api/ersatztv/session"] = session

    monkeypatch.setattr(settings, "nhl_enabled", True)
    with patch("app.routers.nhl.get_nhl_scores", AsyncMock(return_value=_nhl())):
        bodies["GET /api/nhl/scores"] = _body(client.get("/api/nhl/scores", headers=viewer))

    etv_source = MediaChannel(TSN, "hls")
    with patch("app.routers.cast.resolve_media_channel", AsyncMock(return_value=etv_source)):
        cast = _body(
            client.post(
                "/api/cast/session",
                json={"channel_id": "42", "stream_type": "hls"},
                headers=viewer,
            )
        )
    volatile.add(cast["session_id"])
    bodies["POST /api/cast/session"] = cast

    path = tmp_path / "snapshot.mp4"
    path.write_bytes(b"0123456789")
    capture = Capture("capture-0001", "local:testuser", "42", path, 10, 12.5, 1000.0, 998.0, 1000.0)
    with (
        patch("app.routers.highlight.settings") as highlight_settings,
        patch("app.routers.highlight.highlight_service") as service,
    ):
        highlight_settings.highlight_enabled = True
        service.create_capture = AsyncMock(return_value=(capture, None))
        service.issue_preview_token.return_value = "preview-token-0001"
        bodies["POST /api/highlight/42/capture"] = _body(
            client.post("/api/highlight/42/capture", headers=viewer)
        )

    _check(REST_FILE, _dump(bodies, volatile))
