"""Tests for auth dependency functions."""

from datetime import UTC

import httpx
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.services import plex
from app.services.auth import create_access_token


@pytest.fixture(autouse=True)
def empty_owner_id_cache():
    """No test may see an owner id another test looked up."""
    plex.clear_server_owner_id_cache()
    yield
    plex.clear_server_owner_id_cache()


@pytest.fixture
def app_with_protected_routes():
    """Create app with protected routes for testing dependencies."""
    from app.models.auth import TokenPayload
    from app.routers.auth import router as auth_router
    from app.routers.auth_deps import get_current_user, get_current_user_or_token, require_admin

    app = FastAPI()
    app.include_router(auth_router, prefix="/api/auth")

    @app.get("/api/protected")
    async def protected_route(user: TokenPayload = Depends(get_current_user)):
        return {"user": user.sub, "role": user.role}

    @app.get("/api/media")
    async def media_route(user: TokenPayload = Depends(get_current_user_or_token)):
        return {"user": user.sub}

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

    import jwt

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


def _signed(claims: dict) -> str:
    from datetime import datetime, timedelta

    import jwt

    from app.config import settings

    claims = {"exp": datetime.now(UTC) + timedelta(hours=1), **claims}
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256")


@pytest.mark.parametrize(
    "claims",
    [
        pytest.param({"sub": "admin"}, id="no-role"),
        pytest.param({"sub": "admin", "role": "admin", "typ": "media"}, id="typ-media"),
    ],
)
def test_bad_claims_answer_401_on_header_and_query_token(app_with_protected_routes, claims):
    """A signed token that is not a valid session is a 401, never a 500."""
    client = app_with_protected_routes
    token = _signed(claims)

    header = client.get("/api/protected", headers={"Authorization": f"Bearer {token}"})
    query = client.get("/api/media", params={"token": token})
    assert header.status_code == 401
    assert query.status_code == 401
    assert query.json() == {"detail": "Invalid or expired token"}


def test_r2_token_without_typ_is_accepted(app_with_protected_routes):
    """Tokens issued before typ existed stay valid until they expire."""
    client = app_with_protected_routes
    token = _signed({"sub": "admin", "role": "admin"})

    header = client.get("/api/protected", headers={"Authorization": f"Bearer {token}"})
    query = client.get("/api/media", params={"token": token})
    assert header.status_code == 200
    assert query.status_code == 200


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
    # The owner is recognised by Plex account id, so its token carries one (A-02)
    claims = {"sub": "user", "role": "admin"}
    if grant == "plex-owner":
        auth_deps.plex._server_owner_id_cache["owner_id"] = "owner"
        claims["plex_id"] = "owner"
    user = verify_token(create_access_token(claims))
    assert await auth_deps.require_admin(user) == user
    assert await auth_deps.require_channel_control(user) == user


@pytest.fixture
def plex_owner_config(monkeypatch):
    """Plex sign-in on with the owner's server token set, as in production (A-02)."""
    from app.routers import auth_deps

    monkeypatch.setattr(auth_deps.settings, "admin_username", "local-admin")
    monkeypatch.setattr(auth_deps.settings, "plex_admin_users", ["listed-friend"])
    monkeypatch.setattr(auth_deps.settings, "plex_auth_enabled", True)
    monkeypatch.setattr(auth_deps.settings, "plex_server_token", "synthetic-server-token")
    monkeypatch.setattr(auth_deps.settings, "plex_default_role", "viewer")
    monkeypatch.setattr(auth_deps.app_settings, "user_channel_selection_enabled", lambda: False)


def _install_plex_tv(monkeypatch, respond):
    """Route the owner lookup to a fake plex.tv; returns the list of calls made."""
    calls: list[str] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return respond(request)

    factory = httpx.AsyncClient
    monkeypatch.setattr(
        plex.httpx,
        "AsyncClient",
        lambda **kwargs: factory(transport=httpx.MockTransport(upstream), **kwargs),
    )
    return calls


def _admin_status(claims: dict[str, str]) -> int:
    from app.main import app

    token = create_access_token({"role": "admin", **claims})
    client = TestClient(app)
    return client.get(
        "/api/admin/active-users", headers={"Authorization": f"Bearer {token}"}
    ).status_code


@pytest.mark.usefixtures("plex_owner_config")
@pytest.mark.parametrize(
    ("claims", "expected"),
    [
        ({"sub": "demoted-friend", "plex_id": "999"}, 403),
        ({"sub": "former-local-admin"}, 403),
        ({"sub": "local-admin", "plex_id": "999"}, 403),
        ({"sub": "server-owner", "plex_id": "owner"}, 200),
        ({"sub": "listed-friend", "plex_id": "555"}, 200),
        ({"sub": "local-admin"}, 200),
    ],
)
def test_a02_owner_clause_admits_only_the_owner(claims, expected):
    plex._server_owner_id_cache["owner_id"] = "owner"

    assert _admin_status(claims) == expected


@pytest.mark.usefixtures("plex_owner_config")
async def test_a02_demoted_admin_cannot_change_channel():
    from app.routers import auth_deps
    from app.services.auth import verify_token

    plex._server_owner_id_cache["owner_id"] = "owner"
    user = verify_token(
        create_access_token({"sub": "demoted-friend", "role": "admin", "plex_id": "999"})
    )

    with pytest.raises(auth_deps.HTTPException) as denied:
        await auth_deps.require_channel_control(user)
    assert denied.value.status_code == 403


@pytest.mark.usefixtures("plex_owner_config")
def test_a02_cold_cache_looks_the_owner_up(monkeypatch):
    calls = _install_plex_tv(monkeypatch, lambda request: httpx.Response(200, json={"id": 42}))

    assert _admin_status({"sub": "demoted-friend", "plex_id": "999"}) == 403
    assert _admin_status({"sub": "server-owner", "plex_id": "42"}) == 200
    assert calls == ["/api/v2/user"]


def _plex_tv_5xx(request: httpx.Request) -> httpx.Response:
    return httpx.Response(503)


def _plex_tv_unreachable(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("synthetic outage", request=request)


@pytest.mark.usefixtures("plex_owner_config")
@pytest.mark.parametrize("respond", [_plex_tv_5xx, _plex_tv_unreachable])
def test_a02_owner_lookup_failure_trusts_only_plex_tokens(monkeypatch, respond):
    _install_plex_tv(monkeypatch, respond)

    # plex.tv did not answer: a Plex token keeps its claim so the owner is not
    # locked out, but a token without a plex_id can never be the owner's.
    assert _admin_status({"sub": "some-plex-user", "plex_id": "999"}) == 200
    assert _admin_status({"sub": "former-local-admin"}) == 403
    assert plex._server_owner_id_cache == {}
