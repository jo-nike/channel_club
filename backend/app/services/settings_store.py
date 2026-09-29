"""Settings saved from the UI, in settings.json beside the state file.

Precedence is the environment, then this file, then the code defaults. An
environment variable locks its whole group (config.FIELD_GROUPS), so the file's
values for that group are kept but not applied. The document is {version,
setup: {claimedAt, claimedBy, completedAt}, signingKey, plexServerName, values:
{field: value}}. Secrets are stored in plaintext (the file is mode 0600) and
never sent to browsers.

It fails closed: a corrupt or unknown-version file stops startup instead of
falling back to defaults, which would reopen setup to the first visitor. Without
a state file nothing is read or written, and setup counts as complete.
"""

import asyncio
import json
import secrets
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from loguru import logger
from pydantic import Field, SecretStr, ValidationError

from app import config
from app.config import FIELD_GROUPS, UI_FIELDS, env_name, settings
from app.logging_config import configure_logging
from app.models.base import CamelModel
from app.services.state_store import write_json_atomic

# Module-level logger with service context
log = logger.bind(service="settings_store")

SETTINGS_VERSION = 1
SETTINGS_FILE_NAME = "settings.json"

SetupState = Literal["unclaimed", "claimed", "complete"]

# Each field's group, for the environment's locks
GROUP_OF = {field: group for group, fields in FIELD_GROUPS.items() for field in fields}


class SetupProgress(CamelModel):
    """When the first visitor claimed the club, and when they finished setup."""

    claimed_at: datetime | None = None
    claimed_by: str | None = None
    completed_at: datetime | None = None


class SettingsDocument(CamelModel):
    """The saved file. Values the UI saved are kept as they would be assigned
    (secrets as SecretStr); a value this build doesn't know is kept as read."""

    version: int
    setup: SetupProgress = Field(default_factory=SetupProgress)
    signing_key: SecretStr | None = None
    plex_server_name: str | None = None
    values: dict[str, Any] = Field(default_factory=dict)


class InvalidSettingError(ValueError):
    """A value that its setting would refuse."""

    def __init__(self, field: str) -> None:
        super().__init__(f"Invalid value for {field}")
        self.field = field


# The loaded or last saved document; None until a file exists (reset_settings_store)
_document: SettingsDocument | None = None
# Created on first edit, so it binds to the running loop
_lock: asyncio.Lock | None = None


def settings_path() -> Path | None:
    """The settings file, beside the state file; None when there is no state file."""
    if not settings.state_file:
        return None
    return Path(settings.state_file).with_name(SETTINGS_FILE_NAME)


def locked_groups() -> dict[str, list[str]]:
    """Each group the environment locks, with the variables that lock it."""
    locked: dict[str, list[str]] = {}
    for group, fields in FIELD_GROUPS.items():
        names = [env_name(field) for field in fields if field in config.ENV_FIELDS]
        if names:
            locked[group] = names
    return locked


def auth_env_managed() -> bool:
    """True when any auth variable comes from the environment: then setup never opens."""
    return "auth" in locked_groups()


def setup_state() -> SetupState:
    """Whether the first-run setup is waiting for a visitor, under way, or done.

    Auth from the environment (production) and a server without a state file
    count as complete: there is nowhere for setup to save to, or nothing for it to do.
    """
    if not settings.state_file or auth_env_managed():
        return "complete"
    progress = _document.setup if _document is not None else SetupProgress()
    if progress.claimed_at is None:
        return "unclaimed"
    if progress.completed_at is None:
        return "claimed"
    return "complete"


def validate_values(changes: Mapping[str, object]) -> dict[str, object]:
    """Coerce and check each value as assigning it to the settings would.

    Nothing is assigned to the settings themselves, so a batch either passes
    whole or changes nothing.

    Returns:
        The values as they would be stored (e.g. a secret as SecretStr).

    Raises:
        InvalidSettingError: For the first value its setting refuses, or a name
            that is not a UI setting.
    """
    candidate = settings.model_copy()
    validated: dict[str, object] = {}
    for field, value in changes.items():
        if field not in UI_FIELDS:
            raise InvalidSettingError(field)
        try:
            setattr(candidate, field, value)
        except ValidationError:
            # Not chained: the validation error echoes the input, which may be a secret
            raise InvalidSettingError(field) from None
        validated[field] = getattr(candidate, field)
    return validated


def _plain(value: object) -> object:
    return value.get_secret_value() if isinstance(value, SecretStr) else value


def _serialise(document: SettingsDocument) -> dict[str, Any]:
    """The document as JSON. Secrets are unwrapped here: model_dump would write asterisks."""
    data = document.model_dump(mode="json", exclude={"signing_key", "values"})
    data["signingKey"] = _plain(document.signing_key)
    data["values"] = {field: _plain(value) for field, value in document.values.items()}
    return data


