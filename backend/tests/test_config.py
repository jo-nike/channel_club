"""Tests for application configuration."""

from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.config import Settings


class TestAuthSettings:
    """Tests for authentication configuration settings."""

    def test_settings_has_local_auth_enabled(self) -> None:
        """Settings should have local_auth_enabled attribute."""
        settings = Settings()
        assert hasattr(settings, "local_auth_enabled")
        assert isinstance(settings.local_auth_enabled, bool)

    def test_settings_has_plex_auth_enabled(self) -> None:
        """Settings should have plex_auth_enabled attribute."""
        settings = Settings()
        assert hasattr(settings, "plex_auth_enabled")
        assert isinstance(settings.plex_auth_enabled, bool)

    def test_local_auth_disabled_by_default(self) -> None:
        """Local auth should be disabled by default when no env vars set."""
        with patch.dict("os.environ", {}, clear=True):
            # Create settings without .env file
            # _env_file is a pydantic-settings init option that pyright doesn't see on Settings
            settings = Settings(_env_file=None)  # pyright: ignore[reportCallIssue]
            assert settings.local_auth_enabled is False

    def test_plex_auth_disabled_by_default(self) -> None:
        """Plex auth should be disabled by default when no env vars set."""
        with patch.dict("os.environ", {}, clear=True):
            # Create settings without .env file
            settings = Settings(_env_file=None)  # pyright: ignore[reportCallIssue]
            assert settings.plex_auth_enabled is False

    def test_settings_has_plex_server_token(self) -> None:
        """Settings should have plex_server_token attribute."""
        with patch.dict("os.environ", {}, clear=True):
            settings = Settings(_env_file=None)  # pyright: ignore[reportCallIssue]
            assert hasattr(settings, "plex_server_token")
            # Should be None by default
            assert settings.plex_server_token is None

    def test_settings_has_plex_server_machine_id(self) -> None:
        """Settings should have plex_server_machine_id attribute."""
        with patch.dict("os.environ", {}, clear=True):
            settings = Settings(_env_file=None)  # pyright: ignore[reportCallIssue]
            assert hasattr(settings, "plex_server_machine_id")
            # Should be None by default
            assert settings.plex_server_machine_id is None

    def test_settings_has_plex_default_role(self) -> None:
        """Settings should have plex_default_role attribute with viewer default."""
        settings = Settings()
        assert hasattr(settings, "plex_default_role")
        assert settings.plex_default_role == "viewer"

    def test_settings_has_plex_admin_users(self) -> None:
        """Settings should have plex_admin_users attribute as empty list by default."""
        with patch.dict("os.environ", {}, clear=True):
            settings = Settings(_env_file=None)  # pyright: ignore[reportCallIssue]
            assert hasattr(settings, "plex_admin_users")
            assert isinstance(settings.plex_admin_users, list)
            # Default should be empty list
            assert settings.plex_admin_users == []


class TestErsatzTVSettings:
    """Tests for ErsatzTV configuration settings."""

    def test_settings_has_ersatztv_m3u_url(self) -> None:
        """Settings should have ersatztv_m3u_url attribute."""
        settings = Settings()
        assert hasattr(settings, "ersatztv_m3u_url")
        assert settings.ersatztv_m3u_url is not None

    def test_settings_has_ersatztv_xmltv_url(self) -> None:
        """Settings should have ersatztv_xmltv_url attribute."""
        settings = Settings()
        assert hasattr(settings, "ersatztv_xmltv_url")
        assert settings.ersatztv_xmltv_url is not None

    def test_settings_has_ersatztv_base_url(self) -> None:
        """Settings should have ersatztv_base_url attribute."""
        settings = Settings()
        assert hasattr(settings, "ersatztv_base_url")
        assert settings.ersatztv_base_url is not None

    def test_ersatztv_urls_have_sensible_defaults(self) -> None:
        """ErsatzTV URLs should have sensible default values."""
        settings = Settings()
        # Should have default values that include the expected paths
        m3u_url = settings.ersatztv_m3u_url.lower()
        assert "m3u" in m3u_url or "channels" in m3u_url
        assert "xml" in settings.ersatztv_xmltv_url.lower()
        assert settings.ersatztv_base_url.startswith("http")


