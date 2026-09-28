"""POST /api/auth/plex against a fake plex.tv: outages answer 503, not 401/403/500 (A-04)."""

from collections.abc import Callable
from typing import Any
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.auth import router
from app.services import plex

Responder = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    """Plex sign-in enabled, one configured server, no owner lookup."""
    monkeypatch.setattr(plex.settings, "plex_server_machine_id", "my-server-abc")
    monkeypatch.setattr(plex.settings, "plex_server_token", None)
    monkeypatch.setattr(plex.settings, "plex_admin_users_str", "")
    monkeypatch.setattr(plex.settings, "plex_default_role", "viewer")
    plex.clear_server_owner_id_cache()
    with patch("app.routers.auth.settings") as mock_settings:
        mock_settings.plex_auth_enabled = True
        app = FastAPI()
        app.include_router(router, prefix="/api/auth")
        yield TestClient(app)
    plex.clear_server_owner_id_cache()


def _install_plex_tv(monkeypatch: pytest.MonkeyPatch, respond: Responder) -> None:
    """Route every plex.tv client the service opens to a MockTransport."""
    factory = httpx.AsyncClient

    def make_client(**kwargs: Any) -> httpx.AsyncClient:
        return factory(transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr(plex.httpx, "AsyncClient", make_client)


def _plex_tv(user: httpx.Response, resources: httpx.Response) -> Responder:
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v2/user":
            return user
        if request.url.path == "/api/v2/resources":
            return resources
        raise AssertionError(f"unexpected plex.tv call {request.url}")

    return respond


def _good_user() -> httpx.Response:
    return httpx.Response(200, json={"id": 12345, "username": "plexuser"})


def _good_resources() -> httpx.Response:
    return httpx.Response(200, json=[{"clientIdentifier": "my-server-abc"}])


def _sign_in(client: TestClient) -> httpx.Response:
    return client.post("/api/auth/plex", json={"authToken": "synthetic-user-token"})


def test_connect_timeout_answers_503(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    _install_plex_tv(monkeypatch, timeout)

    response = _sign_in(client)

    assert response.status_code == 503
    assert response.json()["detail"] == "Plex is not responding, try again shortly"


def test_503_from_user_answers_503(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _install_plex_tv(monkeypatch, _plex_tv(httpx.Response(503), _good_resources()))

    assert _sign_in(client).status_code == 503


def test_503_from_resources_answers_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_plex_tv(monkeypatch, _plex_tv(_good_user(), httpx.Response(503)))

    assert _sign_in(client).status_code == 503


def test_html_page_from_resources_answers_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    maintenance = httpx.Response(200, text="<html>Down for maintenance</html>")
    _install_plex_tv(monkeypatch, _plex_tv(_good_user(), maintenance))

    assert _sign_in(client).status_code == 503


def test_real_401_from_user_still_answers_401(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _install_plex_tv(monkeypatch, _plex_tv(httpx.Response(401), _good_resources()))

    response = _sign_in(client)

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired Plex token"


def test_resources_without_the_server_still_answers_403(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = httpx.Response(200, json=[{"clientIdentifier": "other-server"}])
    _install_plex_tv(monkeypatch, _plex_tv(_good_user(), other))

    assert _sign_in(client).status_code == 403


def test_failed_owner_lookup_does_not_block_sign_in(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(plex.settings, "plex_server_token", "synthetic-server-token")
    user_side = _plex_tv(_good_user(), _good_resources())

    def respond(request: httpx.Request) -> httpx.Response:
        if request.headers["X-Plex-Token"] == "synthetic-server-token":
            return httpx.Response(503)
        return user_side(request)

    _install_plex_tv(monkeypatch, respond)

    response = _sign_in(client)

    assert response.status_code == 200
    assert response.json()["role"] == "viewer"
    assert plex._server_owner_id_cache == {}
