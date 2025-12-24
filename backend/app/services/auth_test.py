"""Tests for auth service (JWT token operations)."""

import pytest
from datetime import datetime, timezone, timedelta


def test_create_access_token_returns_string():
    """Test create_access_token returns a JWT string."""
    from app.services.auth import create_access_token

    token = create_access_token({"sub": "admin", "role": "admin"})
    assert isinstance(token, str)
    assert len(token) > 0
    # JWT has 3 parts separated by dots
    assert len(token.split(".")) == 3


def test_create_access_token_with_role():
    """Test token contains role claim."""
    from app.services.auth import create_access_token, verify_token

    token = create_access_token({"sub": "viewer", "role": "viewer"})
    payload = verify_token(token)
    assert payload.role == "viewer"


def test_verify_token_valid():
    """Test verify_token returns TokenPayload for valid token."""
    from app.services.auth import create_access_token, verify_token
    from app.models.auth import TokenPayload

    token = create_access_token({"sub": "admin", "role": "admin"})
    payload = verify_token(token)

    assert isinstance(payload, TokenPayload)
    assert payload.sub == "admin"
    assert payload.role == "admin"
    assert payload.exp > datetime.now(timezone.utc)


def test_verify_token_invalid():
    """Test verify_token raises exception for invalid token."""
    from app.services.auth import verify_token

    with pytest.raises(Exception):
        verify_token("invalid.token.here")


def test_verify_token_expired():
    """Test verify_token raises exception for expired token."""
    from jose import jwt
    from app.config import settings
    from app.services.auth import verify_token

    # Create an already-expired token
    expired_time = datetime.now(timezone.utc) - timedelta(hours=1)
    expired_token = jwt.encode(
        {"sub": "admin", "role": "admin", "exp": expired_time},
        settings.jwt_secret,
        algorithm="HS256",
    )

    with pytest.raises(Exception):
        verify_token(expired_token)


def test_token_expiration_is_7_days():
    """Test token expiration is set to 7 days from now."""
    from app.services.auth import create_access_token, verify_token

    before = datetime.now(timezone.utc)
    token = create_access_token({"sub": "admin", "role": "admin"})
    after = datetime.now(timezone.utc)

    payload = verify_token(token)

    # Expiration should be approximately 7 days from now
    expected_min = before + timedelta(days=7) - timedelta(seconds=1)
    expected_max = after + timedelta(days=7) + timedelta(seconds=1)

    assert payload.exp >= expected_min
    assert payload.exp <= expected_max
