"""The Admin panel's server settings: masking, locks, rules, tests and the Plex link."""

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import config
from app.config import settings
from app.main import app
from app.services import app_settings, config_probes, passwords, plex, settings_store
from app.services.auth import create_access_token

ADMIN = {"Authorization": f"Bearer {create_access_token({'sub': 'admin', 'role': 'admin'})}"}
VIEWER = {"Authorization": f"Bearer {create_access_token({'sub': 'viewer', 'role': 'viewer'})}"}


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def settings_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A data directory, with only the signing key from the environment."""
    monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret"}))
    monkeypatch.setattr(settings, "state_file", str(tmp_path / "state.json"))
    settings_store.start()
    return tmp_path / "settings.json"


def _hash(password: str) -> str:
    return asyncio.run(passwords.hash_password(password))


def saved(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


# The real client class, taken before any test swaps it
REAL_CLIENT = httpx.AsyncClient


def upstream(monkeypatch: pytest.MonkeyPatch, respond) -> list[httpx.Request]:
    """Route the connection tests to a fake upstream; returns the requests made."""
    requests: list[httpx.Request] = []
    factory = REAL_CLIENT

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return respond(request)

    monkeypatch.setattr(
        config_probes.httpx,
        "AsyncClient",
        lambda **kwargs: factory(transport=httpx.MockTransport(handler), **kwargs),
    )
    return requests


class TestRead:
    def test_secrets_are_only_ever_set_or_not(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        secrets = {
            "giphy_api_key": "SYNTHETIC-GIPHY",
            "zipline_token": "SYNTHETIC-ZIPLINE",
            "ntfy_token": "SYNTHETIC-NTFY",
            "plex_server_token": "SYNTHETIC-PLEX",
            "viewer_password_hash": "scrypt$16384$8$1$SYNTHETIC$HASH",
        }
        for field, value in secrets.items():
            monkeypatch.setattr(settings, field, value)

        response = client.get("/api/admin/config", headers=ADMIN)

        assert response.status_code == 200
        body = response.text
        for value in [*secrets.values(), "synthetic-test-admin-password"]:
            assert value not in body
        values = response.json()["values"]
        assert values["giphyApiKey"] == {"set": True}
        assert values["viewerPassword"] == {"set": True}
        assert values["dispatcharrApiKey"] == {"set": False}

    def test_locks_name_the_variables_of_the_whole_group(self, client: TestClient) -> None:
        body = client.get("/api/admin/config", headers=ADMIN).json()

        # conftest: DISPATCHARR_URL came from the environment, so its key is locked too
        assert body["locked"]["dispatcharrUrl"] == ["DISPATCHARR_URL"]
        assert body["locked"]["dispatcharrApiKey"] == ["DISPATCHARR_URL"]
        assert "chatEnabled" not in body["locked"]
        assert {"env": "JWT_SECRET", "field": None, "value": None, "secret": True} in body[
            "environment"
        ]
        assert body["storage"] == {"settingsFile": None, "signingKey": "environment"}

    def test_defaults_are_the_code_defaults(self, client: TestClient) -> None:
        defaults = client.get("/api/admin/config", headers=ADMIN).json()["defaults"]

        assert defaults["mediaProcessLimit"] == 8
        assert defaults["requestBodyMaxBytes"] == 64 * 1024
        assert defaults["userChannelSelection"] is False
        assert defaults["chatEnabled"] is False
        assert defaults["nhlEnabled"] is False

    def test_viewers_are_refused(self, client: TestClient) -> None:
        assert client.get("/api/admin/config", headers=VIEWER).status_code == 403
        assert client.put("/api/admin/config", headers=VIEWER, json={}).status_code == 403


@pytest.mark.usefixtures("settings_file")
class TestUpdate:
    def test_changes_are_saved_applied_and_returned(
        self, client: TestClient, settings_file: Path
    ) -> None:
        response = client.put(
            "/api/admin/config",
            headers=ADMIN,
            json={"chatEnabled": True, "mediaProcessLimit": 3, "ntfyUrl": "HTTPS://Ntfy.Example/"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["config"]["values"]["chatEnabled"] is True
        assert body["config"]["values"]["ntfyUrl"] == "https://ntfy.example"
        assert saved(settings_file)["values"] == {
            "chat_enabled": True,
            "media_process_limit": 3,
            "ntfy_url": "https://ntfy.example",
        }
        assert settings.chat_enabled is True and settings.media_process_limit == 3

    def test_nhl_scores_are_saved_and_applied(
        self, client: TestClient, settings_file: Path
    ) -> None:
        response = client.put("/api/admin/config", headers=ADMIN, json={"nhlEnabled": True})

        assert response.status_code == 200
        assert response.json()["config"]["values"]["nhlEnabled"] is True
        assert saved(settings_file)["values"] == {"nhl_enabled": True}
        assert settings.nhl_enabled is True

    def test_nhl_enabled_from_the_environment_locks_it(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret", "nhl_enabled"}))

        assert client.get("/api/admin/config", headers=ADMIN).json()["locked"]["nhlEnabled"] == [
            "NHL_ENABLED"
        ]
        response = client.put("/api/admin/config", headers=ADMIN, json={"nhlEnabled": True})
        assert response.status_code == 409
        assert response.json()["detail"]["env"] == ["NHL_ENABLED"]

    def test_a_password_is_saved_as_a_hash(self, client: TestClient, settings_file: Path) -> None:
        response = client.put(
            "/api/admin/config", headers=ADMIN, json={"viewerPassword": "synthetic-guest-pass"}
        )

        assert response.json()["config"]["values"]["viewerPassword"] == {"set": True}
        assert saved(settings_file)["values"]["viewer_password_hash"].startswith("scrypt$")
        assert "synthetic-guest-pass" not in settings_file.read_text()
        guest = {"username": "viewer", "password": "synthetic-guest-pass"}
        assert client.post("/api/auth/token", json=guest).json()["role"] == "viewer"

    def test_null_removes_a_secret(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "giphy_api_key", SecretStr("synthetic-giphy"))

        client.put("/api/admin/config", headers=ADMIN, json={"giphyApiKey": None})

        assert settings.giphy_api_key is None

    def test_null_is_refused_for_anything_else(self, client: TestClient) -> None:
        response = client.put("/api/admin/config", headers=ADMIN, json={"chatEnabled": None})

        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body", "chatEnabled"]

    def test_a_locked_setting_is_refused_with_its_variable(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret", "zipline_url"}))

        response = client.put("/api/admin/config", headers=ADMIN, json={"ziplineToken": "x" * 8})

        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["code"] == "locked"
        assert detail["field"] == "ziplineToken" and detail["env"] == ["ZIPLINE_URL"]

    def test_an_invalid_batch_applies_nothing(
        self, client: TestClient, settings_file: Path
    ) -> None:
        response = client.put(
            "/api/admin/config", headers=ADMIN, json={"chatEnabled": True, "mediaProcessLimit": 0}
        )

        assert response.status_code == 422
        assert settings.chat_enabled is False
        assert not settings_file.exists()

    @pytest.mark.parametrize(
        ("patch", "field", "code"),
        [
            ({"plexAuthEnabled": True}, "plexAuthEnabled", "plex_not_linked"),
            (
                {"viewerUsername": "admin", "viewerPassword": "synthetic-guest-pass"},
                "viewerUsername",
                "username_taken",
            ),
            (
                {"highlightBufferSeconds": 20, "highlightSegmentSeconds": 30},
                "highlightSegmentSeconds",
                "segment_too_long",
            ),
            ({"dispatcharrUrl": "ftp://dispatcharr.example"}, "dispatcharrUrl", "value_error"),
            ({"ntfyTopic": "no spaces"}, "ntfyTopic", "value_error"),
            ({"plexDefaultRole": "owner"}, "plexDefaultRole", "literal_error"),
            ({"requestBodyMaxBytes": 1024}, "requestBodyMaxBytes", "greater_than_equal"),
        ],
    )
    def test_rules_across_settings(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
        patch: dict[str, object],
        field: str,
        code: str,
    ) -> None:
        monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret"}))

        response = client.put("/api/admin/config", headers=ADMIN, json=patch)

        assert response.status_code == 422
        (error,) = response.json()["detail"]
        assert (error["loc"], error["type"]) == (["body", field], code)

    def test_a_conflict_from_the_environment_does_not_block_other_changes(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "viewer_username", settings.admin_username)
        monkeypatch.setattr(settings, "viewer_password", SecretStr("synthetic-guest-pass"))
        monkeypatch.setattr(settings, "highlight_buffer_seconds", 5)

        response = client.put("/api/admin/config", headers=ADMIN, json={"chatEnabled": True})

        assert response.status_code == 200

    def test_a_saved_secret_only_goes_to_the_same_origin(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "ntfy_url", "https://ntfy.example")
        monkeypatch.setattr(settings, "ntfy_token", SecretStr("synthetic-ntfy-token"))

        moved = client.put(
            "/api/admin/config", headers=ADMIN, json={"ntfyUrl": "https://elsewhere.example"}
        )
        assert moved.status_code == 422
        assert moved.json()["detail"][0]["loc"] == ["body", "ntfyToken"]

        same_origin = client.put(
            "/api/admin/config", headers=ADMIN, json={"ntfyUrl": "https://ntfy.example/sub"}
        )
        assert same_origin.status_code == 200
        cleared = client.put("/api/admin/config", headers=ADMIN, json={"ntfyUrl": ""})
        assert cleared.status_code == 200

    def test_the_requesting_admin_cannot_switch_off_their_own_sign_in(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # An admin whose password was set in the app, not in the environment
        monkeypatch.setattr(settings, "admin_password", None)
        monkeypatch.setattr(settings, "admin_password_hash", _hash("synthetic-admin-pass"))
        for patch in ({"localAuthEnabled": False}, {"adminPassword": None}, {"adminUsername": "x"}):
            response = client.put("/api/admin/config", headers=ADMIN, json=patch)
            assert response.status_code == 409, patch
            assert response.json()["detail"]["code"] == "self_lockout"

    @pytest.mark.parametrize(
        ("admin_ids", "default_role", "patch", "owner_id", "legacy_names", "refused"),
        [
            # Unticking themselves, their one grant
            (["42"], "viewer", {"plexAdminIds": ["77"]}, "1001", "", True),
            # Every member an admin no more, when that was their grant
            ([], "admin", {"plexDefaultRole": "viewer"}, "1001", "", True),
            # Ticked still, whatever else changes
            (["42"], "viewer", {"plexAdminIds": ["42", "77"]}, "1001", "", False),
            # Every member an admin now
            (["42"], "viewer", {"plexAdminIds": [], "plexDefaultRole": "admin"}, "1001", "", False),
            # The owner is an admin ticked or not
            (["42"], "viewer", {"plexAdminIds": []}, "42", "", False),
            # plex.tv not answering: the owner can't be ruled out, as for sign-in
            (["42"], "viewer", {"plexAdminIds": []}, None, "", False),
            # Named in the environment's PLEX_ADMIN_USERS_STR
            (["42"], "viewer", {"plexAdminIds": []}, "1001", "sam", False),
        ],
    )
    def test_a_plex_admin_cannot_take_away_their_own_admin_rights(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
        admin_ids: list[str],
        default_role: str,
        patch: dict[str, Any],
        owner_id: str | None,
        legacy_names: str,
        refused: bool,
    ) -> None:
        monkeypatch.setattr(settings, "plex_auth_enabled", True)
        monkeypatch.setattr(settings, "plex_server_machine_id", "machine-1")
        monkeypatch.setattr(settings, "plex_server_token", SecretStr("synthetic-owner-token"))
        monkeypatch.setattr(settings, "plex_default_role", default_role)
        monkeypatch.setattr(settings, "plex_admin_ids", admin_ids)
        monkeypatch.setattr(settings, "plex_admin_users_str", legacy_names)

        async def owner() -> str | None:
            return owner_id

        monkeypatch.setattr(plex, "get_server_owner_id", owner)
        token = create_access_token({"sub": "sam", "role": "admin", "plex_id": "42"})

        response = client.put(
            "/api/admin/config", headers={"Authorization": f"Bearer {token}"}, json=patch
        )

        if refused:
            assert response.status_code == 409
            assert response.json()["detail"]["code"] == "self_lockout"
            assert (settings.plex_admin_ids, settings.plex_default_role) == (
                admin_ids,
                default_role,
            )
        else:
            assert response.status_code == 200, response.text

    def test_house_rules_go_through_app_settings(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        updates: list[dict[str, object]] = []
        update = app_settings.update

        async def recording(**kwargs: object):
            updates.append(kwargs)
            return await update(**kwargs)  # pyright: ignore[reportArgumentType]

        monkeypatch.setattr(app_settings, "update", recording)

        response = client.put(
            "/api/admin/config", headers=ADMIN, json={"userChannelSelection": True}
        )

        assert response.json()["config"]["values"]["userChannelSelection"] is True
        assert updates == [
            {"user_channel_selection": True, "presence_visible": None, "user": "admin"}
        ]
        assert app_settings.user_channel_selection_enabled() is True

    def test_warnings_say_what_is_saved_but_not_working(self, client: TestClient) -> None:
        response = client.put(
            "/api/admin/config",
            headers=ADMIN,
            json={
                "ziplineEnabled": True,
                "ziplineUrl": "https://zipline.example",
                "ziplineToken": "synthetic-token",
            },
        )

        assert [w["code"] for w in response.json()["warnings"]] == ["zipline_unavailable"]


def test_nothing_is_saved_without_a_state_file(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret"}))

    response = client.put("/api/admin/config", headers=ADMIN, json={"chatEnabled": True})

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "no_storage"


@pytest.mark.usefixtures("settings_file")
class TestConnectionTests:
    def test_dispatcharr_counts_channels_and_their_groups(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/channels/groups/":
                return httpx.Response(200, json=[{"id": 1}, {"id": 2}, {"id": 3}])
            return httpx.Response(
                200,
                json=[{"channel_group_id": 1}, {"channel_group_id": 1}, {"channel_group_id": 2}],
            )

        requests = upstream(monkeypatch, respond)

        response = client.post(
            "/api/admin/config/test",
            headers=ADMIN,
            json={
                "kind": "dispatcharr",
                "values": {"dispatcharrUrl": "http://d.test:9191", "dispatcharrApiKey": "k"},
            },
        )

        assert response.json() == {
            "ok": True,
            "reason": None,
            "counts": {"channels": 3, "groups": 2, "guideDays": None, "username": None},
        }
        assert {r.headers["authorization"] for r in requests} == {"ApiKey k"}

    @pytest.mark.parametrize(
        ("response", "reason"),
        [
            (httpx.Response(401), "auth"),
            (httpx.Response(404), "not_found"),
            (httpx.Response(500, text="SYNTHETIC-UPSTREAM-TEXT"), "http"),
            (httpx.Response(200, text="<html>SYNTHETIC-UPSTREAM-TEXT</html>"), "invalid"),
        ],
    )
    def test_a_failure_is_a_reason_never_the_upstream_body(
        self,
        client: TestClient,
        monkeypatch: pytest.MonkeyPatch,
        response: httpx.Response,
        reason: str,
    ) -> None:
        upstream(monkeypatch, lambda request: response)

        result = client.post(
            "/api/admin/config/test",
            headers=ADMIN,
            json={
                "kind": "zipline",
                "values": {"ziplineUrl": "http://z.test", "ziplineToken": "t"},
            },
        )

        assert result.status_code == 200
        assert result.json()["ok"] is False and result.json()["reason"] == reason
        assert "SYNTHETIC-UPSTREAM-TEXT" not in result.text

    def test_redirects_are_not_followed(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        requests = upstream(
            monkeypatch,
            lambda request: httpx.Response(302, headers={"Location": "http://internal.test/"}),
        )

        result = client.post(
            "/api/admin/config/test",
            headers=ADMIN,
            json={"kind": "ersatztv", "values": {"ersatztvBaseUrl": "http://e.test:8409"}},
        )

        assert result.json()["reason"] == "http"
        assert {request.url.host for request in requests} == {"e.test"}

    def test_unreachable_and_slow_upstreams(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused", request=request)

        upstream(monkeypatch, refuse)
        body = {"kind": "giphy", "values": {"giphyApiKey": "k"}}
        assert (
            client.post("/api/admin/config/test", headers=ADMIN, json=body).json()["reason"]
            == "unreachable"
        )

        def slow(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("slow", request=request)

        upstream(monkeypatch, slow)
        assert (
            client.post("/api/admin/config/test", headers=ADMIN, json=body).json()["reason"]
            == "timeout"
        )

    def test_ersatztv_counts_channels_and_guide_days(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from datetime import UTC, datetime, timedelta

        stop = (datetime.now(UTC) + timedelta(days=2, hours=3)).strftime("%Y%m%d%H%M%S +0000")

        def respond(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith(".m3u"):
                return httpx.Response(200, text="#EXTM3U\n#EXTINF:-1,One\nu1\n#EXTINF:-1,Two\nu2\n")
            return httpx.Response(200, text=f'<tv><programme stop="{stop}" start="x"/></tv>')

        upstream(monkeypatch, respond)

        result = client.post(
            "/api/admin/config/test",
            headers=ADMIN,
            json={"kind": "ersatztv", "values": {"ersatztvBaseUrl": "http://e.test:8409"}},
        ).json()

        assert result["ok"] is True
        assert (result["counts"]["channels"], result["counts"]["guideDays"]) == (2, 2)

    def test_zipline_reports_the_account(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        upstream(
            monkeypatch,
            lambda request: httpx.Response(200, json={"user": {"username": "channel-club"}}),
        )

        result = client.post(
            "/api/admin/config/test",
            headers=ADMIN,
            json={
                "kind": "zipline",
                "values": {"ziplineUrl": "http://z.test", "ziplineToken": "t"},
            },
        ).json()

        assert result["counts"]["username"] == "channel-club"

    def test_ntfy_sends_one_notification_then_cools_down(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        requests = upstream(monkeypatch, lambda request: httpx.Response(200, json={"id": "x"}))
        body = {
            "kind": "ntfy",
            "values": {"ntfyUrl": "https://ntfy.test", "ntfyTopic": "club", "ntfyToken": "tk"},
        }

        first = client.post("/api/admin/config/test", headers=ADMIN, json=body)
        second = client.post("/api/admin/config/test", headers=ADMIN, json=body)

        assert first.json()["ok"] is True
        assert second.status_code == 429
        (sent,) = requests
        assert (sent.method, sent.url.path) == ("POST", "/club")
        assert sent.headers["authorization"] == "Bearer tk"

    def test_a_saved_key_is_not_sent_to_a_new_origin(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "zipline_url", "https://zipline.example")
        monkeypatch.setattr(settings, "zipline_token", SecretStr("synthetic-saved-token"))
        requests = upstream(monkeypatch, lambda request: httpx.Response(200, json={}))

        response = client.post(
            "/api/admin/config/test",
            headers=ADMIN,
            json={"kind": "zipline", "values": {"ziplineUrl": "https://attacker.example"}},
        )

        assert response.status_code == 422
        assert response.json()["detail"][0]["loc"] == ["body", "ziplineToken"]
        assert requests == []

    def test_the_saved_values_are_used_when_left_out(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "zipline_url", "https://zipline.example")
        monkeypatch.setattr(settings, "zipline_token", SecretStr("synthetic-saved-token"))
        requests = upstream(
            monkeypatch, lambda request: httpx.Response(200, json={"user": {"username": "u"}})
        )

        client.post("/api/admin/config/test", headers=ADMIN, json={"kind": "zipline"})

        (sent,) = requests
        assert str(sent.url) == "https://zipline.example/api/user"
        assert sent.headers["authorization"] == "synthetic-saved-token"


def install_plex_tv(monkeypatch: pytest.MonkeyPatch, respond) -> None:
    factory = httpx.AsyncClient
    monkeypatch.setattr(
        plex.httpx,
        "AsyncClient",
        lambda **kwargs: factory(transport=httpx.MockTransport(respond), **kwargs),
    )


def plex_tv(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/api/v2/user":
        return httpx.Response(200, json={"id": 1001, "username": "owner"})
    if request.url.path == "/api/v2/resources":
        return httpx.Response(
            200,
            json=[
                {"name": "Home", "clientIdentifier": "a1b2c3", "provides": "server", "owned": True}
            ],
        )
    return httpx.Response(
        200,
        text=(
            '<MediaContainer><User id="11" username="sam"><Server machineIdentifier="a1b2c3"/>'
            '</User><User id="12" username="leo"><Server machineIdentifier="a1b2c3"/></User>'
            "</MediaContainer>"
        ),
    )


class TestPlex:
    def test_members_are_admin_only(self, client: TestClient) -> None:
        assert client.get("/api/admin/plex/members", headers=VIEWER).status_code == 403

    def test_members_are_marked_with_who_is_an_admin(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        install_plex_tv(monkeypatch, plex_tv)
        monkeypatch.setattr(settings, "plex_server_token", SecretStr("synthetic-token"))
        monkeypatch.setattr(settings, "plex_server_machine_id", "a1b2c3")
        monkeypatch.setattr(settings, "plex_admin_ids", ["12"])

        members = client.get("/api/admin/plex/members", headers=ADMIN).json()

        assert [(m["username"], m["owner"], m["admin"]) for m in members] == [
            ("owner", True, True),
            ("sam", False, False),
            ("leo", False, True),
        ]

    def test_members_need_a_linked_server(self, client: TestClient) -> None:
        response = client.get("/api/admin/plex/members", headers=ADMIN)

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "plex_not_linked"

    def test_linking_a_server_you_own(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, settings_file: Path
    ) -> None:
        install_plex_tv(monkeypatch, plex_tv)

        response = client.post(
            "/api/admin/plex/server",
            headers=ADMIN,
            json={"authToken": "synthetic-token", "machineId": "a1b2c3"},
        )

        assert response.status_code == 200
        assert response.json()["config"]["plexServerName"] == "Home"
        assert saved(settings_file)["values"] == {
            "plex_admin_ids": ["1001"],
            "plex_server_machine_id": "a1b2c3",
            "plex_server_token": "synthetic-token",
        }
        # Now Plex sign-in can be switched on
        switched = client.put("/api/admin/config", headers=ADMIN, json={"plexAuthEnabled": True})
        assert switched.status_code == 200

    def test_linking_a_server_you_do_not_own_is_refused(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch, settings_file: Path
    ) -> None:
        install_plex_tv(monkeypatch, plex_tv)

        response = client.post(
            "/api/admin/plex/server",
            headers=ADMIN,
            json={"authToken": "synthetic-token", "machineId": "f00"},
        )

        assert response.status_code == 403
        assert not settings_file.exists()