def test_shared_dotenv_ignores_frontend_keys():
    """The launcher and Compose can use one dotenv without VITE_* validation errors."""
    from pydantic_settings import DotEnvSettingsSource

    with patch.object(
        DotEnvSettingsSource,
        "_read_env_files",
        return_value={
            "jwt_secret": "synthetic-local-signing-key-at-least-32-characters",
            "local_auth_enabled": "true",
            "vite_api_url": "/api",
            "vite_log_level": "debug",
        },
    ):
        config = Settings()
    assert config.local_auth_enabled is True
    assert (
        config.jwt_secret.get_secret_value() == "synthetic-local-signing-key-at-least-32-characters"
    )
    assert "vite_api_url" not in config.model_dump()


SECRETS = {
    "jwt_secret": "synthetic-jwt-secret-value-0001",
    "admin_password": "synthetic-admin-password-0002",
    "viewer_password": "synthetic-viewer-password-0003",
    "dispatcharr_api_key": "synthetic-dispatcharr-key-0004",
    "zipline_token": "synthetic-zipline-token-0005",
    "ntfy_token": "synthetic-ntfy-token-0006",
    "plex_server_token": "synthetic-plex-token-0007",
    "giphy_api_key": "synthetic-giphy-key-0008",
}


def test_secrets_never_appear_in_repr_or_str():
    config = Settings(_env_file=None, **SECRETS)  # pyright: ignore[reportCallIssue]
    shown = repr(config) + str(config) + str(config.model_dump())
    for value in SECRETS.values():
        assert value not in shown
    assert config.zipline_token.get_secret_value() == SECRETS["zipline_token"]


def test_assigned_secret_is_wrapped():
    config = Settings(_env_file=None)  # pyright: ignore[reportCallIssue]
    config.giphy_api_key = "synthetic-assigned-key"  # pyright: ignore[reportAttributeAccessIssue]
    assert config.giphy_api_key is not None
    assert config.giphy_api_key.get_secret_value() == "synthetic-assigned-key"
    assert "synthetic-assigned-key" not in repr(config)


@pytest.mark.parametrize(
    "name,raw,expected",
    [
        ("LOG_FORMAT", "JSON", "json"),
        ("LOG_FORMAT", " pretty ", "pretty"),
        ("LOG_LEVEL", "debug", "DEBUG"),
        ("LOG_LEVEL", " info ", "INFO"),
        ("LOG_LEVEL", "Warning", "WARNING"),
    ],
)
def test_log_settings_are_normalised(monkeypatch, name, raw, expected):
    monkeypatch.setenv(name, raw)
    assert getattr(Settings(_env_file=None), name.lower()) == expected  # pyright: ignore[reportCallIssue]


@pytest.mark.parametrize(
    "name,raw", [("LOG_FORMAT", "structured"), ("LOG_FORMAT", "json2"), ("LOG_LEVEL", "verbose")]
)
def test_unknown_log_settings_fail_at_startup(monkeypatch, name, raw):
    monkeypatch.setenv(name, raw)
    with pytest.raises(ValidationError, match=name.lower()):
        Settings(_env_file=None)  # pyright: ignore[reportCallIssue]


ZIPLINE = {"highlight_enabled": True, "zipline_enabled": True, "zipline_url": "https://z.example"}
NTFY = {"ntfy_enabled": True, "ntfy_url": "https://ntfy.example", "ntfy_topic": "synthetic"}


@pytest.mark.parametrize("token,available", [("", False), ("   ", False), ("synthetic", True)])
def test_zipline_available_reads_the_token_value(token, available):
    assert Settings(_env_file=None, zipline_token=token, **ZIPLINE).zipline_available is available  # pyright: ignore[reportCallIssue]


@pytest.mark.parametrize("token", ["", "synthetic"])
def test_ntfy_available_does_not_need_a_token(token):
    assert Settings(_env_file=None, ntfy_token=token, **NTFY).ntfy_available is True  # pyright: ignore[reportCallIssue]
    assert Settings(_env_file=None, ntfy_token=token).ntfy_available is False  # pyright: ignore[reportCallIssue]
