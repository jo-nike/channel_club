"""Integration tests for the main FastAPI app."""

from datetime import UTC
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.metadata import APP_VERSION


@pytest.fixture
def client():
    """Create test client for main app with local auth enabled."""
    # Patch settings to enable local auth for integration tests
    with patch("app.routers.auth.settings") as mock_settings:
        mock_settings.local_auth_enabled = True
        mock_settings.plex_auth_enabled = False
        mock_settings.admin_username = "admin"
        mock_settings.admin_password = "admin"
        mock_settings.viewer_username = "viewer"
        mock_settings.viewer_password = "viewer"
        yield TestClient(app)


class TestValidateAuthConfiguration:
    """Startup validation of the authentication configuration."""

    def test_refuses_to_start_when_plex_enabled_without_machine_id(self) -> None:
        """Missing machine ID makes check_server_access() admit any Plex account."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = "synthetic-test-signing-key-with-32-characters"
            mock_settings.plex_auth_enabled = True
            mock_settings.plex_server_machine_id = None
            with pytest.raises(RuntimeError, match="PLEX_SERVER_MACHINE_ID"):
                validate_auth_configuration()

    def test_starts_when_plex_enabled_with_machine_id(self) -> None:
        """A configured machine ID is the supported production setup."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = "synthetic-test-signing-key-with-32-characters"
            mock_settings.plex_auth_enabled = True
            mock_settings.plex_server_machine_id = "abc123"
            mock_settings.local_auth_enabled = False
            validate_auth_configuration()

    def test_machine_id_not_required_when_plex_disabled(self) -> None:
        """The guard must not block local-auth-only deployments."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = "synthetic-test-signing-key-with-32-characters"
            mock_settings.plex_auth_enabled = False
            mock_settings.plex_server_machine_id = None
            mock_settings.local_auth_enabled = True
            mock_settings.admin_password = "set"
            mock_settings.viewer_password = None
            validate_auth_configuration()

    def test_warns_but_starts_when_local_auth_has_no_passwords(self) -> None:
        """Unset passwords reject every login; warn rather than fail."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = "synthetic-test-signing-key-with-32-characters"
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
            mock_settings.jwt_secret = "synthetic-test-signing-key-with-32-characters"
            mock_settings.jwt_secret = "dev-secret-change-in-production"
            with pytest.raises(RuntimeError, match="known-public"):
                validate_auth_configuration()

    def test_refuses_to_start_on_env_example_jwt_secret(self) -> None:
        """The .env.example placeholder is equally public in git."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = "synthetic-test-signing-key-with-32-characters"
            mock_settings.jwt_secret = "your-secret-key-change-me"
            with pytest.raises(RuntimeError, match="known-public"):
                validate_auth_configuration()

    def test_public_jwt_secret_rejected_even_with_auth_disabled(self) -> None:
        """verify_token runs regardless of the login flags, so the guard is not
        gated on them: a forged default-secret token would authenticate even
        with local and Plex auth both off."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = "synthetic-test-signing-key-with-32-characters"
            mock_settings.jwt_secret = "dev-secret-change-in-production"
            mock_settings.local_auth_enabled = False
            mock_settings.plex_auth_enabled = False
            with pytest.raises(RuntimeError, match="known-public"):
                validate_auth_configuration()

    def test_starts_on_strong_jwt_secret(self) -> None:
        """A non-placeholder secret passes the guard."""
        from app.main import validate_auth_configuration

        with patch("app.main.settings") as mock_settings:
            mock_settings.jwt_secret = "synthetic-test-signing-key-with-32-characters"
            mock_settings.jwt_secret = "9f8c2b1a" * 8  # 64 hex chars, not public
            mock_settings.plex_auth_enabled = False
            mock_settings.plex_server_machine_id = None
            mock_settings.local_auth_enabled = True
            mock_settings.admin_password = "set"
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
        config.jwt_secret = secret
        config.local_auth_enabled = enabled
        config.plex_auth_enabled = enabled
        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            validate_auth_configuration()


def test_sec01_empty_environment_secret(monkeypatch):
    from app.config import Settings
    from app.main import validate_auth_configuration

    monkeypatch.setenv("JWT_SECRET", "")
    config = Settings(_env_file=None)
    assert config.jwt_secret == ""
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
