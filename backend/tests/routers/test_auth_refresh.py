"""A-03: POST /api/auth/refresh renews a session up to a cap after the original sign-in."""

import time
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.config import settings
from app.main import app
from app.services import plex
from app.services.auth import create_access_token, verify_token

DAY = 24 * 60 * 60


def signed(claims: dict) -> str:
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256")


def refresh(token: str):
    return TestClient(app).post("/api/auth/refresh", headers={"Authorization": f"Bearer {token}"})


@pytest.fixture(autouse=True)
def local_accounts(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "local_auth_enabled", True)
    monkeypatch.setattr(settings, "admin_username", "synthetic-admin")
    monkeypatch.setattr(settings, "admin_password", "synthetic-admin-password")
    monkeypatch.setattr(settings, "viewer_username", "synthetic-viewer")
    monkeypatch.setattr(settings, "viewer_password", "synthetic-viewer-password")


def test_new_tokens_carry_the_sign_in_time():
    before = int(time.time())
    payload = verify_token(create_access_token({"sub": "synthetic-viewer", "role": "viewer"}))
    assert payload.auth_time is not None
    assert before <= payload.auth_time.timestamp() <= time.time()


def test_two_day_old_token_refreshes_to_a_later_expiry_and_keeps_auth_time():
    now = int(time.time())
    old = signed(
        {
            "sub": "synthetic-viewer",
            "role": "viewer",
            "exp": now + 5 * DAY,
            "auth_time": now - 2 * DAY,
        }
    )
    response = refresh(old)
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "viewer"
    renewed = verify_token(body["accessToken"])
    assert renewed.exp.timestamp() >= now + 7 * DAY - 5
    assert renewed.auth_time is not None
    assert renewed.auth_time.timestamp() == now - 2 * DAY
    assert renewed.plex_id is None


def test_token_past_the_cap_is_refused():
    now = int(time.time())
    capped = signed(
        {"sub": "synthetic-viewer", "role": "viewer", "exp": now + DAY, "auth_time": now - 31 * DAY}
    )
    assert refresh(capped).status_code == 401


def test_token_without_auth_time_counts_from_seven_days_before_expiry():
    now = int(time.time())
    legacy = signed({"sub": "synthetic-viewer", "role": "viewer", "exp": now + DAY})
    response = refresh(legacy)
    assert response.status_code == 200
    renewed = verify_token(response.json()["accessToken"])
    assert renewed.auth_time is not None
    assert renewed.auth_time.timestamp() == now + DAY - 7 * DAY


def test_expired_token_cannot_refresh():
    now = int(time.time())
    expired = signed(
        {"sub": "synthetic-viewer", "role": "viewer", "exp": now - 60, "auth_time": now - DAY}
    )
    assert refresh(expired).status_code == 401


def test_demoted_local_admin_comes_back_as_viewer(monkeypatch: pytest.MonkeyPatch):
    token = create_access_token({"sub": "synthetic-demoted", "role": "admin"})
    monkeypatch.setattr(settings, "viewer_username", "synthetic-demoted")
    response = refresh(token)
    assert response.status_code == 200
    assert response.json()["role"] == "viewer"
    assert verify_token(response.json()["accessToken"]).role == "viewer"


def test_local_user_without_a_current_account_is_refused(monkeypatch: pytest.MonkeyPatch):
    token = create_access_token({"sub": "synthetic-admin", "role": "admin"})
    monkeypatch.setattr(settings, "admin_password", None)
    assert refresh(token).status_code == 401


def test_demoted_plex_admin_comes_back_as_viewer(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "plex_auth_enabled", True)
    monkeypatch.setattr(settings, "plex_admin_users_str", "")
    monkeypatch.setattr(settings, "plex_default_role", "viewer")
    monkeypatch.setattr(plex, "get_server_owner_id", AsyncMock(return_value="synthetic-owner"))
    token = create_access_token({"sub": "synthetic-plex", "role": "admin", "plex_id": "4242"})
    response = refresh(token)
    assert response.status_code == 200
    assert response.json()["role"] == "viewer"
    renewed = verify_token(response.json()["accessToken"])
    assert renewed.plex_id == "4242"
    assert renewed.sub == "synthetic-plex"


def test_plex_server_owner_keeps_admin(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "plex_auth_enabled", True)
    monkeypatch.setattr(plex, "get_server_owner_id", AsyncMock(return_value="4242"))
    token = create_access_token({"sub": "synthetic-owner", "role": "admin", "plex_id": "4242"})
    response = refresh(token)
    assert response.status_code == 200
    assert response.json()["role"] == "admin"


def test_plex_admin_is_not_demoted_when_the_owner_lookup_fails(monkeypatch: pytest.MonkeyPatch):
    """A cold owner cache and a slow plex.tv answer 503, so the client keeps its admin token."""
    monkeypatch.setattr(settings, "plex_auth_enabled", True)
    monkeypatch.setattr(settings, "plex_server_token", "synthetic-server-token")
    monkeypatch.setattr(settings, "plex_admin_users_str", "")
    monkeypatch.setattr(settings, "plex_default_role", "viewer")
    monkeypatch.setattr(plex, "get_server_owner_id", AsyncMock(return_value=None))
    token = create_access_token({"sub": "synthetic-owner", "role": "admin", "plex_id": "4242"})
    response = refresh(token)
    assert response.status_code == 503


def test_plex_viewer_refreshes_while_the_owner_lookup_fails(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "plex_auth_enabled", True)
    monkeypatch.setattr(settings, "plex_server_token", "synthetic-server-token")
    monkeypatch.setattr(settings, "plex_admin_users_str", "")
    monkeypatch.setattr(settings, "plex_default_role", "viewer")
    monkeypatch.setattr(plex, "get_server_owner_id", AsyncMock(return_value=None))
    token = create_access_token({"sub": "synthetic-plex", "role": "viewer", "plex_id": "4243"})
    response = refresh(token)
    assert response.status_code == 200
    assert response.json()["role"] == "viewer"
