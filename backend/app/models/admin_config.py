"""Admin models for the server settings saved from the app."""

from typing import Annotated, Literal

from pydantic import ConfigDict, Field, ValidationInfo, field_validator

from app.config import NTFY_TOPIC_PATTERN, normalise_http_url, plain_http_url
from app.models.base import CamelModel
from app.models.setup import MIN_PASSWORD_LENGTH, USERNAME_PATTERN

LogLevel = Literal["TRACE", "DEBUG", "INFO", "SUCCESS", "WARNING", "ERROR", "CRITICAL"]
# Plex account ids are numbers; anything else is not an id worth storing
PLEX_ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"


class SecretState(CamelModel):
    """A secret as the Admin panel sees it: whether it is set, never its value."""

    set: bool


class ConfigValues(CamelModel):
    """Every setting the app can change, as the server runs with it now.

    Secrets are only {set}. House rules come from the state file, not settings.
    """

    # Sources
    dispatcharr_url: str
    dispatcharr_api_key: SecretState
    ersatztv_base_url: str
    ersatztv_api_key: SecretState
    # Who can join
    local_auth_enabled: bool
    admin_username: str
    admin_password: SecretState
    viewer_username: str
    viewer_password: SecretState
    plex_auth_enabled: bool
    plex_server_token: SecretState
    plex_server_machine_id: str | None
    plex_admin_ids: list[str]
    user_channel_selection: bool
    presence_visible: bool
    # Extras
    chat_enabled: bool
    giphy_api_key: SecretState
    highlight_enabled: bool
    zipline_enabled: bool
    zipline_url: str
    zipline_token: SecretState
    nhl_enabled: bool
    ntfy_enabled: bool
    ntfy_url: str
    ntfy_topic: str
    ntfy_token: SecretState
    # Advanced
    media_process_limit: int
    media_process_per_user: int
    cast_hls_segment_time: int
    cast_hls_list_size: int
    cast_session_timeout: int
    highlight_buffer_seconds: int
    highlight_segment_seconds: int
    media_recorder_limit: int
    media_export_max_bytes: int
    media_export_limit: int
    media_export_per_user: int
    media_upload_limit: int
    media_upload_per_user: int
    feedback_cooldown_seconds: int
    feedback_hourly_limit: int
    request_body_max_bytes: int
    log_level: str
    ersatztv_logo_origins: list[str]


class EnvVariable(CamelModel):
    """A variable the server's environment sets, for the Admin panel's list."""

    env: str
    # The setting it locks in the app, or None when only the environment sets it
    field: str | None
    # None for a secret, which is only ever shown as set
    value: str | None
    secret: bool


class FfmpegTools(CamelModel):
    """Whether the tools clips and casting need are on the server's path."""

    ffmpeg: bool
    ffprobe: bool


class ConfigStorage(CamelModel):
    """Where the settings live, for the "Handled for you" list."""

    # None when the server has no state file, so settings can't be saved
    settings_file: str | None
    signing_key: Literal["environment", "settings"]


class AdminConfigResponse(CamelModel):
    """Response for GET /api/admin/config."""

    values: ConfigValues
    # Settings the environment locks, each with the variables that lock its group
    locked: dict[str, list[str]]
    environment: list[EnvVariable]
    defaults: ConfigValues
    plex_server_name: str | None
    ffmpeg: FfmpegTools
    storage: ConfigStorage


class ConfigWarning(CamelModel):
    """Something saved that won't work yet, e.g. Zipline on while clips are off."""

    code: Literal["zipline_unavailable", "feedback_unavailable"]
    message: str


class ConfigUpdateResponse(CamelModel):
    """Response for PUT /api/admin/config and POST /api/admin/plex/server."""

    config: AdminConfigResponse
    warnings: list[ConfigWarning]


def _http_url(value: object) -> object:
    """An http(s) URL, normalised; empty stays empty (the source or feature is unset)."""
    if not isinstance(value, str):
        return value
    value = value.strip()
    if not value:
        return value
    if not plain_http_url(value):
        raise ValueError(
            "Use an http:// or https:// address without a user name, query or fragment"
        )
    return normalise_http_url(value)


# Settings a PUT may send as null: the secrets, which null removes
NULLABLE = frozenset(
    {
        "dispatcharr_api_key",
        "ersatztv_api_key",
        "admin_password",
        "viewer_password",
        "giphy_api_key",
        "zipline_token",
        "ntfy_token",
    }
)

Count = Annotated[int, Field(ge=1)]