def _load(path: Path) -> SettingsDocument | None:
    """Read the file strictly: None when missing, RuntimeError when unusable."""
    recovery = (
        f"Fix or restore {path} and start again. Deleting it reopens setup to the first "
        "visitor and signs everyone out."
    )
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise RuntimeError(f"Cannot read {path}: {exc}. {recovery}") from exc
    except ValueError as exc:
        raise RuntimeError(f"{path} is not valid JSON ({exc}). {recovery}") from exc
    version = raw.get("version") if isinstance(raw, dict) else None
    if version != SETTINGS_VERSION:
        raise RuntimeError(
            f"{path} has version {version!r}, and this build reads version "
            f"{SETTINGS_VERSION}. {recovery}"
        )
    try:
        document = SettingsDocument.model_validate(raw)
    except ValidationError as exc:
        # Names only: a validation error echoes the input, which may be a secret
        where = sorted({".".join(str(part) for part in error["loc"]) for error in exc.errors()})
        raise RuntimeError(f"{path} is damaged ({', '.join(where)}). {recovery}") from None
    unknown = sorted(field for field in document.values if field not in UI_FIELDS)
    if unknown:
        log.warning("{} has settings this build doesn't use: {}", path, ", ".join(unknown))
    known = {field: value for field, value in document.values.items() if field in UI_FIELDS}
    try:
        document.values.update(validate_values(known))
    except InvalidSettingError as exc:
        raise RuntimeError(f"{path} has an invalid value for {exc.field}. {recovery}") from None
    return document


def _apply(values: Mapping[str, object]) -> None:
    """Set saved values on the singleton, skipping groups the environment locks.

    Every module holds a reference to the one settings object, so it is changed
    in place. The values were validated already, so no assignment can fail halfway.
    """
    locked = locked_groups()
    for field, value in values.items():
        if field in UI_FIELDS and GROUP_OF[field] not in locked:
            setattr(settings, field, value)


def _ensure_signing_key(path: Path) -> None:
    """Load the saved signing key, generating and saving one first if there is none.

    A key from the environment is left alone (validate_auth_configuration checks
    it as before). The key is saved before the app serves, so sessions survive a
    restart; if it can't be saved, startup stops rather than sign everyone out
    on every restart.
    """
    global _document
    if "jwt_secret" in config.ENV_FIELDS:
        return
    document = _document or SettingsDocument(version=SETTINGS_VERSION)
    key = document.signing_key
    if key is None:
        key = SecretStr(secrets.token_hex(32))
        document = document.model_copy(update={"signing_key": key})
        try:
            write_json_atomic(path, _serialise(document))
        except OSError as exc:
            raise RuntimeError(
                f"Cannot save a signing key to {path} ({exc}). The data directory must be "
                "writable by the app's user: chown it to uid 10001, or set JWT_SECRET."
            ) from exc
        log.info("Generated a signing key and saved it to {}", path)
    _document = document
    settings.jwt_secret = key


def _log_setup_state() -> None:
    if setup_state() != "unclaimed":
        return
    log.bind(event="setup.open").warning(
        "Setup is open: the first visitor to /setup becomes the admin. Finish setup, "
        "or set the auth variables in the environment"
    )
    if Path(settings.state_file).exists():
        log.warning(
            "{} exists but no auth is configured: if this server was set up before, "
            "its auth variables are missing from the environment",
            settings.state_file,
        )


def start() -> None:
    """Load the saved settings and apply them, then make sure a signing key exists.

    The first lifespan step, and part of main.preflight(). Values in groups the
    environment locks stay as the environment set them.

    Raises:
        RuntimeError: If the file is unreadable, corrupt or another version, if
            STATE_FILE is the settings file itself, or if a new signing key
            can't be saved.
    """
    global _document
    _document = None
    path = settings_path()
    if path is None:
        return
    if path == Path(settings.state_file):
        raise RuntimeError(
            f"STATE_FILE must not be named {SETTINGS_FILE_NAME}: that name is kept for the "
            "settings saved from the app. Use e.g. /data/state.json."
        )
    level = settings.log_level
    _document = _load(path)
    if _document is not None:
        _apply(_document.values)
        for group, names in locked_groups().items():
            if any(GROUP_OF.get(field) == group for field in _document.values):
                log.info("Saved {} settings are not used: {} is set", group, ", ".join(names))
    _ensure_signing_key(path)
    if settings.log_level != level:
        configure_logging()
    _log_setup_state()


@asynccontextmanager
async def edit() -> AsyncIterator[SettingsDocument]:
    """Change the saved settings under the store's lock.

    Yields a copy of the document to change in place. On a clean exit the new
    and changed values are validated (InvalidSettingError, nothing written), the
    file is written (OSError, nothing applied), and then every changed value is
    set on the singleton with no await in between. Raising inside the block
    writes nothing. Values are only added or changed, never removed.

    Raises:
        RuntimeError: Without a state file there is nowhere to save.
    """
    global _document, _lock
    path = settings_path()
    if path is None:
        raise RuntimeError("Settings can't be saved without a STATE_FILE")
    if _lock is None:
        _lock = asyncio.Lock()
    async with _lock:
        current = _document or SettingsDocument(version=SETTINGS_VERSION)
        draft = current.model_copy(deep=True)
        yield draft
        changed = {
            field: value
            for field, value in draft.values.items()
            if field not in current.values or current.values[field] != value
        }
        draft.values.update(validate_values(changed))
        await asyncio.to_thread(write_json_atomic, path, _serialise(draft))
        _document = draft
        _apply({field: draft.values[field] for field in changed})


def reset_settings_store() -> None:
    """Forget the document and lock (each test runs on a fresh loop)."""
    global _document, _lock
    _document = None
    _lock = None
