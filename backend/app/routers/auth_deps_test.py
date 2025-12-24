"""Tests for auth dependency functions."""

import pytest
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

from app.services.auth import create_access_token


@pytest.fixture
def app_with_protected_routes():
    """Create app with protected routes for testing dependencies."""
    from app.routers.auth import router as auth_router
    from app.routers.auth_deps import get_current_user, require_admin
    from app.models.auth import TokenPayload

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
    from datetime import datetime, timezone, timedelta
    from jose import jwt
    from app.config import settings

    client = app_with_protected_routes
    expired_time = datetime.now(timezone.utc) - timedelta(hours=1)
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
