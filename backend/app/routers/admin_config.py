"""Admin API for the server settings saved from the app (the setup wizard and the
Admin panel's Server tab).

Values in a group the environment sets are locked: a change to them is refused
with the variables that lock them. Secrets are never sent back, only whether
they are set, and a saved secret is reused only while its address keeps the
same origin, so a key can't be sent to a server an admin session just typed in.
"""

import shutil
from time import monotonic
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.exceptions import RequestValidationError
from loguru import logger
from pydantic import SecretStr
from pydantic.alias_generators import to_camel

from app import config
from app.config import (
    FIELD_GROUPS,
    IMAGE_FIELDS,
    SECRET_FIELDS,
    UI_FIELDS,
    Settings,
    UiField,
    env_name,
    settings,
)
from app.models.admin_config import (
    AdminConfigResponse,
    ConfigPatch,
    ConfigStorage,
    ConfigUpdateResponse,
    ConfigValues,
    ConfigWarning,
    EnvVariable,
    FfmpegTools,
    PlexMemberView,
    PlexServerLink,
    ProbeKind,
    ProbeRequest,
    ProbeResult,
    SecretState,
)
from app.models.auth import TokenPayload
from app.routers.auth_deps import require_admin
from app.services import (
    app_settings,
    config_apply,
    config_probes,
    plex,
    presence_broadcast,
    settings_store,
    state_store,
)
from app.services.logo_proxy import url_origin
from app.services.passwords import hash_password, local_accounts
from app.services.plex import InvalidPlexTokenError, PlexUnavailableError

router = APIRouter(tags=["admin"])
log = logger.bind(router="admin_config")

HOUSE_RULES = frozenset({"user_channel_selection", "presence_visible"})
# API names that differ from the setting they write: passwords are saved as hashes
PASSWORD_HASHES: dict[str, UiField] = {
    "admin_password": "admin_password_hash",
    "viewer_password": "viewer_password_hash",
}
# Each saved secret and the address it is sent to
SECRET_ADDRESSES = {
    "dispatcharr_api_key": "dispatcharr_url",
    "zipline_token": "zipline_url",
    "ntfy_token": "ntfy_url",
}
# The settings each connection test reads
PROBE_FIELDS: dict[ProbeKind, tuple[str, ...]] = {
    "dispatcharr": ("dispatcharr_url", "dispatcharr_api_key"),
    "ersatztv": ("ersatztv_base_url",),
    "giphy": ("giphy_api_key",),
    "zipline": ("zipline_url", "zipline_token"),
    "ntfy": ("ntfy_url", "ntfy_topic", "ntfy_token"),
}
# The settings that make a Plex member an admin
PLEX_ADMIN_FIELDS = frozenset({"plex_admin_ids", "plex_default_role"})
# ntfy's test sends a real notification, so it can't be repeated at once
PROBE_COOLDOWN_SECONDS: dict[ProbeKind, float] = {"ntfy": 10.0}
_last_probe: dict[ProbeKind, float] = {}


def reset_probe_cooldowns() -> None:
    """Forget when each test last ran (tests)."""
    _last_probe.clear()


def _error(status_code: int, code: str, message: str, **extra: Any) -> HTTPException:
    """An error the Admin panel tells apart by code; it words the message itself."""
    return HTTPException(status_code, detail={"code": code, "message": message, **extra})


def _field_error(field: str, code: str, message: str) -> RequestValidationError:
    """A 422 on one field, shaped like FastAPI's own, so the form shows it by the field."""
    return RequestValidationError(
        [{"loc": ("body", to_camel(field)), "msg": message, "type": code}]
    )


def _setting(field: str) -> str:
    """The setting an API field writes."""
    return PASSWORD_HASHES.get(field, field)


def _plain(value: SecretStr | None) -> str:
    return value.get_secret_value() if value is not None else ""


def _secret(*values: SecretStr | None) -> SecretState:
    return SecretState(set=any(_plain(value) for value in values))


