"""Tests for admin router."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, RouteContext, iter_route_contexts
from fastapi.testclient import TestClient
from loguru import logger

from app.main import app
from app.models.auth import TokenPayload
from app.models.channel import Channel
from app.models.status import (
    DispatchrrStatus,
    EPGHealthStatus,
    ErsatzTVStatus,
    SystemStatusResponse,
)
from app.routers.auth_deps import require_admin
from app.services import channel_state, chat, presence
from app.services.auth import create_access_token

if TYPE_CHECKING:
    from loguru import Record


@pytest.fixture
def admin_token_payload() -> TokenPayload:
    """Create an admin token payload."""
    return TokenPayload(
        sub="admin",
        role="admin",
        exp=datetime(2030, 1, 1, tzinfo=UTC),
    )


@pytest.fixture
def viewer_token_payload() -> TokenPayload:
    """Create a viewer token payload."""
    return TokenPayload(
        sub="viewer",
        role="viewer",
        exp=datetime(2030, 1, 1, tzinfo=UTC),
    )


@pytest.fixture(autouse=True)
def reset_presence_state():
    """Reset presence state before each test."""
    presence._active_users.clear()
    yield
    presence._active_users.clear()


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    return TestClient(app)


class TestGetActiveUsers:
    """Tests for GET /api/admin/active-users endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Should return 401 without token."""
        response = client.get("/api/admin/active-users")
        assert response.status_code == 401

    def test_requires_admin_role(
        self,
        client: TestClient,
        viewer_token_payload: TokenPayload,
    ) -> None:
        """Should return 403 for non-admin users."""
        with patch("app.routers.auth_deps.verify_token") as mock_verify:
            mock_verify.return_value = viewer_token_payload
            response = client.get(
                "/api/admin/active-users",
                headers={"Authorization": "Bearer fake_token"},
            )
        assert response.status_code == 403

    def test_returns_empty_response_when_no_users(
        self,
        client: TestClient,
        admin_token_payload: TokenPayload,
    ) -> None:
        """Should return empty lists when no users connected."""
        with patch("app.routers.auth_deps.verify_token") as mock_verify:
            mock_verify.return_value = admin_token_payload
            response = client.get(
                "/api/admin/active-users",
                headers={"Authorization": "Bearer fake_token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["liveUsers"] == []
        assert data["ersatztvUsers"] == []
        assert data["totals"]["liveCount"] == 0
        assert data["totals"]["ersatztvCount"] == 0

    def test_returns_live_users(
        self,
        client: TestClient,
        admin_token_payload: TokenPayload,
    ) -> None:
        """Should return live users in response."""
        # Add a live user
        presence.track_user(
            connection_id="conn1",
            username="viewer1",
            view="live",
        )
        presence.update_user_channel("conn1", "BBC One")

        with patch("app.routers.auth_deps.verify_token") as mock_verify:
            mock_verify.return_value = admin_token_payload
            response = client.get(
                "/api/admin/active-users",
                headers={"Authorization": "Bearer fake_token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["liveUsers"]) == 1
        assert data["liveUsers"][0]["username"] == "viewer1"
        assert data["liveUsers"][0]["channel"] == "BBC One"
        assert data["totals"]["liveCount"] == 1

    def test_returns_ersatztv_users(
        self,
        client: TestClient,
        admin_token_payload: TokenPayload,
    ) -> None:
        """Should return ersatztv users in response."""
        # Add an ersatztv user
        presence.track_user(
            connection_id="conn1",
            username="moviefan",
            view="ersatztv",
        )
        presence.update_user_channel("conn1", "Action Movies")

        with patch("app.routers.auth_deps.verify_token") as mock_verify:
            mock_verify.return_value = admin_token_payload
            response = client.get(
                "/api/admin/active-users",
                headers={"Authorization": "Bearer fake_token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert len(data["ersatztvUsers"]) == 1
        assert data["ersatztvUsers"][0]["username"] == "moviefan"
        assert data["ersatztvUsers"][0]["channel"] == "Action Movies"
        assert data["totals"]["ersatztvCount"] == 1

    def test_calculates_total_counts(
        self,
        client: TestClient,
        admin_token_payload: TokenPayload,
    ) -> None:
        """Should calculate total counts from users."""
        # Add users of both types with channels selected
        presence.track_user(
            connection_id="conn1",
            username="viewer1",
            view="live",
        )
        presence.update_user_channel("conn1", "BBC One")
        presence.track_user(
            connection_id="conn2",
            username="viewer2",
            view="live",
        )
        presence.update_user_channel("conn2", "ITV")
        presence.track_user(
            connection_id="conn3",
            username="moviefan",
            view="ersatztv",
        )
        presence.update_user_channel("conn3", "Action Movies")

        with patch("app.routers.auth_deps.verify_token") as mock_verify:
            mock_verify.return_value = admin_token_payload
            response = client.get(
                "/api/admin/active-users",
                headers={"Authorization": "Bearer fake_token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["totals"]["liveCount"] == 2
        assert data["totals"]["ersatztvCount"] == 1

    def test_response_includes_connected_since(
        self,
        client: TestClient,
        admin_token_payload: TokenPayload,
    ) -> None:
        """Should include connectedSince in response."""
        presence.track_user(
            connection_id="conn1",
            username="viewer1",
            view="live",
        )

        with patch("app.routers.auth_deps.verify_token") as mock_verify:
            mock_verify.return_value = admin_token_payload
            response = client.get(
                "/api/admin/active-users",
                headers={"Authorization": "Bearer fake_token"},
            )

        assert response.status_code == 200
        data = response.json()
        assert "connectedSince" in data["liveUsers"][0]

    def test_marks_only_live_slot_followers_on_live(
        self,
        client: TestClient,
        admin_token_payload: TokenPayload,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A personal pick of the live channel, or another channel, is not on Live."""
        live = Channel(
            id="uuid-rds", name="RDS", streamUrl="https://streams.example/rds", guideId="1"
        )
        monkeypatch.setattr(channel_state, "_current_channel", live)
        presence.track_user(connection_id="conn1", username="follower", view="live")
        presence.update_user_channel("conn1", "RDS", None, "live", "uuid-rds", on_live=True)
        presence.track_user(connection_id="conn2", username="elsewhere", view="live")
        presence.update_user_channel("conn2", "TVA", None, "live", "uuid-tva", on_live=False)
        presence.track_user(connection_id="conn3", username="picker", view="live")
        presence.update_user_channel("conn3", "RDS", None, "live", "uuid-rds", on_live=False)

        with patch("app.routers.auth_deps.verify_token") as mock_verify:
            mock_verify.return_value = admin_token_payload
            response = client.get(
                "/api/admin/active-users",
                headers={"Authorization": "Bearer fake_token"},
            )

        users = {u["username"]: u for u in response.json()["liveUsers"]}
        assert {name: u["onLive"] for name, u in users.items()} == {
            "follower": True,
            "elsewhere": False,
            "picker": False,
        }
        assert users["elsewhere"]["channelId"] == "uuid-tva"

    def test_client_without_on_live_falls_back_to_the_live_channel_id(
        self,
        client: TestClient,
        admin_token_payload: TokenPayload,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """A pre-R2 bundle sends no onLive: being on the live channel's id counts."""
        live = Channel(
            id="uuid-rds", name="RDS", streamUrl="https://streams.example/rds", guideId="1"
        )
        monkeypatch.setattr(channel_state, "_current_channel", live)
        presence.track_user(connection_id="conn1", username="old-on-live", view="live")
        presence.update_user_channel("conn1", "RDS", None, "live", "uuid-rds")
        presence.track_user(connection_id="conn2", username="old-elsewhere", view="live")
        presence.update_user_channel("conn2", "TVA", None, "live", "uuid-tva")
        presence.track_user(connection_id="conn3", username="idle", view="live")

        with patch("app.routers.auth_deps.verify_token") as mock_verify:
            mock_verify.return_value = admin_token_payload
            response = client.get(
                "/api/admin/active-users",
                headers={"Authorization": "Bearer fake_token"},
            )

        users = {u["username"]: u["onLive"] for u in response.json()["liveUsers"]}
        assert users == {"old-on-live": True, "old-elsewhere": False, "idle": False}


class TestGetSystemStatus:
    """Tests for GET /api/admin/status endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Should return 401 without token."""
        response = client.get("/api/admin/status")
        assert response.status_code == 401

    def test_requires_admin_role(
        self,
        client: TestClient,
        viewer_token_payload: TokenPayload,
    ) -> None:
        """Should return 403 for non-admin users."""
        with patch("app.routers.auth_deps.verify_token") as mock_verify:
            mock_verify.return_value = viewer_token_payload
            response = client.get(
                "/api/admin/status",
                headers={"Authorization": "Bearer fake_token"},
            )
        assert response.status_code == 403

    def test_returns_status_for_both_services(
        self,
        client: TestClient,
        admin_token_payload: TokenPayload,
    ) -> None:
        """Should return status for ErsatzTV and Dispatcharr."""
        now = datetime.now(UTC)
        mock_status = SystemStatusResponse(
            ersatztv=ErsatzTVStatus(
                name="ErsatzTV",
                online=True,
                last_checked=now,
                active_sessions=2,
                sessions=[],
            ),
            dispatcharr=DispatchrrStatus(
                name="Dispatcharr",
                online=True,
                last_checked=now,
                active_streams=5,
                total_viewers=10,
            ),
            epg=EPGHealthStatus(
                name="Guide data (XMLTV)",
                online=True,
                last_checked=now,
                channel_count=109,
                programme_count=5065,
                last_success_at=now,
            ),
            ersatztv_guide=EPGHealthStatus(
                name="ErsatzTV guide (XMLTV)",
                online=True,
                last_checked=now,
                channel_count=12,
                programme_count=340,
            ),
        )

        with patch("app.routers.auth_deps.verify_token") as mock_verify:
            mock_verify.return_value = admin_token_payload
            with patch(
                "app.services.status_service.get_system_status", new_callable=AsyncMock
            ) as mock_get_status:
                mock_get_status.return_value = mock_status
                response = client.get(
                    "/api/admin/status",
                    headers={"Authorization": "Bearer fake_token"},
                )

        assert response.status_code == 200
        data = response.json()
        assert data["ersatztv"]["name"] == "ErsatzTV"
        assert data["ersatztv"]["online"] is True
        assert data["ersatztv"]["activeSessions"] == 2
        assert data["dispatcharr"]["name"] == "Dispatcharr"
        assert data["dispatcharr"]["online"] is True
        assert data["dispatcharr"]["activeStreams"] == 5
        assert data["dispatcharr"]["totalViewers"] == 10
        assert data["epg"]["online"] is True
        assert data["epg"]["stale"] is False
        assert data["epg"]["channelCount"] == 109
        assert data["epg"]["programmeCount"] == 5065
        assert data["epg"]["lastSuccessAt"] is not None
        assert data["epg"]["nextRetryAt"] is None
        assert data["ersatztvGuide"]["name"] == "ErsatzTV guide (XMLTV)"
        assert data["ersatztvGuide"]["programmeCount"] == 340

    def test_returns_offline_status_for_unreachable_service(
        self,
        client: TestClient,
        admin_token_payload: TokenPayload,
    ) -> None:
        """Should return offline status with error for unreachable service."""
        now = datetime.now(UTC)
        mock_status = SystemStatusResponse(
            ersatztv=ErsatzTVStatus(
                name="ErsatzTV",
                online=False,
                last_checked=now,
                error="Connection refused",
            ),
            dispatcharr=DispatchrrStatus(
                name="Dispatcharr",
                online=True,
                last_checked=now,
                active_streams=0,
                total_viewers=0,
            ),
            epg=EPGHealthStatus(
                name="Guide data (XMLTV)",
                online=False,
                last_checked=now,
                error="HTTP 403",
                next_retry_at=now,
            ),
            ersatztv_guide=EPGHealthStatus(
                name="ErsatzTV guide (XMLTV)", online=False, last_checked=now
            ),
        )

        with patch("app.routers.auth_deps.verify_token") as mock_verify:
            mock_verify.return_value = admin_token_payload
            with patch(
                "app.services.status_service.get_system_status", new_callable=AsyncMock
            ) as mock_get_status:
                mock_get_status.return_value = mock_status
                response = client.get(
                    "/api/admin/status",
                    headers={"Authorization": "Bearer fake_token"},
                )

        assert response.status_code == 200
        data = response.json()
        assert data["ersatztv"]["online"] is False
        assert data["ersatztv"]["error"] == "Connection refused"
        assert data["dispatcharr"]["online"] is True
        assert data["epg"]["online"] is False
        assert data["epg"]["error"] == "HTTP 403"
        assert data["epg"]["nextRetryAt"] is not None


def _depends_on(dependant: Dependant, call: object) -> bool:
    """Whether call appears anywhere in the dependant's dependency tree."""
    return any(d.call is call or _depends_on(d, call) for d in dependant.dependencies)


def _guarded_routes() -> list[RouteContext]:
    # app.routes holds included routers unexpanded; iter_route_contexts flattens them
    return [
        route
        for route in iter_route_contexts(app.routes)
        if isinstance(route.original_route, APIRoute)
        and route.path is not None
        and route.methods is not None
        and (
            route.path.startswith("/api/admin")
            or (route.path.startswith("/api/settings") and route.methods - {"GET", "HEAD"})
        )
    ]


def test_route_inventory_finds_the_admin_routes() -> None:
    """The inventory below is not vacuous: it sees the known admin routes."""
    paths = {route.path for route in _guarded_routes()}
    assert {"/api/admin/chat-history", "/api/admin/status", "/api/settings"} <= paths


@pytest.mark.parametrize(
    "route", _guarded_routes(), ids=lambda r: f"{','.join(sorted(r.methods))} {r.path}"
)
def test_every_admin_route_requires_admin(route: RouteContext) -> None:
    """Every /api/admin route and every settings write depends on require_admin."""
    assert _depends_on(route.dependant, require_admin)


class TestClearChatHistory:
    """Tests for DELETE /api/admin/chat-history endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """No token gets 401 and the history stays."""
        chat.add_message("viewer", "keep me")

        response = client.delete("/api/admin/chat-history")

        assert response.status_code == 401
        assert chat.get_history_count() == 1

    def test_viewer_cannot_clear_chat_history(self, client: TestClient) -> None:
        """A viewer token gets 403 and the history stays."""
        chat.add_message("viewer", "keep me")
        token = create_access_token({"sub": "viewer", "role": "viewer"})

        response = client.delete(
            "/api/admin/chat-history", headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 403
        assert chat.get_history_count() == 1

    def test_logs_admin_chat_cleared_event(
        self,
        client: TestClient,
        admin_token_payload: TokenPayload,
    ) -> None:
        """The clear is an admin.chat_cleared event with the actor and the count."""
        chat.add_message("viewer", "one")
        chat.add_message("viewer", "two")
        records: list[Record] = []
        handler_id = logger.add(lambda message: records.append(message.record), level="INFO")
        try:
            with patch("app.routers.auth_deps.verify_token") as mock_verify:
                mock_verify.return_value = admin_token_payload
                response = client.delete(
                    "/api/admin/chat-history",
                    headers={"Authorization": "Bearer fake_token"},
                )
        finally:
            logger.remove(handler_id)

        assert response.status_code == 200
        assert chat.get_history_count() == 0
        events = [r["extra"] for r in records if r["extra"].get("event")]
        assert events == [
            {
                "router": "admin",
                "event": "admin.chat_cleared",
                "actor": "admin",
                "message_count": 2,
            }
        ]
