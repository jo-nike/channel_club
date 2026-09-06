from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict

# Placeholder signing key for local development. It is public in the source, so
# validate_auth_configuration() refuses to start on it — otherwise anyone can
# forge an admin JWT.
DEFAULT_JWT_SECRET = "dev-secret-change-in-production"

# Signing keys that are published somewhere public (this source, the committed
# .env.example onboarding template, ...) and therefore give no security at all.
# validate_auth_configuration() refuses to start on any of them. Add new
# placeholders here whenever an example/template ships a guessable value.
KNOWN_PUBLIC_JWT_SECRETS = frozenset(
    {
        DEFAULT_JWT_SECRET,
        "your-secret-key-change-me",  # shipped in .env.example
        "changeme",
        "secret",
    }
)


class Settings(BaseSettings):
    port: int = 8001

    # Immutable build identifier, baked into the image by CI as an env var.
    # Reported by /api/health so a deploy can verify the new build is live.
    app_version: str = "dev"

    dispatcharr_url: str = "http://10.8.0.2:9191"
    stream_base_url: str = "https://streams.domain.com"
    jwt_secret: str = DEFAULT_JWT_SECRET

    # Logging Configuration
    log_level: str = "INFO"  # DEBUG, INFO, WARNING, ERROR
    log_format: str = "pretty"  # json or pretty

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

    # Local Auth Credentials (only used when local_auth_enabled=True).
    # No password defaults: a guessable fallback must never be what protects
    # the app if the flag is turned back on. Unset means every login is rejected.
    admin_username: str = "admin"
    admin_password: str | None = None
    viewer_username: str = "viewer"
    viewer_password: str | None = None

    # Dispatcharr Authentication (optional - for channel and stats endpoints).
    # Personal API key from the Dispatcharr profile page (0.20.0+). Sent as
    # "Authorization: ApiKey <key>"; does not expire.
    dispatcharr_api_key: str | None = None

    # ErsatzTV Configuration
    ersatztv_m3u_url: str = "http://192.168.50.108:8409/iptv/channels.m3u"
    ersatztv_xmltv_url: str = "http://192.168.50.108:8409/iptv/xmltv.xml"
    ersatztv_base_url: str = "http://192.168.50.108:8409"

    # Additional trusted logo origins, e.g. ["https://images.example.com"].
    ersatztv_logo_origins: list[str] = []

    # Highlight Capture Feature (server-side FFmpeg recording)
    # Disabled by default - requires FFmpeg in container
    highlight_enabled: bool = False

    # Chat Feature
    # Enable real-time chat between connected users
    chat_enabled: bool = False

    # GIF Feature (requires chat to be enabled)
    # Enable GIF picker in chat using Giphy API
    giphy_api_key: str | None = None  # Giphy API key (get from developers.giphy.com)
    highlight_buffer_seconds: int = 60  # How many seconds to keep in ring buffer
    highlight_segment_seconds: int = 10  # FFmpeg segment duration
    highlight_temp_dir: str = "/tmp/highlights"  # Temp storage for segments

    # Shared per-worker admission limits (deploy one media worker).
    media_process_limit: int = 8
    media_process_per_user: int = 2
    media_export_limit: int = 2
    media_export_per_user: int = 1
    media_export_max_bytes: int = 256 * 1024 * 1024

    # Chromecast Feature (requires FFmpeg in container)
    # Enables casting streams to Chromecast devices via HLS transcoding
    cast_enabled: bool = False
    cast_hls_segment_time: int = 4  # Seconds per HLS segment
    # Number of segments in playlist (buffer = segment_time * list_size)
    cast_hls_list_size: int = 5
    cast_temp_dir: str = "/tmp/cast_hls"  # Temp storage for HLS segments
    cast_session_timeout: int = 300  # Seconds without activity before cleanup

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