def _values(source: Settings, house_rules: dict[str, bool]) -> ConfigValues:
    return ConfigValues(
        dispatcharr_url=source.dispatcharr_url,
        dispatcharr_api_key=_secret(source.dispatcharr_api_key),
        ersatztv_base_url=source.ersatztv_base_url,
        local_auth_enabled=source.local_auth_enabled,
        admin_username=source.admin_username,
        admin_password=_secret(source.admin_password, source.admin_password_hash),
        viewer_username=source.viewer_username,
        viewer_password=_secret(source.viewer_password, source.viewer_password_hash),
        plex_auth_enabled=source.plex_auth_enabled,
        plex_server_token=_secret(source.plex_server_token),
        plex_server_machine_id=source.plex_server_machine_id,
        plex_default_role=source.plex_default_role,
        plex_admin_ids=list(source.plex_admin_ids),
        user_channel_selection=house_rules["userChannelSelection"],
        presence_visible=house_rules["presenceVisible"],
        chat_enabled=source.chat_enabled,
        giphy_api_key=_secret(source.giphy_api_key),
        highlight_enabled=source.highlight_enabled,
        zipline_enabled=source.zipline_enabled,
        zipline_url=source.zipline_url,
        zipline_token=_secret(source.zipline_token),
        cast_enabled=source.cast_enabled,
        ntfy_enabled=source.ntfy_enabled,
        ntfy_url=source.ntfy_url,
        ntfy_topic=source.ntfy_topic,
        ntfy_token=_secret(source.ntfy_token),
        media_process_limit=source.media_process_limit,
        media_process_per_user=source.media_process_per_user,
        cast_hls_segment_time=source.cast_hls_segment_time,
        cast_hls_list_size=source.cast_hls_list_size,
        cast_session_timeout=source.cast_session_timeout,
        highlight_buffer_seconds=source.highlight_buffer_seconds,
        highlight_segment_seconds=source.highlight_segment_seconds,
        media_recorder_limit=source.media_recorder_limit,
        media_export_max_bytes=source.media_export_max_bytes,
        media_export_limit=source.media_export_limit,
        media_export_per_user=source.media_export_per_user,
        media_upload_limit=source.media_upload_limit,
        media_upload_per_user=source.media_upload_per_user,
        feedback_cooldown_seconds=source.feedback_cooldown_seconds,
        feedback_hourly_limit=source.feedback_hourly_limit,
        request_body_max_bytes=source.request_body_max_bytes,
        log_level=source.log_level,
        ersatztv_logo_origins=list(source.ersatztv_logo_origins),
    )


def _locked() -> dict[str, list[str]]:
    """Each API field the environment locks, with the variables that lock its group."""
    by_setting = {api: _setting(api) for api in ConfigValues.model_fields if api not in HOUSE_RULES}
    locked: dict[str, list[str]] = {}
    for group, names in settings_store.locked_groups().items():
        for api, setting in by_setting.items():
            if setting in FIELD_GROUPS[group]:
                locked[to_camel(api)] = names
    return locked


def _display(value: object) -> str:
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    return str(value)


def _environment() -> list[EnvVariable]:
    # The API field each variable feeds; the plaintext passwords feed the password fields
    api_of = {_setting(api): to_camel(api) for api in ConfigValues.model_fields}
    api_of |= {"admin_password": "adminPassword", "viewer_password": "viewerPassword"}
    return [
        EnvVariable(
            env=env_name(field),
            field=api_of.get(field),
            value=None if field in SECRET_FIELDS else _display(getattr(settings, field)),
            secret=field in SECRET_FIELDS,
        )
        for field in sorted(config.ENV_FIELDS - IMAGE_FIELDS)
    ]


def _config_response() -> AdminConfigResponse:
    path = settings_store.settings_path()
    house_rules = app_settings.get_app_settings().model_dump(by_alias=True)
    # A new install's house rules, as the state file starts them
    defaults = {rule: state_store.DEFAULTS[rule] for rule in house_rules}
    return AdminConfigResponse(
        values=_values(settings, house_rules),
        locked=_locked(),
        environment=_environment(),
        defaults=_values(Settings.model_construct(), defaults),
        plex_server_name=settings_store.plex_server_name(),
        ffmpeg=FfmpegTools(
            ffmpeg=shutil.which("ffmpeg") is not None,
            ffprobe=shutil.which("ffprobe") is not None,
        ),
        storage=ConfigStorage(
            settings_file=str(path) if path is not None else None,
            signing_key="environment" if "jwt_secret" in config.ENV_FIELDS else "settings",
        ),
    )


