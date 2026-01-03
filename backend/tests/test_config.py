"""Tests for application configuration."""

from app.config import Settings


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
