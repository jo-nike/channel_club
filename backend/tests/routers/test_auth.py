"""Tests for auth router endpoints."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create test client with auth router."""
    from fastapi import FastAPI

    from app.routers.auth import router

    app = FastAPI()
    app.include_router(router, prefix="/api/auth")
    return TestClient(app)


def test_login_admin_success(client):
    """Test successful admin login returns JWT token."""
    response = client.post(
        "/api/auth/token",
        json={"username": "admin", "password": "admin"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "accessToken" in data
    assert data["tokenType"] == "bearer"
    assert data["role"] == "admin"


def test_login_viewer_success(client):
    """Test successful viewer login returns JWT token."""
    response = client.post(
        "/api/auth/token",
        json={"username": "viewer", "password": "viewer"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "accessToken" in data
    assert data["tokenType"] == "bearer"
    assert data["role"] == "viewer"


def test_login_invalid_credentials(client):
    """Test invalid credentials returns 401."""
    response = client.post(
        "/api/auth/token",
        json={"username": "wrong", "password": "wrong"},
    )
    assert response.status_code == 401
    data = response.json()
    assert data["detail"] == "Invalid credentials"


def test_login_missing_password(client):
    """Test missing password returns validation error."""
    response = client.post(
        "/api/auth/token",
        json={"username": "admin"},
    )
    assert response.status_code == 422  # Validation error


def test_login_missing_username(client):
    """Test missing username returns validation error."""
    response = client.post(
        "/api/auth/token",
        json={"password": "admin"},
    )
    assert response.status_code == 422  # Validation error


def test_login_token_is_valid_jwt(client):
    """Test returned token is a valid JWT."""
    response = client.post(
        "/api/auth/token",
        json={"username": "admin", "password": "admin"},
    )
    data = response.json()
    token = data["accessToken"]

    # JWT has 3 parts
    parts = token.split(".")
    assert len(parts) == 3


def test_login_token_contains_correct_claims(client):
    """Test token contains expected claims."""
    from app.services.auth import verify_token

    response = client.post(
        "/api/auth/token",
        json={"username": "admin", "password": "admin"},
    )
    data = response.json()
    token = data["accessToken"]

    payload = verify_token(token)
    assert payload.sub == "admin"
    assert payload.role == "admin"