def _warnings() -> list[ConfigWarning]:
    """What startup would warn about: saved, but not working yet."""
    warnings: list[ConfigWarning] = []
    if settings.zipline_enabled and not settings.zipline_available:
        warnings.append(
            ConfigWarning(
                code="zipline_unavailable",
                message="Zipline uploads need clips on, an http(s) address and a token",
            )
        )
    if settings.ntfy_enabled and not settings.ntfy_available:
        warnings.append(
            ConfigWarning(
                code="feedback_unavailable",
                message="Feedback needs an ntfy address and topic",
            )
        )
    return warnings


def _refuse_locked(fields: set[str]) -> None:
    """409 for a change to a setting in a group the environment sets."""
    locked = settings_store.locked_groups()
    for field in sorted(fields - HOUSE_RULES):
        group = settings_store.GROUP_OF[_setting(field)]
        if group in locked:
            names = locked[group]
            raise _error(
                409,
                "locked",
                f"Set by {', '.join(names)} in the server's environment",
                field=to_camel(field),
                env=names,
            )


def _refuse_stale_secrets(new_urls: dict[str, str], given_secrets: set[str]) -> None:
    """422 when a saved secret would go to an address with another origin."""
    for secret, address in SECRET_ADDRESSES.items():
        # A cleared address sends the secret nowhere
        if not new_urls.get(address) or secret in given_secrets:
            continue
        saved = getattr(settings, secret)
        if _plain(saved) and url_origin(new_urls[address]) != url_origin(
            getattr(settings, address)
        ):
            raise _field_error(secret, "secret_required", "Enter it again for the new address")


async def _owns_the_server(admin: TokenPayload) -> bool:
    """Whether a Plex admin owns the linked server, as require_admin decides it.

    An owner plex.tv can't confirm right now counts, as it does there, so a
    save is never refused for fear of what an outage might mean.
    """
    if admin.plex_id is None or not _plain(settings.plex_server_token):
        return False
    owner_id = await plex.get_server_owner_id()
    return owner_id is None or owner_id == admin.plex_id


def _check_rules(patch: ConfigPatch, given: set[str], admin: TokenPayload, owner: bool) -> None:
    """The rules that span settings, checked on the values the patch would leave.

    Each rule runs only when the patch touches one of its settings, so a
    conflict the environment set up never blocks an unrelated change.
    `owner`: the requesting admin owns the Plex server (looked up only when
    the patch touches who is an admin).
    """

    def after(field: str) -> Any:
        return getattr(patch, field) if field in given else getattr(settings, field)

    linked = bool(settings.plex_server_machine_id)
    if "plex_auth_enabled" in given and patch.plex_auth_enabled and not linked:
        raise _field_error("plex_auth_enabled", "plex_not_linked", "Link a Plex server first")

    admin_account, viewer_account = local_accounts(settings)

    def usable(account_field: str, plaintext: str, hashed: str) -> bool:
        if plaintext:
            return True
        if account_field in given:
            return getattr(patch, account_field) is not None
        return bool(hashed)

    logins = {"admin_username", "admin_password", "viewer_username", "viewer_password"}
    if given & logins:
        admin_usable = usable("admin_password", admin_account.plaintext, admin_account.hashed)
        viewer_usable = usable("viewer_password", viewer_account.plaintext, viewer_account.hashed)
        if admin_usable and viewer_usable and after("admin_username") == after("viewer_username"):
            raise _field_error(
                "viewer_username", "username_taken", "Use a different name from the admin login"
            )

    ring = {"highlight_segment_seconds", "highlight_buffer_seconds"}
    if given & ring and after("highlight_segment_seconds") > after("highlight_buffer_seconds"):
        raise _field_error(
            "highlight_segment_seconds",
            "segment_too_long",
            "Keep segments no longer than the seconds kept for clipping",
        )

    _refuse_stale_secrets(
        {field: getattr(patch, field) for field in SECRET_ADDRESSES.values() if field in given},
        given & set(SECRET_ADDRESSES),
    )

    # The sign-in the requesting admin is using can't be switched off under them,
    # and a Plex admin can't take away what makes them one (require_admin)
    if admin.plex_id is None:
        lockout = (
            ("local_auth_enabled" in given and not patch.local_auth_enabled)
            or (
                "admin_password" in given
                and not usable("admin_password", admin_account.plaintext, "")
            )
            or ("admin_username" in given and patch.admin_username != admin.sub)
        )
    else:
        stays_admin = (
            owner
            or admin.sub in settings.plex_admin_users
            or admin.plex_id in after("plex_admin_ids")
            or after("plex_default_role") == "admin"
        )
        lockout = ("plex_auth_enabled" in given and not patch.plex_auth_enabled) or (
            bool(given & PLEX_ADMIN_FIELDS) and not stays_admin
        )
    if lockout:
        raise _error(409, "self_lockout", "That would lock you out; change it from another admin")


