"""Integration tests for the main FastAPI app."""

from datetime import UTC
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


@pytest.fixture
def client():
    """Create test client for main app with local auth enabled."""
    # Patch settings to enable local auth for integration tests
    with patch("app.routers.auth.settings") as mock_settings:
        mock_settings.local_auth_enabled = True
        mock_settings.plex_auth_enabled = False
        mock_settings.admin_username = "admin"
        mock_settings.admin_password = "admin"
        mock_settings.viewer_username = "viewer"
        mock_settings.viewer_password = "viewer"
        yield TestClient(app)


def test_health_check(client):
    """Test health check endpoint."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": settings.app_version}


def test_health_check_reports_build_version(client):
    """Health should report the injected build version so CI can gate on it."""
    with patch("app.main.settings.app_version", "2026.08.14-abc1234"):
        response = client.get("/api/health")
    assert response.json()["version"] == "2026.08.14-abc1234"


def test_auth_token_endpoint_registered(client):
    """Test auth router is registered at /api/auth/token."""
    response = client.post(
        "/api/auth/token",
        json={"username": "admin", "password": "admin"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "accessToken" in data


def test_auth_invalid_credentials(client):
    """Test invalid credentials return 401."""
    response = client.post(
        "/api/auth/token",
        json={"username": "wrong", "password": "wrong"},
    )
    assert response.status_code == 401


def test_token_verifies_correctly(client):
    """Test token returned can be verified."""
    from app.services.auth import verify_token

    # Get token
    response = client.post(
        "/api/auth/token",
        json={"username": "viewer", "password": "viewer"},
    )
    token = response.json()["accessToken"]

    # Verify it
    payload = verify_token(token)
    assert payload.sub == "viewer"
    assert payload.role == "viewer"


def test_token_expiration_is_7_days(client):
    """Test token expiration is approximately 7 days."""
    from datetime import datetime, timedelta

    from app.services.auth import verify_token

    response = client.post(
        "/api/auth/token",
        json={"username": "admin", "password": "admin"},
    )
    token = response.json()["accessToken"]
    payload = verify_token(token)

    # Expiration should be approximately 7 days from now
    now = datetime.now(UTC)
    expected = now + timedelta(days=7)
    # Allow 1 minute tolerance
    assert abs((payload.exp - expected).total_seconds()) < 60
