"""Tests for application configuration."""

import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app import config as config_module
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

    def test_source_urls_have_no_default(self) -> None:
        """A deploy names its own Dispatcharr and ErsatzTV; nothing points at a guessed host."""
        settings = Settings(_env_file=None)  # pyright: ignore[reportCallIssue]
        assert settings.dispatcharr_url == ""
        assert settings.ersatztv_base_url == ""

    @pytest.mark.parametrize("base", ["http://ersatztv:8409", "http://ersatztv:8409/"])
    def test_feed_urls_are_derived_from_the_base_url(self, base: str) -> None:
        """The M3U and XMLTV feeds sit at ErsatzTV's fixed paths under the base URL."""
        settings = Settings(ersatztv_base_url=base)
        assert settings.ersatztv_m3u_url == "http://ersatztv:8409/iptv/channels.m3u"
        assert settings.ersatztv_xmltv_url == "http://ersatztv:8409/iptv/xmltv.xml"


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
    "admin_password_hash": "synthetic-admin-hash-0009",
    "viewer_password_hash": "synthetic-viewer-hash-0010",
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


@pytest.mark.parametrize(
    "url",
    [
        "",
        "ftp://z.example",
        "https://",
        "https://user:pass@z.example",
        "https://z.example/?a=1",
        "https://z.example/#top",
        "https://z.example:0",
        "https://z.example:99999",
    ],
)
def test_upload_and_push_urls_must_be_plain_http(url):
    """No credentials, query or fragment can ride along with the saved URL."""
    assert config_module.plain_http_url(url) is False
    zipline = {**ZIPLINE, "zipline_url": url, "zipline_token": "t"}
    assert Settings(_env_file=None, **zipline).zipline_available is False  # pyright: ignore[reportCallIssue]
    assert Settings(_env_file=None, **{**NTFY, "ntfy_url": url}).ntfy_available is False  # pyright: ignore[reportCallIssue]


def test_plex_admin_users_follows_reassignment():
    """A plain property: the list changes as soon as the string does."""
    config = Settings(_env_file=None, plex_admin_users_str="alice, bob,")  # pyright: ignore[reportCallIssue]
    assert config.plex_admin_users == ["alice", "bob"]

    config.plex_admin_users_str = "carol"

    assert config.plex_admin_users == ["carol"]


def test_env_fields_lists_what_the_environment_set_even_when_empty(tmp_path: Path) -> None:
    """An empty variable still counts as set, so it still locks its group."""
    probe = "from app.config import ENV_FIELDS\nprint(','.join(sorted(ENV_FIELDS)))\n"
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(Path(__file__).parents[1]),
        "DISPATCHARR_URL": "",
        "LOG_LEVEL": "debug",
    }
    # Run from an empty directory, so no dotenv file is read
    result = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )

    assert result.stdout.strip() == "dispatcharr_url,log_level"


# Settings only the environment can set: how the container runs, build identity,
# the signing key, and the plaintext passwords and usernames the UI never writes.
ENV_ONLY = {
    "app_build_id",
    "app_revision",
    "state_file",
    "jwt_secret",
    "admin_password",
    "viewer_password",
    "plex_admin_users_str",
    "log_format",
    "docs_enabled",
    "cors_origins",
    "highlight_temp_dir",
    "cast_temp_dir",
}


def test_every_setting_is_either_saved_from_the_ui_or_env_only():
    """A new setting has to be placed: in the UI's list or in ENV_ONLY."""
    ui = set(config_module.UI_FIELDS)
    assert ui.isdisjoint(ENV_ONLY)
    assert ui | ENV_ONLY == set(Settings.model_fields)


def test_every_ui_field_is_in_exactly_one_group():
    grouped = [field for fields in config_module.FIELD_GROUPS.values() for field in fields]
    assert len(grouped) == len(set(grouped))
    assert set(grouped) <= set(Settings.model_fields)
    assert set(config_module.UI_FIELDS) <= set(grouped)
    # Each Advanced knob is a group of its own
    for field in config_module.ADVANCED_FIELDS:
        assert config_module.FIELD_GROUPS[field] == (field,)


def test_env_name_is_the_upper_case_field_name():
    assert config_module.env_name("plex_admin_users_str") == "PLEX_ADMIN_USERS_STR"