async def _setting_values(patch: ConfigPatch, given: set[str]) -> dict[UiField, object]:
    """The patch as setting values: passwords hashed, a removed secret emptied."""
    by_name: dict[str, UiField] = {field: field for field in UI_FIELDS}
    values: dict[UiField, object] = {}
    for field in sorted(given - HOUSE_RULES):
        value = getattr(patch, field)
        if field in PASSWORD_HASHES:
            values[PASSWORD_HASHES[field]] = None if value is None else await hash_password(value)
        elif value is None and field in ("zipline_token", "ntfy_token"):
            # These two are never None: empty means unset
            values[by_name[field]] = ""
        else:
            values[by_name[field]] = value
    return values


@router.get("/config", response_model=AdminConfigResponse)
async def get_config(admin: TokenPayload = Depends(require_admin)) -> AdminConfigResponse:
    """Every setting the app can change, which ones the environment locks, and the defaults."""
    return _config_response()


@router.put("/config", response_model=ConfigUpdateResponse)
async def update_config(
    patch: ConfigPatch, admin: TokenPayload = Depends(require_admin)
) -> ConfigUpdateResponse:
    """Change some settings; they apply at once, with no restart.

    The whole batch is checked before anything is saved. House rules are saved
    to the state file like PUT /api/settings does.

    Raises:
        HTTPException: 409 for a setting the environment locks, one that would
            sign the requesting admin out or take away their admin rights, or
            no state file to save to; 422 for a value or combination the
            settings refuse; 500 when the file can't be written.
    """
    given = set(patch.model_fields_set)
    _refuse_locked(given)
    owner = bool(given & PLEX_ADMIN_FIELDS) and await _owns_the_server(admin)
    _check_rules(patch, given, admin, owner)
    values = await _setting_values(patch, given)
    if values:
        if settings_store.settings_path() is None:
            raise _error(409, "no_storage", "This server has no data folder to save settings in")
        try:
            await config_apply.apply(values)
        except OSError as err:
            log.error("Settings not saved: {}", err)
            raise _error(500, "write_failed", "The settings couldn't be saved") from err
    if given & HOUSE_RULES:
        await app_settings.update(
            user_channel_selection=patch.user_channel_selection,
            presence_visible=patch.presence_visible,
            user=admin.sub,
        )
        if "presence_visible" in given:
            presence_broadcast.schedule_broadcast()
    log.bind(
        event="admin.config_changed", actor=admin.sub, fields=sorted(map(to_camel, given))
    ).info("Server settings changed by {}: {}", admin.sub, ", ".join(sorted(given)))
    return ConfigUpdateResponse(config=_config_response(), warnings=_warnings())


def _probe_values(kind: ProbeKind, provided: dict[str, str]) -> dict[str, str]:
    """The values a test runs with: the draft's, else the saved ones, secrets unwrapped."""
    _refuse_locked(set(provided))
    _refuse_stale_secrets(
        {field: value for field, value in provided.items() if field in SECRET_ADDRESSES.values()},
        set(provided) & set(SECRET_ADDRESSES),
    )
    values: dict[str, str] = {}
    for field in PROBE_FIELDS[kind]:
        if field in provided:
            values[field] = provided[field]
        else:
            saved = getattr(settings, field)
            values[field] = _plain(saved) if field in SECRET_FIELDS else str(saved or "")
    return values


