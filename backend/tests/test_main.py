"""Integration tests for the main FastAPI app."""

import asyncio
import json
import os
import subprocess
import sys
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from io import StringIO
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from loguru import logger
from pydantic import SecretStr

from app.config import settings
from app.main import app
from app.metadata import APP_VERSION
from app.services import epg_service
from app.services.auth import create_access_token
from app.services.http_clients import DISPATCHARR, ERSATZTV
from tests.http_helpers import mock_upstream


@pytest.fixture
def client():
    """Create test client for main app with local auth enabled."""
    # Patch settings to enable local auth for integration tests
    with patch("app.routers.auth.settings") as mock_settings:
        mock_settings.local_auth_enabled = True
        mock_settings.plex_auth_enabled = False
        mock_settings.admin_username = "admin"
        mock_settings.admin_password = SecretStr("admin")
        mock_settings.viewer_username = "viewer"
        mock_settings.viewer_password = SecretStr("viewer")
        yield TestClient(app)


class TestValidateAuthConfiguration:
    """Startup validation of the authentication configuration."""

    def test_refuses_to_start_when_plex_enabled_without_machine_id(self) -> None:
        """Missing machine ID makes check_server_access() admit any Plex account."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = SecretStr("synthetic-test-signing-key-with-32-characters")
            mock_settings.plex_auth_enabled = True
            mock_settings.plex_server_machine_id = None
            with pytest.raises(RuntimeError, match="PLEX_SERVER_MACHINE_ID"):
                validate_auth_configuration()

    def test_starts_when_plex_enabled_with_machine_id(self) -> None:
        """A configured machine ID is the supported production setup."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = SecretStr("synthetic-test-signing-key-with-32-characters")
            mock_settings.plex_auth_enabled = True
            mock_settings.plex_server_machine_id = "abc123"
            mock_settings.local_auth_enabled = False
            validate_auth_configuration()

    def test_machine_id_not_required_when_plex_disabled(self) -> None:
        """The guard must not block local-auth-only deployments."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = SecretStr("synthetic-test-signing-key-with-32-characters")
            mock_settings.plex_auth_enabled = False
            mock_settings.plex_server_machine_id = None
            mock_settings.local_auth_enabled = True
            mock_settings.admin_password = SecretStr("set")
            mock_settings.viewer_password = None
            validate_auth_configuration()

    def test_warns_but_starts_when_local_auth_has_no_passwords(self) -> None:
        """Unset passwords reject every login; warn rather than fail."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = SecretStr("synthetic-test-signing-key-with-32-characters")
            mock_settings.plex_auth_enabled = False
            mock_settings.plex_server_machine_id = None
            mock_settings.local_auth_enabled = True
            mock_settings.admin_password = None
            mock_settings.viewer_password = None
            validate_auth_configuration()

    def test_refuses_to_start_on_default_jwt_secret(self) -> None:
        """The source-public dev secret lets anyone forge an admin token."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = SecretStr("synthetic-test-signing-key-with-32-characters")
            mock_settings.jwt_secret = SecretStr("dev-secret-change-in-production")
            with pytest.raises(RuntimeError, match="known-public"):
                validate_auth_configuration()

    def test_refuses_to_start_on_env_example_jwt_secret(self) -> None:
        """The .env.example placeholder is equally public in git."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = SecretStr("synthetic-test-signing-key-with-32-characters")
            mock_settings.jwt_secret = SecretStr("your-secret-key-change-me")
            with pytest.raises(RuntimeError, match="known-public"):
                validate_auth_configuration()

    def test_public_jwt_secret_rejected_even_with_auth_disabled(self) -> None:
        """verify_token runs regardless of the login flags, so the guard is not
        gated on them: a forged default-secret token would authenticate even
        with local and Plex auth both off."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = SecretStr("synthetic-test-signing-key-with-32-characters")
            mock_settings.jwt_secret = SecretStr("dev-secret-change-in-production")
            mock_settings.local_auth_enabled = False
            mock_settings.plex_auth_enabled = False
            with pytest.raises(RuntimeError, match="known-public"):
                validate_auth_configuration()

    def test_starts_on_strong_jwt_secret(self) -> None:
        """A non-placeholder secret passes the guard."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = SecretStr("synthetic-test-signing-key-with-32-characters")
            mock_settings.jwt_secret = SecretStr("9f8c2b1a" * 8)  # 64 hex chars, not public
            mock_settings.plex_auth_enabled = False
            mock_settings.plex_server_machine_id = None
            mock_settings.local_auth_enabled = True
            mock_settings.admin_password = SecretStr("set")
            mock_settings.viewer_password = None
            validate_auth_configuration()


