"""Tests for auth router endpoints."""

from io import StringIO
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from loguru import logger

from app.models.plex import PlexUser
from app.routers.auth import router
from app.services.plex import InvalidPlexTokenError


@pytest.fixture
def client_local_enabled():
    """Create test client with local auth enabled."""
    with patch("app.routers.auth.settings") as mock_settings:
        mock_settings.local_auth_enabled = True
        mock_settings.plex_auth_enabled = False
        mock_settings.admin_username = "admin"
        mock_settings.admin_password = "admin"
        mock_settings.viewer_username = "viewer"
        mock_settings.viewer_password = "viewer"

        app = FastAPI()
        app.include_router(router, prefix="/api/auth")
        yield TestClient(app)


@pytest.fixture
def client_local_disabled():
    """Create test client with local auth disabled."""
    with patch("app.routers.auth.settings") as mock_settings:
        mock_settings.local_auth_enabled = False
        mock_settings.plex_auth_enabled = True

        app = FastAPI()
        app.include_router(router, prefix="/api/auth")
        yield TestClient(app)


@pytest.fixture
def client_plex_enabled():
    """Create test client with Plex auth enabled."""
    with patch("app.routers.auth.settings") as mock_settings:
        mock_settings.local_auth_enabled = False
        mock_settings.plex_auth_enabled = True
        mock_settings.plex_default_role = "viewer"

        app = FastAPI()
        app.include_router(router, prefix="/api/auth")
        yield TestClient(app)


@pytest.fixture
def client_plex_disabled():
    """Create test client with Plex auth disabled."""
    with patch("app.routers.auth.settings") as mock_settings:
        mock_settings.local_auth_enabled = True
        mock_settings.plex_auth_enabled = False

        app = FastAPI()
        app.include_router(router, prefix="/api/auth")
        yield TestClient(app)


@pytest.fixture
def client():
    """Create test client with auth router (local auth enabled by default for legacy tests)."""
    with patch("app.routers.auth.settings") as mock_settings:
        mock_settings.local_auth_enabled = True
        mock_settings.plex_auth_enabled = False
        mock_settings.admin_username = "admin"
        mock_settings.admin_password = "admin"
        mock_settings.viewer_username = "viewer"
        mock_settings.viewer_password = "viewer"

        app = FastAPI()
        app.include_router(router, prefix="/api/auth")
        yield TestClient(app)


