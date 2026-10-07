"""First-run setup: the claim, its races and refusals, and finishing setup."""

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config
from app.config import settings
from app.main import app
from app.services import plex, settings_store
from app.services.auth import create_access_token, verify_token

PASS = "synthetic-pass-123"
PASSWORD = {"method": "password", "username": "synthetic-admin", "password": PASS}
OWNER = {"id": 1001, "username": "synthetic-owner", "email": "owner@example.com"}
SERVER = {
    "name": "Home Server",
    "clientIdentifier": "a1b2c3",
    "provides": "server",
    "owned": True,
    "presence": True,
    "accessToken": "SYNTHETIC-SERVER-ACCESS-TOKEN",
}
PLEX = {"method": "plex", "authToken": "synthetic-plex-token", "machineId": "a1b2c3"}


@pytest.fixture
def settings_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A fresh container: a data directory, and nothing about sign-in in the environment."""
    monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret"}))
    monkeypatch.setattr(settings, "state_file", str(tmp_path / "state.json"))
    monkeypatch.setattr(settings, "local_auth_enabled", False)
    monkeypatch.setattr(settings, "admin_password", None)
    settings_store.start()
    return tmp_path / "settings.json"


@pytest.fixture
def client(settings_file: Path) -> TestClient:
    return TestClient(app)


@pytest.fixture
def plex_tv(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """plex.tv with one owner and one owned server; returns the paths called."""
    calls: list[str] = []
    factory = httpx.AsyncClient

    def respond(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.headers.get("x-plex-token") != "synthetic-plex-token":
            return httpx.Response(401)
        if request.url.path == "/api/v2/user":
            return httpx.Response(200, json=OWNER)
        if request.url.path == "/api/v2/resources":
            return httpx.Response(200, json=[SERVER])
        if request.url.path == "/api/users":
            return httpx.Response(200, text="<MediaContainer/>")
        return httpx.Response(404)

    monkeypatch.setattr(
        plex.httpx,
        "AsyncClient",
        lambda **kwargs: factory(transport=httpx.MockTransport(respond), **kwargs),
    )
    return calls


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def saved(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


class TestStatus:
    def test_lists_environment_names_while_unclaimed(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        env = {"jwt_secret", "dispatcharr_url", "log_format", "app_build_id", "state_file"}
        monkeypatch.setattr(config, "ENV_FIELDS", frozenset(env))

        body = client.get("/api/setup/status").json()

        assert body == {
            "setupState": "unclaimed",
            "envLocked": [
                {"env": "DISPATCHARR_URL", "field": "dispatcharrUrl"},
                {"env": "JWT_SECRET", "field": None},
                {"env": "LOG_FORMAT", "field": None},
            ],
        }

    def test_lists_nothing_once_claimed(self, client: TestClient) -> None:
        assert client.post("/api/setup/account", json=PASSWORD).status_code == 200

        body = client.get("/api/setup/status").json()

        assert body == {"setupState": "claimed", "envLocked": []}


class TestPasswordClaim:
    def test_the_first_visitor_becomes_the_admin(
        self, client: TestClient, settings_file: Path
    ) -> None:
        response = client.post("/api/setup/account", json=PASSWORD)

        assert response.status_code == 200
        token = verify_token(response.json()["accessToken"])
        assert (token.sub, token.role, token.plex_id) == ("synthetic-admin", "admin", None)
        document = saved(settings_file)
        assert document["setup"]["claimedBy"] == "synthetic-admin"
        assert document["values"]["local_auth_enabled"] is True
        assert document["values"]["admin_username"] == "synthetic-admin"
        # Only a hash of the password is kept
        assert document["values"]["admin_password_hash"].startswith("scrypt$")
        assert PASS not in settings_file.read_text()
        assert settings_store.setup_state() == "claimed"
        # The token works for the rest of the wizard, and the password signs in
        assert client.get("/api/admin/active-users", headers=bearer(token_of(response))).is_success
        sign_in = client.post(
            "/api/auth/token",
            json={"username": "synthetic-admin", "password": PASS},
        )
        assert sign_in.json()["role"] == "admin"

    def test_a_short_password_is_refused(self, client: TestClient) -> None:
        response = client.post("/api/setup/account", json={**PASSWORD, "password": "short"})

        assert response.status_code == 422
        assert settings_store.setup_state() == "unclaimed"

    def test_two_racing_claims_make_exactly_one_admin(self, settings_file: Path) -> None:
        async def race() -> list[int]:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
                first = {**PASSWORD, "username": "first-admin"}
                second = {**PASSWORD, "username": "second-admin"}
                responses = await asyncio.gather(
                    http.post("/api/setup/account", json=first),
                    http.post("/api/setup/account", json=second),
                )
            return sorted(response.status_code for response in responses)

        assert asyncio.run(race()) == [200, 409]
        assert saved(settings_file)["values"]["admin_username"] in {"first-admin", "second-admin"}
        assert saved(settings_file)["setup"]["claimedBy"] == settings.admin_username

    def test_a_failed_write_is_a_500_and_setup_stays_open(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def fail(path: Path, document: dict[str, Any]) -> None:
            raise OSError("read-only file system")

        monkeypatch.setattr(settings_store, "write_json_atomic", fail)

        response = client.post("/api/setup/account", json=PASSWORD)

        assert response.status_code == 500
        assert response.json()["detail"]["code"] == "write_failed"
        assert settings_store.setup_state() == "unclaimed"
        assert settings.local_auth_enabled is False

    @pytest.mark.parametrize("content_type", ["text/plain", None])
    def test_a_claim_that_is_not_json_is_refused(
        self, client: TestClient, content_type: str | None
    ) -> None:
        """Another site can only post text/plain without a preflight: that must not claim."""
        headers = {"Content-Type": content_type} if content_type else {}

        response = client.post("/api/setup/account", content=json.dumps(PASSWORD), headers=headers)

        assert response.status_code == 422
        assert settings_store.setup_state() == "unclaimed"

    def test_a_second_claim_is_refused(self, client: TestClient) -> None:
        assert client.post("/api/setup/account", json=PASSWORD).status_code == 200

        response = client.post("/api/setup/account", json={**PASSWORD, "username": "late"})

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "already_claimed"

    def test_sign_in_from_the_environment_cannot_be_claimed(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret", "plex_auth_enabled"}))

        response = client.post("/api/setup/account", json=PASSWORD)

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "env_managed"

    def test_a_stale_token_is_ignored_while_unclaimed(
        self, client: TestClient, plex_tv: list[str]
    ) -> None:
        response = client.post(
            "/api/setup/plex/servers",
            json={"authToken": "synthetic-plex-token"},
            headers=bearer("not-a-token-from-this-install"),
        )

        assert response.status_code == 200


def token_of(response: Any) -> str:
    """The session token from a sign-in or claim response (TestClient's own Response type)."""
    return response.json()["accessToken"]


class TestPlexClaim:
    def test_servers_are_listed_without_signing_in(
        self, client: TestClient, plex_tv: list[str]
    ) -> None:
        response = client.post(
            "/api/setup/plex/servers", json={"authToken": "synthetic-plex-token"}
        )

        assert response.status_code == 200
        assert response.json() == {
            "account": {"username": "synthetic-owner"},
            "servers": [
                {
                    "machineId": "a1b2c3",
                    "name": "Home Server",
                    "online": True,
                    "lastSeenAt": None,
                    "memberCount": 0,
                }
            ],
        }

    def test_a_rejected_plex_token_is_a_400_not_a_401(
        self, client: TestClient, plex_tv: list[str]
    ) -> None:
        """A 401 would make the browser sign itself out."""
        response = client.post("/api/setup/plex/servers", json={"authToken": "expired"})

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "plex_token"

    def test_claiming_an_owned_server(
        self, client: TestClient, plex_tv: list[str], settings_file: Path
    ) -> None:
        response = client.post("/api/setup/account", json=PLEX)

        assert response.status_code == 200
        token = verify_token(token_of(response))
        assert (token.sub, token.role, token.plex_id) == ("synthetic-owner", "admin", "1001")
        document = saved(settings_file)
        assert document["plexServerName"] == "Home Server"
        assert document["values"] == {
            "plex_auth_enabled": True,
            "plex_server_machine_id": "a1b2c3",
            "plex_server_token": "synthetic-plex-token",
            "plex_admin_ids": ["1001"],
        }
        assert settings.plex_auth_enabled is True
        assert settings.plex_admin_ids == ["1001"]
        # The claim doesn't need the member list
        assert "/api/users" not in plex_tv

    def test_claiming_a_server_you_do_not_own_is_refused(
        self, client: TestClient, plex_tv: list[str]
    ) -> None:
        response = client.post("/api/setup/account", json={**PLEX, "machineId": "f00"})

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "not_owner"
        assert settings_store.setup_state() == "unclaimed"

    def test_plex_calls_are_rate_limited_while_unclaimed(
        self, client: TestClient, plex_tv: list[str]
    ) -> None:
        body = {"authToken": "synthetic-plex-token"}
        statuses = [
            client.post("/api/setup/plex/servers", json=body).status_code for _ in range(11)
        ]

        assert statuses == [200] * 10 + [429]

    def test_after_the_claim_only_an_admin_lists_servers(
        self, client: TestClient, plex_tv: list[str]
    ) -> None:
        admin = token_of(client.post("/api/setup/account", json=PLEX))
        viewer = create_access_token({"sub": "someone", "role": "viewer", "plex_id": "7"})
        body = {"authToken": "synthetic-plex-token"}

        assert client.post("/api/setup/plex/servers", json=body).status_code == 401
        assert (
            client.post("/api/setup/plex/servers", json=body, headers=bearer(viewer)).status_code
            == 403
        )
        assert (
            client.post("/api/setup/plex/servers", json=body, headers=bearer(admin)).status_code
            == 200
        )


class TestWhileClaimed:
    @pytest.fixture(autouse=True)
    def claimed(self, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> str:
        admin = token_of(client.post("/api/setup/account", json=PASSWORD))
        monkeypatch.setattr(settings, "viewer_password", "synthetic-guest-pass")
        return admin

    def test_viewers_cannot_sign_in_or_refresh_yet(self, client: TestClient) -> None:
        guest = {"username": "viewer", "password": "synthetic-guest-pass"}
        response = client.post("/api/auth/token", json=guest)
        assert response.status_code == 403
        assert response.json()["detail"] == "Channel Club is still being set up"

        viewer = create_access_token({"sub": "viewer", "role": "viewer"})
        assert client.post("/api/auth/refresh", headers=bearer(viewer)).status_code == 403

    def test_the_admin_can_sign_in_and_refresh(self, client: TestClient, claimed: str) -> None:
        admin = {"username": "synthetic-admin", "password": PASS}
        assert client.post("/api/auth/token", json=admin).status_code == 200
        assert client.post("/api/auth/refresh", headers=bearer(claimed)).status_code == 200

    def test_finishing_is_admin_only(self, client: TestClient) -> None:
        viewer = create_access_token({"sub": "viewer", "role": "viewer"})

        assert client.post("/api/setup/complete").status_code in (401, 403)
        assert client.post("/api/setup/complete", headers=bearer(viewer)).status_code == 403
        assert settings_store.setup_state() == "claimed"

    def test_finishing_opens_the_club(
        self, client: TestClient, claimed: str, settings_file: Path
    ) -> None:
        response = client.post("/api/setup/complete", headers=bearer(claimed))

        assert response.status_code == 200
        assert response.json() == {
            "dispatcharrChannels": None,
            "ersatztvChannels": None,
            "plexServerName": None,
            "features": {
                "chat": False,
                "gifs": False,
                "clips": False,
                "feedback": False,
            },
        }
        assert settings_store.setup_state() == "complete"
        assert saved(settings_file)["setup"]["completedAt"] is not None
        guest = {"username": "viewer", "password": "synthetic-guest-pass"}
        assert client.post("/api/auth/token", json=guest).status_code == 200
        # Finishing again changes nothing, and nobody can claim any more
        assert client.post("/api/setup/complete", headers=bearer(claimed)).status_code == 200
        assert client.post("/api/setup/account", json=PASSWORD).status_code == 409


@pytest.fixture(autouse=True)
def no_sources(monkeypatch: pytest.MonkeyPatch) -> None:
    """No source URLs, so finishing doesn't try to count channels."""
    monkeypatch.setattr(settings, "dispatcharr_url", "")
    monkeypatch.setattr(settings, "ersatztv_base_url", "")
