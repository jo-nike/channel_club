from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    port: int = 8001
    dispatcharr_url: str = "http://10.8.0.2:9191"
    stream_base_url: str = "https://streams.domain.com"
    jwt_secret: str = "dev-secret-change-in-production"

    # Authentication Feature Flags
    local_auth_enabled: bool = False  # Enable username/password auth
    plex_auth_enabled: bool = False  # Enable Plex OAuth

    # Plex Authentication Settings (only used when plex_auth_enabled=True)
    plex_server_token: str | None = None  # Admin's Plex server token
    plex_server_machine_id: str | None = None  # Server machine identifier
    plex_default_role: str = "viewer"  # Default role for Plex users
    plex_admin_users_str: str = ""  # Comma-separated usernames who get admin role

    @cached_property
    def plex_admin_users(self) -> list[str]:
        """Parse comma-separated admin usernames into a list."""
        if not self.plex_admin_users_str:
            return []
        return [u.strip() for u in self.plex_admin_users_str.split(",") if u.strip()]

    # Local Auth Credentials (only used when local_auth_enabled=True)
    admin_username: str = "admin"
    admin_password: str = "admin"
    viewer_username: str = "viewer"
    viewer_password: str = "viewer"

    # ErsatzTV Configuration
    ersatztv_m3u_url: str = "http://192.168.50.108:8409/iptv/channels.m3u"
    ersatztv_xmltv_url: str = "http://192.168.50.108:8409/iptv/xmltv.xml"
    ersatztv_base_url: str = "http://192.168.50.108:8409"

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
