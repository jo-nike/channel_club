import re
from functools import cached_property
from typing import Literal
from urllib.parse import urlsplit

from pydantic import SecretStr, ValidationInfo, field_validator
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

# ntfy topic names: letters, digits, underscore, hyphen; 1-64 characters. Anything
# else would let a topic value change the publish path.
NTFY_TOPIC_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}")


class Settings(BaseSettings):
    # Build identity stays distinct from the semantic version in pyproject.toml.
    app_build_id: str = "dev"
    app_revision: str = "dev"

    dispatcharr_url: str = "http://10.8.0.2:9191"
    stream_base_url: str = "https://streams.domain.com"
    jwt_secret: SecretStr = SecretStr(DEFAULT_JWT_SECRET)

    # FastAPI's /docs, /redoc and /openapi.json publish the API map; off in production.
    docs_enabled: bool = False
    # Browser origins allowed cross-origin, e.g. ["http://localhost:5173"]. Empty
    # (no CORS middleware) in production and in dev, where Vite proxies /api.
    cors_origins: list[str] = []

    # Logging Configuration
    log_level: Literal["TRACE", "DEBUG", "INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    log_format: Literal["json", "pretty"] = "pretty"

    @field_validator("log_level", "log_format", mode="before")
    @classmethod
    def _normalise_log_setting(cls, value: object, info: ValidationInfo) -> object:
        """Accept any case and surrounding spaces; anything else fails at startup."""
        if not isinstance(value, str):
            return value
        value = value.strip()
        return value.upper() if info.field_name == "log_level" else value.lower()

    # Authentication Feature Flags
    local_auth_enabled: bool = False  # Enable username/password auth
    plex_auth_enabled: bool = False  # Enable Plex OAuth

    # Plex Authentication Settings (only used when plex_auth_enabled=True)
    plex_server_token: SecretStr | None = None  # Admin's Plex server token
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
    admin_password: SecretStr | None = None
    viewer_username: str = "viewer"
    viewer_password: SecretStr | None = None

    # Dispatcharr Authentication (optional - for channel and stats endpoints).
    # Personal API key from the Dispatcharr profile page (0.20.0+). Sent as
    # "Authorization: ApiKey <key>"; does not expire.
    dispatcharr_api_key: SecretStr | None = None

    # ErsatzTV Configuration
    ersatztv_m3u_url: str = "http://192.168.50.108:8409/iptv/channels.m3u"
    ersatztv_xmltv_url: str = "http://192.168.50.108:8409/iptv/xmltv.xml"
    ersatztv_base_url: str = "http://192.168.50.108:8409"

    # Additional trusted logo origins, e.g. ["https://images.example.com"].
    ersatztv_logo_origins: list[str] = []

    # Highlight Capture Feature (server-side FFmpeg recording)
    # Disabled by default - requires FFmpeg in container
    highlight_enabled: bool = False

    # Optional shared upload destination. Credentials never leave the backend.
    zipline_enabled: bool = False
    zipline_url: str = ""
    zipline_token: SecretStr = SecretStr("")

    @property
    def zipline_available(self) -> bool:
        try:
            url = urlsplit(self.zipline_url)
            return bool(
                self.highlight_enabled
                and self.zipline_enabled
                and self.zipline_token.get_secret_value().strip()
                and url.scheme in ("http", "https")
                and url.hostname
                and url.port != 0
                and not url.username
                and not url.password
                and not url.query
                and not url.fragment
            )
        except ValueError:
            return False

    # Optional feedback push to an ntfy topic. Destination and token are
    # server-owned; never a VITE_ variable.
    ntfy_enabled: bool = False
    ntfy_url: str = ""  # Instance base URL, e.g. https://ntfy.sh or a self-hosted server
    ntfy_topic: str = ""  # Dedicated topic, e.g. channel-club-feedback
    # Optional access token for protected topics (sent as Bearer)
    ntfy_token: SecretStr = SecretStr("")
    feedback_cooldown_seconds: int = 30  # Minimum gap between submissions per user
    feedback_hourly_limit: int = 10  # Maximum submissions per user per hour

    @property
    def ntfy_available(self) -> bool:
        try:
            url = urlsplit(self.ntfy_url)
            return bool(
                self.ntfy_enabled
                and NTFY_TOPIC_PATTERN.fullmatch(self.ntfy_topic)
                and url.scheme in ("http", "https")
                and url.hostname
                and url.port != 0
                and not url.username
                and not url.password
                and not url.query
                and not url.fragment
            )
        except ValueError:
            return False

    # JSON file that keeps admin settings and the Live channel across restarts.
    # Empty disables it (nothing is read or written); the image sets /data/state.json.
    state_file: str = ""

    # Chat Feature
    # Enable real-time chat between connected users
    chat_enabled: bool = False

    # GIF Feature (requires chat to be enabled)
    # Enable GIF picker in chat using Giphy API
    giphy_api_key: SecretStr | None = None  # Giphy API key (get from developers.giphy.com)
    highlight_buffer_seconds: int = 60  # How many seconds to keep in ring buffer
    highlight_segment_seconds: int = 10  # FFmpeg segment duration
    highlight_temp_dir: str = "/tmp/highlights"  # Temp storage for segments

    # Shared per-worker admission limits (deploy one media worker).
    media_process_limit: int = 8
    media_process_per_user: int = 2
    # Highlight recorders share one system owner, so the per-user limit equals the global one.
    media_recorder_limit: int = 4
    media_recorder_per_user: int = 4
    media_export_limit: int = 2
    media_export_per_user: int = 1
    # Zipline uploads are network-bound, so they have their own slots instead of export's.
    media_upload_limit: int = 2
    media_upload_per_user: int = 1
    media_export_max_bytes: int = 256 * 1024 * 1024
    # Every other request body; /api/highlight/upload enforces media_export_max_bytes.
    request_body_max_bytes: int = 64 * 1024

    # Chromecast Feature (requires FFmpeg in container)
    # Enables casting streams to Chromecast devices via HLS transcoding
    cast_enabled: bool = False
    cast_hls_segment_time: int = 4  # Seconds per HLS segment
    # Number of segments in playlist (buffer = segment_time * list_size)
    cast_hls_list_size: int = 5
    cast_temp_dir: str = "/tmp/cast_hls"  # Temp storage for HLS segments
    cast_session_timeout: int = 300  # Seconds without activity before cleanup

    # The shared root dotenv also contains frontend/Compose settings.
    # validate_assignment: a later assignment is coerced and checked like the env value.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", validate_assignment=True)


settings = Settings()
