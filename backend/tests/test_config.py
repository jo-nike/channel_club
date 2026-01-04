"""Tests for application configuration."""

from unittest.mock import patch

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
            settings = Settings(_env_file=None)
            assert settings.local_auth_enabled is False

    def test_plex_auth_disabled_by_default(self) -> None:
        """Plex auth should be disabled by default when no env vars set."""
        with patch.dict("os.environ", {}, clear=True):
            # Create settings without .env file
            settings = Settings(_env_file=None)
            assert settings.plex_auth_enabled is False

    def test_settings_has_plex_server_token(self) -> None:
        """Settings should have plex_server_token attribute."""
        with patch.dict("os.environ", {}, clear=True):
            settings = Settings(_env_file=None)
            assert hasattr(settings, "plex_server_token")
            # Should be None by default
            assert settings.plex_server_token is None

    def test_settings_has_plex_server_machine_id(self) -> None:
        """Settings should have plex_server_machine_id attribute."""
        with patch.dict("os.environ", {}, clear=True):
            settings = Settings(_env_file=None)
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
            settings = Settings(_env_file=None)
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