class TestLocalAuthFeatureFlag:
    """Tests for local auth feature flag behavior."""

    def test_local_auth_returns_404_when_disabled(self, client_local_disabled):
        """Local auth endpoint returns 404 when LOCAL_AUTH_ENABLED=false."""
        response = client_local_disabled.post(
            "/api/auth/token",
            json={"username": "admin", "password": "admin"},
        )
        assert response.status_code == 404

    def test_local_auth_works_when_enabled(self, client_local_enabled):
        """Local auth endpoint works when LOCAL_AUTH_ENABLED=true."""
        response = client_local_enabled.post(
            "/api/auth/token",
            json={"username": "admin", "password": "admin"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "accessToken" in data
        assert data["role"] == "admin"


class TestAuthConfigEndpoint:
    """Tests for GET /api/auth/config endpoint."""

    def test_auth_config_returns_correct_flags_local_only(self):
        """Auth config returns correct flags when only local auth enabled."""
        with patch("app.routers.auth.settings") as mock_settings:
            mock_settings.local_auth_enabled = True
            mock_settings.plex_auth_enabled = False

            app = FastAPI()
            app.include_router(router, prefix="/api/auth")
            client = TestClient(app)

            response = client.get("/api/auth/config")
            assert response.status_code == 200
            data = response.json()
            assert data["localAuthEnabled"] is True
            assert data["plexAuthEnabled"] is False

    def test_auth_config_returns_correct_flags_plex_only(self):
        """Auth config returns correct flags when only plex auth enabled."""
        with patch("app.routers.auth.settings") as mock_settings:
            mock_settings.local_auth_enabled = False
            mock_settings.plex_auth_enabled = True

            app = FastAPI()
            app.include_router(router, prefix="/api/auth")
            client = TestClient(app)

            response = client.get("/api/auth/config")
            assert response.status_code == 200
            data = response.json()
            assert data["localAuthEnabled"] is False
            assert data["plexAuthEnabled"] is True

    def test_auth_config_returns_correct_flags_both_enabled(self):
        """Auth config returns correct flags when both auth methods enabled."""
        with patch("app.routers.auth.settings") as mock_settings:
            mock_settings.local_auth_enabled = True
            mock_settings.plex_auth_enabled = True

            app = FastAPI()
            app.include_router(router, prefix="/api/auth")
            client = TestClient(app)

            response = client.get("/api/auth/config")
            assert response.status_code == 200
            data = response.json()
            assert data["localAuthEnabled"] is True
            assert data["plexAuthEnabled"] is True


class TestStartupValidation:
    """Tests for startup authentication validation."""

    def test_startup_logs_warning_when_no_auth_enabled(self):
        """Startup logs warning when no auth methods enabled."""
        output = StringIO()

        # Add a test handler to capture loguru output
        handler_id = logger.add(output, format="{message}", level="WARNING")

        try:
            with patch("app.main.settings") as mock_settings:
                mock_settings.local_auth_enabled = False
                mock_settings.plex_auth_enabled = False

                from app.main import validate_auth_configuration

                validate_auth_configuration()

            assert "No authentication methods enabled" in output.getvalue()
        finally:
            logger.remove(handler_id)

    def test_startup_no_warning_when_local_auth_enabled(self):
        """Startup does not warn when local auth is enabled."""
        output = StringIO()

        handler_id = logger.add(output, format="{message}", level="WARNING")

        try:
            with patch("app.main.settings") as mock_settings:
                mock_settings.local_auth_enabled = True
                mock_settings.plex_auth_enabled = False

                from app.main import validate_auth_configuration

                validate_auth_configuration()

            assert "No authentication methods enabled" not in output.getvalue()
        finally:
            logger.remove(handler_id)

    def test_startup_no_warning_when_plex_auth_enabled(self):
        """Startup does not warn when plex auth is enabled."""
        output = StringIO()

        handler_id = logger.add(output, format="{message}", level="WARNING")

        try:
            with patch("app.main.settings") as mock_settings:
                mock_settings.local_auth_enabled = False
                mock_settings.plex_auth_enabled = True

                from app.main import validate_auth_configuration

                validate_auth_configuration()

            assert "No authentication methods enabled" not in output.getvalue()
        finally:
            logger.remove(handler_id)


class TestLoginEndpoint:
    """Tests for POST /api/auth/token endpoint (when enabled)."""

    def test_login_admin_success(self, client):
        """Test successful admin login returns JWT token."""
        response = client.post(
            "/api/auth/token",
            json={"username": "admin", "password": "admin"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "accessToken" in data
        assert data["tokenType"] == "bearer"
        assert data["role"] == "admin"

    def test_login_viewer_success(self, client):
        """Test successful viewer login returns JWT token."""
        response = client.post(
            "/api/auth/token",
            json={"username": "viewer", "password": "viewer"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "accessToken" in data
        assert data["tokenType"] == "bearer"
        assert data["role"] == "viewer"

    def test_login_invalid_credentials(self, client):
        """Test invalid credentials returns 401."""
        response = client.post(
            "/api/auth/token",
            json={"username": "wrong", "password": "wrong"},
        )
        assert response.status_code == 401
        data = response.json()
        assert data["detail"] == "Invalid credentials"

    def test_login_missing_password(self, client):
        """Test missing password returns validation error."""
        response = client.post(
            "/api/auth/token",
            json={"username": "admin"},
        )
        assert response.status_code == 422  # Validation error

    def test_login_missing_username(self, client):
        """Test missing username returns validation error."""
        response = client.post(
            "/api/auth/token",
            json={"password": "admin"},
        )
        assert response.status_code == 422  # Validation error

    def test_login_token_is_valid_jwt(self, client):
        """Test returned token is a valid JWT."""
        response = client.post(
            "/api/auth/token",
            json={"username": "admin", "password": "admin"},
        )
        data = response.json()
        token = data["accessToken"]

        # JWT has 3 parts
        parts = token.split(".")
        assert len(parts) == 3

    def test_login_token_contains_correct_claims(self, client):
        """Test token contains expected claims."""
        from app.services.auth import verify_token

        response = client.post(
            "/api/auth/token",
            json={"username": "admin", "password": "admin"},
        )
        data = response.json()
        token = data["accessToken"]

        payload = verify_token(token)
        assert payload.sub == "admin"
        assert payload.role == "admin"


class TestPlexAuthEndpoint:
    """Tests for POST /api/auth/plex endpoint."""

    def test_plex_auth_returns_404_when_disabled(self, client_plex_disabled):
        """Plex endpoint returns 404 when PLEX_AUTH_ENABLED=false."""
        response = client_plex_disabled.post(
            "/api/auth/plex",
            json={"authToken": "test-token"},
        )
        assert response.status_code == 404

    def test_plex_auth_returns_401_for_invalid_token(self, client_plex_enabled):
        """Plex endpoint returns 401 for invalid token."""
        with patch(
            "app.routers.auth.validate_plex_token",
            AsyncMock(side_effect=InvalidPlexTokenError("Invalid token")),
        ):
            response = client_plex_enabled.post(
                "/api/auth/plex",
                json={"authToken": "invalid-token"},
            )
            assert response.status_code == 401
            assert "Invalid or expired Plex token" in response.json()["detail"]

    def test_plex_auth_returns_403_no_server_access(self, client_plex_enabled):
        """Plex endpoint returns 403 when user lacks server access."""
        mock_user = PlexUser(id="1", username="testuser", email="test@test.com")
        with (
            patch(
                "app.routers.auth.validate_plex_token",
                AsyncMock(return_value=mock_user),
            ),
            patch(
                "app.routers.auth.check_server_access",
                AsyncMock(return_value=False),
            ),
        ):
            response = client_plex_enabled.post(
                "/api/auth/plex",
                json={"authToken": "valid-token"},
            )
            assert response.status_code == 403
            assert "No access to Plex server" in response.json()["detail"]

    def test_plex_auth_returns_jwt_on_success(self, client_plex_enabled):
        """Plex endpoint returns JWT for valid token with server access."""
        mock_user = PlexUser(id="12345", username="plexuser", email="test@test.com")
        with (
            patch(
                "app.routers.auth.validate_plex_token",
                AsyncMock(return_value=mock_user),
            ),
            patch(
                "app.routers.auth.check_server_access",
                AsyncMock(return_value=True),
            ),
        ):
            response = client_plex_enabled.post(
                "/api/auth/plex",
                json={"authToken": "valid-token"},
            )
            assert response.status_code == 200
            data = response.json()
            assert "accessToken" in data
            assert data["role"] == "viewer"
            assert data["tokenType"] == "bearer"

    def test_plex_auth_jwt_contains_correct_claims(self, client_plex_enabled):
        """Plex auth JWT contains username, role, and plex_id claims."""
        from jose import jwt

        mock_user = PlexUser(id="12345", username="plexuser", email="test@test.com")
        with (
            patch(
                "app.routers.auth.validate_plex_token",
                AsyncMock(return_value=mock_user),
            ),
            patch(
                "app.routers.auth.check_server_access",
                AsyncMock(return_value=True),
            ),
        ):
            response = client_plex_enabled.post(
                "/api/auth/plex",
                json={"authToken": "valid-token"},
            )
            data = response.json()
            token = data["accessToken"]

            # Decode without verification to check claims
            payload = jwt.decode(token, key="", options={"verify_signature": False})
            assert payload["sub"] == "plexuser"
            assert payload["role"] == "viewer"
            assert payload["plex_id"] == "12345"

    def test_plex_auth_accepts_camelcase_auth_token(self, client_plex_enabled):
        """Plex endpoint accepts authToken in camelCase."""
        mock_user = PlexUser(id="1", username="testuser", email="test@test.com")
        with (
            patch(
                "app.routers.auth.validate_plex_token",
                AsyncMock(return_value=mock_user),
            ),
            patch(
                "app.routers.auth.check_server_access",
                AsyncMock(return_value=True),
            ),
        ):
            # Send with camelCase key
            response = client_plex_enabled.post(
                "/api/auth/plex",
                json={"authToken": "valid-token"},
            )
            assert response.status_code == 200


class TestAuthLogging:
    """Tests for auth router logging."""

    def test_login_attempt_logs_debug_with_username(self, client):
        """Login attempt logs DEBUG with username (never password)."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="DEBUG")

        try:
            client.post(
                "/api/auth/token",
                json={"username": "admin", "password": "admin"},
            )

            log_output = output.getvalue()
            assert "Login attempt" in log_output
            assert "admin" in log_output
            # Password should NEVER appear in logs
            assert "password" not in log_output.lower()
        finally:
            logger.remove(handler_id)

    def test_successful_login_logs_info_with_role(self, client):
        """Successful login logs INFO with username and role."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="INFO")

        try:
            client.post(
                "/api/auth/token",
                json={"username": "admin", "password": "admin"},
            )

            log_output = output.getvalue()
            assert "INFO" in log_output
            assert "admin" in log_output
            # Should log the role
            assert "admin" in log_output.lower()
        finally:
            logger.remove(handler_id)

    def test_failed_login_logs_warning(self, client):
        """Failed login logs WARNING with username."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="WARNING")

        try:
            client.post(
                "/api/auth/token",
                json={"username": "baduser", "password": "wrongpass"},
            )

            log_output = output.getvalue()
            assert "WARNING" in log_output
            assert "baduser" in log_output
        finally:
            logger.remove(handler_id)

    def test_auth_config_logs_debug(self, client):
        """Auth config endpoint logs DEBUG."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="DEBUG")

        try:
            client.get("/api/auth/config")

            log_output = output.getvalue()
            assert "DEBUG" in log_output
            assert "config" in log_output.lower()
        finally:
            logger.remove(handler_id)

    def test_plex_auth_success_logs_info(self, client_plex_enabled):
        """Successful Plex auth logs INFO with username."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="INFO")

        mock_user = PlexUser(id="12345", username="plexuser", email="test@test.com")
        try:
            with (
                patch(
                    "app.routers.auth.validate_plex_token",
                    AsyncMock(return_value=mock_user),
                ),
                patch(
                    "app.routers.auth.check_server_access",
                    AsyncMock(return_value=True),
                ),
            ):
                client_plex_enabled.post(
                    "/api/auth/plex",
                    json={"authToken": "valid-token"},
                )

            log_output = output.getvalue()
            assert "INFO" in log_output
            assert "plexuser" in log_output
        finally:
            logger.remove(handler_id)

    def test_plex_auth_failure_logs_warning(self, client_plex_enabled):
        """Failed Plex auth logs WARNING."""
        output = StringIO()
        handler_id = logger.add(output, format="{level} | {message}", level="WARNING")

        try:
            with patch(
                "app.routers.auth.validate_plex_token",
                AsyncMock(side_effect=InvalidPlexTokenError("Invalid token")),
            ):
                client_plex_enabled.post(
                    "/api/auth/plex",
                    json={"authToken": "invalid-token"},
                )

            log_output = output.getvalue()
            assert "WARNING" in log_output
        finally:
            logger.remove(handler_id)

    def test_auth_logging_uses_router_context(self, client):
        """Auth logging uses logger.bind(router='auth') context."""
        output = StringIO()
        handler_id = logger.add(output, format="{extra} | {message}", level="DEBUG")

        try:
            client.post(
                "/api/auth/token",
                json={"username": "admin", "password": "admin"},
            )

            log_output = output.getvalue()
            assert "router" in log_output
            assert "auth" in log_output
        finally:
            logger.remove(handler_id)
