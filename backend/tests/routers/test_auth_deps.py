"""Tests for auth dependency functions."""

from datetime import UTC

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.services.auth import create_access_token


@pytest.fixture
def app_with_protected_routes():
    """Create app with protected routes for testing dependencies."""
    from app.models.auth import TokenPayload
    from app.routers.auth import router as auth_router
    from app.routers.auth_deps import get_current_user, require_admin

    app = FastAPI()
    app.include_router(auth_router, prefix="/api/auth")

    @app.get("/api/protected")
    async def protected_route(user: TokenPayload = Depends(get_current_user)):
        return {"user": user.sub, "role": user.role}

    @app.get("/api/admin-only")
    async def admin_only_route(user: TokenPayload = Depends(require_admin)):
        return {"message": "admin access granted", "user": user.sub}

    return TestClient(app)


def test_get_current_user_valid_token(app_with_protected_routes):
    """Test get_current_user accepts valid token."""
    client = app_with_protected_routes
    token = create_access_token({"sub": "admin", "role": "admin"})

    response = client.get(
        "/api/protected",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["user"] == "admin"
    assert data["role"] == "admin"


def test_get_current_user_invalid_token(app_with_protected_routes):
    """Test get_current_user rejects invalid token."""
    client = app_with_protected_routes

    response = client.get(
        "/api/protected",
        headers={"Authorization": "Bearer invalid.token.here"},
    )
    assert response.status_code == 401


def test_get_current_user_missing_token(app_with_protected_routes):
    """Test get_current_user rejects missing token."""
    client = app_with_protected_routes

    response = client.get("/api/protected")
    # HTTPBearer returns 401 or 403 depending on version
    assert response.status_code in (401, 403)


def test_get_current_user_expired_token(app_with_protected_routes):
    """Test get_current_user rejects expired token."""
    from datetime import datetime, timedelta

    from jose import jwt

    from app.config import settings

    client = app_with_protected_routes
    expired_time = datetime.now(UTC) - timedelta(hours=1)
    expired_token = jwt.encode(
        {"sub": "admin", "role": "admin", "exp": expired_time},
        settings.jwt_secret,
        algorithm="HS256",
    )

    response = client.get(
        "/api/protected",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert response.status_code == 401


def test_require_admin_with_admin_role(app_with_protected_routes):
    """Test require_admin allows admin role."""
    client = app_with_protected_routes
    token = create_access_token({"sub": "admin", "role": "admin"})

    response = client.get(
        "/api/admin-only",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "admin access granted"


def test_require_admin_with_viewer_role(app_with_protected_routes):
    """Test require_admin rejects viewer role."""
    client = app_with_protected_routes
    token = create_access_token({"sub": "viewer", "role": "viewer"})

    response = client.get(
        "/api/admin-only",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
    data = response.json()
    assert data["detail"] == "Admin access required"


@pytest.mark.parametrize("viewer_selection", [False, True])
def test_sec04_demoted_admin_obeys_viewer_channel_policy(monkeypatch, viewer_selection):
    from app.main import app
    from app.routers import auth_deps

    monkeypatch.setattr(auth_deps.settings, "admin_username", "current-admin")
    monkeypatch.setattr(auth_deps.settings, "plex_admin_users", [])
    monkeypatch.setattr(auth_deps.settings, "plex_auth_enabled", False)
    monkeypatch.setattr(
        auth_deps.app_settings, "user_channel_selection_enabled", lambda: viewer_selection
    )
    token = create_access_token({"sub": "former-admin", "role": "admin"})
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/admin/active-users", headers=headers).status_code == 403
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.models.channel import Channel
    from app.routers import channels

    channel = Channel(
        id="synthetic", name="Synthetic", stream_url="http://synthetic/stream", guide_id="synthetic"
    )
    monkeypatch.setattr(
        channels, "resolve_media_channel", AsyncMock(return_value=SimpleNamespace(channel=channel))
    )
    monkeypatch.setattr(
        channels.channel_state, "set_current_channel", AsyncMock(return_value=channel)
    )
    response = client.put(
        "/api/channels/current", headers=headers, json=channel.model_dump(by_alias=True)
    )
    assert response.status_code == (200 if viewer_selection else 403)


@pytest.mark.parametrize("grant", ["local", "plex-list", "plex-owner", "plex-default"])
async def test_sec04_current_admin_grants_control(monkeypatch, grant):
    from app.routers import auth_deps
    from app.services.auth import verify_token

    monkeypatch.setattr(
        auth_deps.settings, "admin_username", "user" if grant == "local" else "other"
    )
    monkeypatch.setattr(
        auth_deps.settings, "plex_admin_users", ["user"] if grant == "plex-list" else []
    )
    monkeypatch.setattr(auth_deps.settings, "plex_auth_enabled", grant.startswith("plex"))
    monkeypatch.setattr(
        auth_deps.settings, "plex_server_token", "synthetic" if grant == "plex-owner" else ""
    )
    monkeypatch.setattr(
        auth_deps.settings, "plex_default_role", "admin" if grant == "plex-default" else "viewer"
    )
    monkeypatch.setattr(auth_deps.app_settings, "user_channel_selection_enabled", lambda: False)
    user = verify_token(create_access_token({"sub": "user", "role": "admin"}))
    assert await auth_deps.require_admin(user) == user
    assert await auth_deps.require_channel_control(user) == user
