"""Integration tests for the main FastAPI app."""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    """Create test client for main app."""
    return TestClient(app)


def test_health_check(client):
    """Test health check endpoint."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


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
    from datetime import datetime, timezone, timedelta
    from app.services.auth import verify_token

    response = client.post(
        "/api/auth/token",
        json={"username": "admin", "password": "admin"},
    )
    token = response.json()["accessToken"]
    payload = verify_token(token)

    # Expiration should be approximately 7 days from now
    now = datetime.now(timezone.utc)
    expected = now + timedelta(days=7)
    # Allow 1 minute tolerance
    assert abs((payload.exp - expected).total_seconds()) < 60
