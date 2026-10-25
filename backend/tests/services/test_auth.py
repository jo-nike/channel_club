"""Tests for auth service (JWT token operations)."""

from datetime import UTC, datetime, timedelta

import pytest


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
    from app.models.auth import TokenPayload
    from app.services.auth import create_access_token, verify_token

    token = create_access_token({"sub": "admin", "role": "admin"})
    payload = verify_token(token)

    assert isinstance(payload, TokenPayload)
    assert payload.sub == "admin"
    assert payload.role == "admin"
    assert payload.exp > datetime.now(UTC)


def test_verify_token_keeps_plex_id():
    """verify_token returns the Plex account id a Plex sign-in token carries."""
    from app.services.auth import create_access_token, verify_token

    token = create_access_token({"sub": "plexuser", "role": "viewer", "plex_id": "12345"})
    assert verify_token(token).plex_id == "12345"


def test_verify_token_invalid():
    """Test verify_token raises exception for invalid token."""
    import jwt

    from app.services.auth import verify_token

    with pytest.raises(jwt.InvalidTokenError):
        verify_token("invalid.token.here")


def test_verify_token_expired():
    """Test verify_token raises exception for expired token."""
    import jwt

    from app.config import settings
    from app.services.auth import verify_token

    # Create an already-expired token
    expired_time = datetime.now(UTC) - timedelta(hours=1)
    expired_token = jwt.encode(
        {"sub": "admin", "role": "admin", "exp": expired_time},
        settings.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )

    with pytest.raises(jwt.InvalidTokenError):
        verify_token(expired_token)


def test_token_expiration_is_7_days():
    """Test token expiration is set to 7 days from now."""
    from app.services.auth import create_access_token, verify_token

    before = datetime.now(UTC)
    token = create_access_token({"sub": "admin", "role": "admin"})
    after = datetime.now(UTC)

    payload = verify_token(token)

    # Expiration should be approximately 7 days from now
    expected_min = before + timedelta(days=7) - timedelta(seconds=1)
    expected_max = after + timedelta(days=7) + timedelta(seconds=1)

    assert payload.exp >= expected_min
    assert payload.exp <= expected_max


def _signed(claims: dict, key: str | None = None, algorithm: str = "HS256") -> str:
    import jwt

    from app.config import settings

    claims = {"exp": datetime.now(UTC) + timedelta(hours=1), **claims}
    return jwt.encode(
        claims, settings.jwt_secret.get_secret_value() if key is None else key, algorithm=algorithm
    )


@pytest.mark.parametrize(
    "claims,key,algorithm",
    [
        pytest.param({"sub": "admin"}, None, "HS256", id="no-role"),
        pytest.param({"role": "admin"}, None, "HS256", id="no-sub"),
        pytest.param({"sub": "admin", "role": "admin"}, "", "none", id="alg-none"),
        pytest.param(
            {"sub": "admin", "role": "admin"},
            None,
            "HS512",
            id="hs512",
            marks=pytest.mark.filterwarnings("ignore:The HMAC key"),
        ),
        pytest.param({"sub": "admin", "role": "admin"}, "another-key-" * 4, "HS256", id="key"),
        pytest.param({"sub": "admin", "role": "admin", "typ": "media"}, None, "HS256", id="typ"),
    ],
)
def test_verify_token_rejects_as_invalid_token(claims, key, algorithm):
    """Every bad token raises InvalidTokenError, never a ValidationError."""
    import jwt

    from app.services.auth import verify_token

    with pytest.raises(jwt.InvalidTokenError):
        verify_token(_signed(claims, key, algorithm))


def test_verify_token_rejects_token_without_exp():
    """exp is required."""
    import jwt

    from app.config import settings
    from app.services.auth import verify_token

    token = jwt.encode(
        {"sub": "admin", "role": "admin"}, settings.jwt_secret.get_secret_value(), algorithm="HS256"
    )
    with pytest.raises(jwt.InvalidTokenError):
        verify_token(token)


def test_verify_token_refuses_a_token_without_typ():
    """A token issued before typ existed (pre-R3, all expired by 6 Oct) is refused."""
    import jwt

    from app.services.auth import verify_token

    token = _signed({"sub": "viewer", "role": "viewer", "auth_time": 1_700_000_000})
    with pytest.raises(jwt.InvalidTokenError):
        verify_token(token)


def test_create_access_token_carries_session_typ_and_auth_time():
    """New tokens are session-typed, and a caller cannot change that."""
    import jwt

    from app.config import settings
    from app.services.auth import create_access_token

    token = create_access_token({"sub": "admin", "role": "admin", "typ": "media"})
    payload = jwt.decode(token, settings.jwt_secret.get_secret_value(), algorithms=["HS256"])
    assert payload["typ"] == "session"
    assert isinstance(payload["auth_time"], int)