class ConfigPatch(CamelModel):
    """Body of PUT /api/admin/config: only the settings to change.

    A secret left out keeps its saved value, null removes it, and a string
    replaces it. The Plex server and its token are linked through
    POST /api/admin/plex/server instead.
    """

    dispatcharr_url: str | None = Field(default=None, max_length=2048)
    dispatcharr_api_key: str | None = Field(default=None, min_length=1, max_length=512)
    ersatztv_base_url: str | None = Field(default=None, max_length=2048)
    ersatztv_api_key: str | None = Field(default=None, min_length=1, max_length=512)
    local_auth_enabled: bool | None = None
    admin_username: str | None = Field(default=None, pattern=USERNAME_PATTERN)
    admin_password: str | None = Field(default=None, max_length=256, min_length=MIN_PASSWORD_LENGTH)
    viewer_username: str | None = Field(default=None, pattern=USERNAME_PATTERN)
    viewer_password: str | None = Field(
        default=None, max_length=256, min_length=MIN_PASSWORD_LENGTH
    )
    plex_auth_enabled: bool | None = None
    plex_admin_ids: list[Annotated[str, Field(pattern=PLEX_ID_PATTERN)]] | None = Field(
        default=None, max_length=500
    )
    user_channel_selection: bool | None = None
    presence_visible: bool | None = None
    chat_enabled: bool | None = None
    giphy_api_key: str | None = Field(default=None, min_length=1, max_length=256)
    highlight_enabled: bool | None = None
    zipline_enabled: bool | None = None
    zipline_url: str | None = Field(default=None, max_length=2048)
    zipline_token: str | None = Field(default=None, min_length=1, max_length=512)
    nhl_enabled: bool | None = None
    ntfy_enabled: bool | None = None
    ntfy_url: str | None = Field(default=None, max_length=2048)
    ntfy_topic: str | None = Field(default=None, max_length=64)
    ntfy_token: str | None = Field(default=None, min_length=1, max_length=512)
    media_process_limit: Count | None = Field(default=None, le=64)
    media_process_per_user: Count | None = Field(default=None, le=64)
    cast_hls_segment_time: Count | None = Field(default=None, le=30)
    cast_hls_list_size: int | None = Field(default=None, ge=2, le=30)
    cast_session_timeout: int | None = Field(default=None, ge=30, le=86400)
    highlight_buffer_seconds: int | None = Field(default=None, ge=10, le=600)
    highlight_segment_seconds: Count | None = Field(default=None, le=60)
    media_recorder_limit: Count | None = Field(default=None, le=32)
    media_export_max_bytes: int | None = Field(default=None, ge=1024 * 1024, le=2 * 1024**3)
    media_export_limit: Count | None = Field(default=None, le=16)
    media_export_per_user: Count | None = Field(default=None, le=16)
    media_upload_limit: Count | None = Field(default=None, le=16)
    media_upload_per_user: Count | None = Field(default=None, le=16)
    feedback_cooldown_seconds: int | None = Field(default=None, ge=0, le=3600)
    feedback_hourly_limit: Count | None = Field(default=None, le=1000)
    # The floor keeps room for the PUT that fixes a cap set too low
    request_body_max_bytes: int | None = Field(default=None, ge=32 * 1024, le=16 * 1024 * 1024)
    log_level: LogLevel | None = None
    ersatztv_logo_origins: list[Annotated[str, Field(max_length=2048)]] | None = Field(
        default=None, max_length=20
    )

    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def _null_only_for_secrets(cls, value: object, info: ValidationInfo) -> object:
        if value is None and info.field_name not in NULLABLE:
            raise ValueError("Only a secret can be removed with null")
        return value

    @field_validator("dispatcharr_url", "ersatztv_base_url", "zipline_url", "ntfy_url")
    @classmethod
    def _normalise_url(cls, value: str | None) -> object:
        return _http_url(value)

    @field_validator("ersatztv_logo_origins")
    @classmethod
    def _normalise_origins(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        origins = [str(_http_url(origin)) for origin in value]
        if "" in origins:
            raise ValueError("Leave out empty addresses")
        return origins

    @field_validator("ntfy_topic")
    @classmethod
    def _topic(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if value and not NTFY_TOPIC_PATTERN.fullmatch(value):
                raise ValueError("Use only letters, numbers, - and _, up to 64 characters")
        return value


ProbeKind = Literal["dispatcharr", "ersatztv", "giphy", "zipline", "ntfy"]
ProbeReason = Literal["unreachable", "timeout", "auth", "not_found", "http", "invalid"]


class ProbeValues(CamelModel):
    """The draft values a test uses; anything left out is the saved value."""

    dispatcharr_url: str | None = Field(default=None, max_length=2048)
    dispatcharr_api_key: str | None = Field(default=None, min_length=1, max_length=512)
    ersatztv_base_url: str | None = Field(default=None, max_length=2048)
    ersatztv_api_key: str | None = Field(default=None, min_length=1, max_length=512)
    giphy_api_key: str | None = Field(default=None, min_length=1, max_length=256)
    zipline_url: str | None = Field(default=None, max_length=2048)
    zipline_token: str | None = Field(default=None, min_length=1, max_length=512)
    ntfy_url: str | None = Field(default=None, max_length=2048)
    ntfy_topic: str | None = Field(default=None, max_length=64)
    ntfy_token: str | None = Field(default=None, min_length=1, max_length=512)

    model_config = ConfigDict(extra="forbid")

    @field_validator("dispatcharr_url", "ersatztv_base_url", "zipline_url", "ntfy_url")
    @classmethod
    def _normalise_url(cls, value: str | None) -> object:
        return _http_url(value)


class ProbeRequest(CamelModel):
    """Body of POST /api/admin/config/test."""

    kind: ProbeKind
    values: ProbeValues = Field(default_factory=ProbeValues)


class ProbeCounts(CamelModel):
    """What a successful test found."""

    channels: int | None = None
    groups: int | None = None
    guide_days: int | None = None
    username: str | None = None


class ProbeResult(CamelModel):
    """A connection test's outcome. The app words it; upstream text is never echoed."""

    ok: bool
    reason: ProbeReason | None = None
    counts: ProbeCounts = Field(default_factory=ProbeCounts)


class PlexMemberView(CamelModel):
    """A member of the linked Plex server, for ticking admins."""

    plex_id: str
    username: str
    managed: bool
    owner: bool
    admin: bool


class PlexServerLink(CamelModel):
    """Body of POST /api/admin/plex/server: link (or re-link) one of your own servers."""

    auth_token: str = Field(max_length=512, pattern=r"^[\x21-\x7e]+$")
    machine_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")

    model_config = ConfigDict(extra="forbid")