def test_health_check(client):
    """Test health check endpoint."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "version": APP_VERSION,
        "buildId": settings.app_build_id,
        "revision": settings.app_revision,
    }


def test_health_check_reports_build_version(client):
    """Health should report the injected build version so CI can gate on it."""
    with patch("app.main.settings.app_build_id", "1.0.0-build-abc1234-unique"):
        response = client.get("/api/health")
    assert response.json()["version"] == APP_VERSION
    assert response.json()["buildId"] == "1.0.0-build-abc1234-unique"


def test_startup_logs_a_server_start_event() -> None:
    """The first startup line is a server.start event, so the dashboard can mark deploys."""
    output = StringIO()
    handler_id = logger.add(output, format="{message}", serialize=True, level="INFO")
    try:
        with (
            patch("app.main.settings.app_build_id", "1.2.0-build-abc1234"),
            patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
            TestClient(app),
        ):
            pass
    finally:
        logger.remove(handler_id)

    extras = [json.loads(line)["record"]["extra"] for line in output.getvalue().splitlines()]
    (start,) = [e for e in extras if e.get("event") == "server.start"]
    assert start["version"] == APP_VERSION and start["build_id"] == "1.2.0-build-abc1234"
    assert start["log_level"] == settings.log_level
    assert start["log_format"] == settings.log_format


@pytest.mark.parametrize("key", ["STREAM_BASE_URL", "VITE_WS_URL"])
def test_startup_warns_about_obsolete_variables(monkeypatch, key) -> None:
    """A removed variable left in the environment is named, not silently ignored."""
    monkeypatch.setenv(key, "anything")
    output = StringIO()
    handler_id = logger.add(output, format="{level} | {message}", level="WARNING")
    try:
        with (
            patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
            TestClient(app),
        ):
            pass
    finally:
        logger.remove(handler_id)

    warnings = [line for line in output.getvalue().splitlines() if "no longer read" in line]
    assert len(warnings) == 1 and warnings[0].startswith(f"WARNING | {key} is no longer read: ")


@pytest.mark.parametrize(
    ("field", "warning"),
    [
        ("dispatcharr_url", "DISPATCHARR_URL is not set, so Dispatcharr channels are unavailable"),
        ("ersatztv_base_url", "ERSATZTV_BASE_URL is not set, so ErsatzTV channels are unavailable"),
    ],
)
def test_startup_warns_about_an_unset_source(monkeypatch, field, warning) -> None:
    """No source URL has a default, so a missing one is named at startup."""
    monkeypatch.setattr(settings, field, "")
    output = StringIO()
    handler_id = logger.add(output, format="{level} | {message}", level="WARNING")
    try:
        with (
            patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
            TestClient(app),
        ):
            pass
    finally:
        logger.remove(handler_id)

    unset = [line for line in output.getvalue().splitlines() if "is not set, so" in line]
    assert unset == [f"WARNING | {warning}"]


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
    from datetime import datetime, timedelta

    from app.services.auth import verify_token

    response = client.post(
        "/api/auth/token",
        json={"username": "admin", "password": "admin"},
    )
    token = response.json()["accessToken"]
    payload = verify_token(token)

    # Expiration should be approximately 7 days from now
    now = datetime.now(UTC)
    expected = now + timedelta(days=7)
    # Allow 1 minute tolerance
    assert abs((payload.exp - expected).total_seconds()) < 60


@pytest.mark.parametrize("secret", ["", " " * 64, "short", "x" * 31])
@pytest.mark.parametrize("enabled", [True, False])
def test_sec01_rejects_unusable_signing_keys(secret, enabled):
    from app.main import validate_auth_configuration

    with patch("app.main.settings") as config:
        config.jwt_secret = SecretStr(secret)
        config.local_auth_enabled = enabled
        config.plex_auth_enabled = enabled
        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            validate_auth_configuration()


def test_sec01_empty_environment_secret(monkeypatch):
    from app.config import Settings
    from app.main import validate_auth_configuration

    monkeypatch.setenv("JWT_SECRET", "")
    # _env_file is a pydantic-settings init option that pyright doesn't see on Settings
    config = Settings(_env_file=None)  # pyright: ignore[reportCallIssue]
    assert config.jwt_secret.get_secret_value() == ""
    with patch("app.main.settings", config), pytest.raises(RuntimeError, match="JWT_SECRET"):
        validate_auth_configuration()


PREFLIGHT = {"Origin": "http://localhost:5173", "Access-Control-Request-Method": "PUT"}


@pytest.fixture
def reloaded_main(monkeypatch):
    """Rebuild app.main under patched settings; restore the default app afterwards."""
    import importlib

    import app.main as main

    def rebuild(**overrides):
        for name, value in overrides.items():
            monkeypatch.setattr(settings, name, value)
        return importlib.reload(main).app

    yield rebuild
    monkeypatch.undo()
    importlib.reload(main)


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_api_docs_are_off_by_default(client, path):
    assert client.get(path).status_code == 404


def test_no_cors_middleware_by_default(client):
    response = client.options("/api/settings", headers=PREFLIGHT)
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_api_docs_served_when_enabled(reloaded_main, path):
    assert TestClient(reloaded_main(docs_enabled=True)).get(path).status_code == 200


def test_cors_origins_setting_allows_listed_origin_only(reloaded_main):
    client = TestClient(reloaded_main(cors_origins=["http://localhost:5173"]))
    allowed = client.options("/api/settings", headers=PREFLIGHT)
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    other = client.options(
        "/api/settings", headers={**PREFLIGHT, "Origin": "http://192.168.50.167:5173"}
    )
    assert "access-control-allow-origin" not in other.headers


def test_importing_the_app_routes_uvicorn_startup_lines_to_json(tmp_path: Path) -> None:
    """uvicorn logs 'Started server process' after importing the app but before
    the lifespan runs, so logging must be configured at import (H-04)."""
    probe = (
        "import logging, logging.config\n"
        "from uvicorn.config import LOGGING_CONFIG\n"
        "logging.config.dictConfig(LOGGING_CONFIG)\n"
        "import app.main\n"
        "logging.getLogger('uvicorn.error').info('startup probe line')\n"
    )
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(Path(__file__).parents[1]),
        "LOG_FORMAT": "json",
    }
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )

    lines = [line for line in result.stderr.splitlines() if "startup probe line" in line]
    # One JSON line: uvicorn.error hands its records to the root handler only
    assert len(lines) == 1
    assert json.loads(lines[0])["record"]["message"] == "startup probe line"


def _guide_xmltv() -> str:
    """A one-channel XMLTV feed with a programme on air now."""
    start = (datetime.now(UTC) - timedelta(minutes=10)).strftime("%Y%m%d%H%M%S +0000")
    stop = (datetime.now(UTC) + timedelta(minutes=50)).strftime("%Y%m%d%H%M%S +0000")
    return (
        '<tv><channel id="ch1"><display-name>One</display-name></channel>'
        f'<programme channel="ch1" start="{start}" stop="{stop}"><title>Show</title>'
        "</programme></tv>"
    )


class TestStartupGuideWarmup:
    """The lifespan downloads the guide in the background at boot (Q-03)."""

    @staticmethod
    def _install_upstream(
        monkeypatch: pytest.MonkeyPatch, respond: Callable[[httpx.Request], httpx.Response]
    ) -> list[str]:
        fetches: list[str] = []

        async def upstream(request: httpx.Request) -> httpx.Response:
            fetches.append(request.url.path)
            # Slow enough that a refresh left to the background is still running
            # when the warm-up task finishes, however long startup takes
            await asyncio.sleep(0.2)
            return respond(request)

        mock_upstream(DISPATCHARR, upstream)
        mock_upstream(ERSATZTV, upstream)
        # A fresh singleton, restored after the test, so no guide state leaks
        monkeypatch.setattr(
            epg_service, "_epg_service", epg_service.EPGService("http://dispatcharr.test")
        )
        return fetches

    @staticmethod
    def _wait_for_warmup(client: TestClient) -> bool:
        """Await the warm-up; whether the guide was online the moment it finished."""

        async def wait() -> bool:
            await app.state.warmup_task
            # No await in between: a background-only refresh would not have run yet
            return epg_service.get_epg_service().get_health().online

        assert client.portal is not None
        return client.portal.call(wait)

    def test_boot_fetches_the_guide_once_and_serves_reads_from_it(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fetches = self._install_upstream(
            monkeypatch, lambda request: httpx.Response(200, text=_guide_xmltv())
        )
        token = create_access_token({"sub": "viewer", "role": "viewer"})

        with TestClient(app) as client:
            assert self._wait_for_warmup(client)
            assert fetches == ["/output/epg"]

            response = client.get(
                "/api/epg/now-playing/all", headers={"Authorization": f"Bearer {token}"}
            )

        assert response.status_code == 200
        assert response.json()["nowPlaying"]["ch1"]["title"] == "Show"
        assert fetches == ["/output/epg"]

    def test_failed_warmup_does_not_block_startup(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fetches = self._install_upstream(monkeypatch, lambda request: httpx.Response(503))

        with TestClient(app) as client:
            self._wait_for_warmup(client)
            response = client.get("/api/health")

        assert response.status_code == 200
        assert fetches == ["/output/epg"]


def test_lifespan_runs_the_highlight_and_cast_cleanups(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With both features on, startup sweeps stale directories and starts both idle
    cleanup tasks; shutdown stops them."""
    from app.services.cast import cast_service
    from app.services.highlight import highlight_service

    highlight_dir = tmp_path / "highlights"
    cast_dir = tmp_path / "cast"
    stale_recording = highlight_dir / "recorder-stale"
    stale_session = cast_dir / "session-stale"
    stale_recording.mkdir(parents=True)
    stale_session.mkdir(parents=True)
    monkeypatch.setattr(settings, "highlight_enabled", True)
    monkeypatch.setattr(settings, "cast_enabled", True)
    monkeypatch.setattr(settings, "highlight_temp_dir", str(highlight_dir))
    monkeypatch.setattr(settings, "cast_temp_dir", str(cast_dir))
    TestStartupGuideWarmup._install_upstream(monkeypatch, lambda request: httpx.Response(503))

    with TestClient(app) as client:
        TestStartupGuideWarmup._wait_for_warmup(client)
        tasks = [highlight_service._cleanup_task, cast_service._cleanup_task]
        assert all(task is not None and not task.done() for task in tasks)
        assert not stale_recording.exists() and not stale_session.exists()

    assert all(task is not None and task.done() for task in tasks)
    # Stopped by the shutdown teardown, not merely cancelled with the test's event loop
    assert highlight_service._cleanup_task is None
    assert cast_service._cleanup_task is None
