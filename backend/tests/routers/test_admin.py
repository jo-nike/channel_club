"""Tests for admin router."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.auth import TokenPayload
from app.models.status import (
    DispatchrrStatus,
    EPGHealthStatus,
    ErsatzTVStatus,
    SystemStatusResponse,
)
from app.services import presence


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
