"""Tests for auth models."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError


def test_login_request_valid():
    """Test LoginRequest with valid data."""
    from app.models.auth import LoginRequest

    request = LoginRequest(username="admin", password="secret")
    assert request.username == "admin"
    assert request.password == "secret"


def test_login_request_missing_fields():
    """Test LoginRequest requires both fields."""
    from app.models.auth import LoginRequest

    with pytest.raises(ValidationError):
        LoginRequest(username="admin")

    with pytest.raises(ValidationError):
        LoginRequest(password="secret")


def test_token_response_valid():
    """Test TokenResponse with valid data."""
    from app.models.auth import TokenResponse

    response = TokenResponse(access_token="jwt.token.here", role="admin")
    assert response.access_token == "jwt.token.here"
    assert response.token_type == "bearer"
    assert response.role == "admin"


def test_token_response_camelcase_serialization():
    """Test TokenResponse serializes to camelCase JSON."""
    from app.models.auth import TokenResponse

    response = TokenResponse(access_token="jwt.token.here", role="admin")
    data = response.model_dump(by_alias=True)
    assert "accessToken" in data
    assert "tokenType" in data
    assert data["accessToken"] == "jwt.token.here"
    assert data["tokenType"] == "bearer"


def test_token_payload_valid():
    """Test TokenPayload with valid data."""
    from app.models.auth import TokenPayload

    now = datetime.now(UTC)
    payload = TokenPayload(sub="admin", role="admin", exp=now)
    assert payload.sub == "admin"
    assert payload.role == "admin"
    assert payload.exp == now


def test_token_payload_role_values():
    """Test TokenPayload accepts admin and viewer roles."""
    from app.models.auth import TokenPayload

    now = datetime.now(UTC)

    admin = TokenPayload(sub="admin", role="admin", exp=now)
    assert admin.role == "admin"

    viewer = TokenPayload(sub="viewer", role="viewer", exp=now)
    assert viewer.role == "viewer"


def test_token_payload_plex_id_defaults_to_none():
    """Local sign-in tokens carry no Plex account id."""
    from app.models.auth import TokenPayload

    payload = TokenPayload(sub="admin", role="admin", exp=datetime.now(UTC))
    assert payload.plex_id is None


def test_token_payload_parses_plex_id():
    """A Plex sign-in token's account id is kept, not dropped."""
    from app.models.auth import TokenPayload

    payload = TokenPayload(sub="plexuser", role="viewer", exp=datetime.now(UTC), plex_id="12345")
    assert payload.plex_id == "12345"