@router.post("/config/test", response_model=ProbeResult)
async def test_config(
    request: ProbeRequest, admin: TokenPayload = Depends(require_admin)
) -> ProbeResult:
    """Test a connection with draft values. Always 200 with a verdict, once checked.

    Raises:
        HTTPException: 429 while the kind is cooling down (ntfy sends a real
            message); 409/422 as a save would refuse the values.
    """
    provided = {
        field: value
        for field, value in request.values.model_dump(exclude_unset=True, by_alias=False).items()
        if field in PROBE_FIELDS[request.kind] and value is not None
    }
    values = _probe_values(request.kind, provided)
    cooldown = PROBE_COOLDOWN_SECONDS.get(request.kind, 0.0)
    now = monotonic()
    if now - _last_probe.get(request.kind, -cooldown) < cooldown:
        raise _error(429, "busy", "Wait a moment before testing again")
    _last_probe[request.kind] = now
    return await config_probes.probe(request.kind, values)


@router.get("/plex/members", response_model=list[PlexMemberView])
async def get_plex_members(admin: TokenPayload = Depends(require_admin)) -> list[PlexMemberView]:
    """The linked Plex server's owner and members, marked with who is an admin here.

    Raises:
        HTTPException: 409 with no server linked; 400 when plex.tv refuses the
            saved token (link the server again); 503 when plex.tv doesn't answer.
    """
    token = _plain(settings.plex_server_token)
    machine_id = settings.plex_server_machine_id
    if not token or not machine_id:
        raise _error(409, "plex_not_linked", "No Plex server is linked")
    try:
        members = await plex.list_server_members(token, machine_id)
    except InvalidPlexTokenError as err:
        raise _error(400, "plex_token", "Plex no longer accepts the saved sign-in") from err
    except PlexUnavailableError as err:
        raise _error(503, "plex_unavailable", "Plex is not responding") from err
    admin_ids = set(settings.plex_admin_ids)
    admin_names = set(settings.plex_admin_users)
    return [
        PlexMemberView(
            plex_id=member.plex_id,
            username=member.username,
            managed=member.managed,
            owner=member.owner,
            admin=member.owner or member.plex_id in admin_ids or member.username in admin_names,
        )
        for member in members
    ]


@router.post("/plex/server", response_model=ConfigUpdateResponse)
async def link_plex_server(
    request: PlexServerLink, admin: TokenPayload = Depends(require_admin)
) -> ConfigUpdateResponse:
    """Link one of your own Plex servers, or link it again after its sign-in was revoked.

    Its owner (you) is added to the Plex admins by account id.

    Raises:
        HTTPException: 409 when sign-in is set in the environment; 400/503 for
            plex.tv; 403 for a server the Plex account doesn't own.
    """
    _refuse_locked({"plex_auth_enabled"})
    try:
        account = await plex.validate_plex_token(request.auth_token)
        servers = await plex.list_owned_servers(request.auth_token, count_members=False)
    except InvalidPlexTokenError as err:
        raise _error(400, "plex_token", "Plex didn't accept that sign-in") from err
    except PlexUnavailableError as err:
        raise _error(503, "plex_unavailable", "Plex is not responding") from err
    server = next((s for s in servers if s.machine_id == request.machine_id), None)
    if server is None:
        raise _error(403, "not_owner", "That Plex server isn't one of yours")
    admin_ids = list(dict.fromkeys([*settings.plex_admin_ids, account.id]))

    def record_name(draft: settings_store.SettingsDocument) -> None:
        draft.plex_server_name = server.name

    try:
        await config_apply.apply(
            {
                "plex_server_token": request.auth_token,
                "plex_server_machine_id": server.machine_id,
                "plex_admin_ids": admin_ids,
            },
            edit=record_name,
        )
    except OSError as err:
        log.error("Plex server link not saved: {}", err)
        raise _error(500, "write_failed", "The settings couldn't be saved") from err
    log.bind(event="admin.plex_linked", actor=admin.sub).info(
        "Plex server {} linked by {}", server.name, admin.sub
    )
    return ConfigUpdateResponse(config=_config_response(), warnings=_warnings())
