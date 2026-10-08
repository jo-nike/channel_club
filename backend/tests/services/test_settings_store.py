"""Settings saved from the UI: strict loading, env precedence and the signing key."""

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from loguru import logger
from pydantic import SecretStr

from app import config
from app.config import DEFAULT_JWT_SECRET, settings
from app.services import settings_store

if TYPE_CHECKING:
    from loguru import Record


@pytest.fixture
def state_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "state.json"
    monkeypatch.setattr(settings, "state_file", str(path))
    return path


@pytest.fixture
def settings_file(state_file: Path) -> Path:
    return state_file.with_name("settings.json")


@pytest.fixture
def no_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """A fresh container: nothing came from the environment, the key included."""
    monkeypatch.setattr(config, "ENV_FIELDS", frozenset())
    monkeypatch.setattr(settings, "jwt_secret", SecretStr(DEFAULT_JWT_SECRET))


@pytest.fixture
def records():
    captured: list[Record] = []
    handler_id = logger.add(lambda message: captured.append(message.record), level="DEBUG")
    yield captured
    logger.remove(handler_id)


def write_settings(path: Path, **document: Any) -> None:
    path.write_text(json.dumps({"version": 1, **document}))


def read_settings(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


class TestLoad:
    def test_a_missing_file_changes_nothing(self, settings_file: Path) -> None:
        before = settings.model_dump()

        settings_store.start()

        assert settings.model_dump() == before
        # The signing key came from the environment, so nothing needed saving
        assert not settings_file.exists()

    def test_saved_values_apply_except_in_groups_the_environment_locks(
        self, settings_file: Path
    ) -> None:
        # conftest: DISPATCHARR_URL came from the environment, which locks its key too
        write_settings(
            settings_file,
            values={
                "dispatcharr_url": "http://saved.example",
                "dispatcharr_api_key": "synthetic-saved-key",
                "chat_enabled": True,
                "media_process_limit": 3,
            },
        )

        settings_store.start()

        assert settings.dispatcharr_url == "http://dispatcharr.test:9191"
        assert settings.dispatcharr_api_key is None
        assert settings.chat_enabled is True
        assert settings.media_process_limit == 3

    @pytest.mark.parametrize(
        "content",
        [
            "{not json",
            "[1, 2]",
            json.dumps({"version": 2, "values": {}}),
            json.dumps({"values": {}}),
            json.dumps({"version": 1, "values": {"media_process_limit": "many"}}),
            json.dumps({"version": 1, "setup": {"claimedAt": "not a date"}}),
            json.dumps({"version": 1, "values": []}),
        ],
    )
    def test_a_corrupt_or_other_version_file_refuses_to_start(
        self, settings_file: Path, content: str
    ) -> None:
        settings_file.write_text(content)

        with pytest.raises(RuntimeError, match="settings.json"):
            settings_store.start()

    def test_the_refusal_names_the_field_but_never_echoes_a_secret(
        self, settings_file: Path
    ) -> None:
        write_settings(settings_file, values={"giphy_api_key": ["synthetic-leaked-secret"]})

        with pytest.raises(RuntimeError, match="giphy_api_key") as refused:
            settings_store.start()

        assert "synthetic-leaked-secret" not in str(refused.value)
        assert refused.value.__cause__ is None

    def test_values_this_build_does_not_know_are_kept_and_named(
        self, settings_file: Path, records: list["Record"]
    ) -> None:
        write_settings(settings_file, values={"future_knob": 7, "chat_enabled": True})

        settings_store.start()

        assert settings.chat_enabled is True
        assert any("future_knob" in r["message"] for r in records if r["level"].name == "WARNING")

    def test_state_file_named_settings_json_refuses_to_start(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "state_file", str(tmp_path / "settings.json"))

        with pytest.raises(RuntimeError, match="STATE_FILE"):
            settings_store.start()

    def test_without_a_state_file_nothing_is_read(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.chdir(tmp_path)
        (tmp_path / "settings.json").write_text("{not json")
        assert settings.state_file == ""

        settings_store.start()

        assert settings_store.setup_state() == "complete"

    def test_a_saved_log_level_reconfigures_logging(
        self, settings_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure = MagicMock()
        monkeypatch.setattr(settings_store, "configure_logging", configure)
        write_settings(settings_file, values={"log_level": "debug"})

        settings_store.start()

        assert settings.log_level == "DEBUG"
        configure.assert_called_once_with()

    def test_an_unchanged_log_level_leaves_logging_alone(
        self, settings_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configure = MagicMock()
        monkeypatch.setattr(settings_store, "configure_logging", configure)
        write_settings(settings_file, values={"log_level": settings.log_level})

        settings_store.start()

        configure.assert_not_called()


@pytest.mark.usefixtures("no_env")
class TestSigningKey:
    def test_a_key_is_generated_once_and_reused(
        self, settings_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        settings_store.start()

        saved = read_settings(settings_file)["signingKey"]
        assert len(saved) == 64 and int(saved, 16) >= 0
        assert settings.jwt_secret.get_secret_value() == saved
        assert settings_file.stat().st_mode & 0o777 == 0o600

        # A restart reads the same key and writes nothing
        written = settings_file.read_bytes()
        monkeypatch.setattr(settings, "jwt_secret", SecretStr(DEFAULT_JWT_SECRET))
        settings_store.reset_settings_store()
        settings_store.start()

        assert settings.jwt_secret.get_secret_value() == saved
        assert settings_file.read_bytes() == written

    def test_a_key_from_the_environment_writes_no_file(
        self, settings_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret"}))
        monkeypatch.setattr(settings, "jwt_secret", SecretStr("e" * 64))

        settings_store.start()

        assert settings.jwt_secret.get_secret_value() == "e" * 64
        assert not settings_file.exists()

    def test_an_unwritable_data_directory_refuses_to_start(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "state_file", str(tmp_path / "missing" / "state.json"))

        with pytest.raises(RuntimeError, match="uid 10001"):
            settings_store.start()

    def test_secrets_round_trip_in_plaintext(self, settings_file: Path) -> None:
        write_settings(settings_file, values={"giphy_api_key": "synthetic-giphy-key"})

        # Generating the key rewrites the whole document
        settings_store.start()

        saved = read_settings(settings_file)
        assert saved["values"]["giphy_api_key"] == "synthetic-giphy-key"
        assert "*****" not in settings_file.read_text()
        assert settings.giphy_api_key is not None
        assert settings.giphy_api_key.get_secret_value() == "synthetic-giphy-key"

    def test_the_state_file_is_left_alone(self, state_file: Path, settings_file: Path) -> None:
        state_file.write_text('{"version": 1, "liveChannelId": "uuid-1"}')
        before = state_file.read_bytes()

        settings_store.start()

        assert settings_file.exists()
        assert state_file.read_bytes() == before

    def test_preflight_passes_on_a_generated_key(self, settings_file: Path) -> None:
        from app.main import preflight

        preflight()

        assert settings.jwt_secret.get_secret_value() == read_settings(settings_file)["signingKey"]

    def test_preflight_without_a_state_file_still_refuses_the_placeholder_key(self) -> None:
        from app.main import preflight

        with pytest.raises(RuntimeError, match="JWT_SECRET"):
            preflight()


class TestSetupState:
    def test_no_state_file_counts_as_complete(self) -> None:
        assert settings.state_file == ""
        assert settings_store.setup_state() == "complete"

    @pytest.mark.parametrize("field", ["local_auth_enabled", "plex_auth_enabled", "admin_password"])
    def test_auth_from_the_environment_counts_as_complete(
        self, state_file: Path, monkeypatch: pytest.MonkeyPatch, field: str
    ) -> None:
        monkeypatch.setattr(config, "ENV_FIELDS", config.ENV_FIELDS | {field})
        settings_store.start()

        assert settings_store.auth_env_managed() is True
        assert settings_store.setup_state() == "complete"

    @pytest.mark.parametrize(
        ("setup", "state"),
        [
            ({}, "unclaimed"),
            ({"claimedAt": "2026-09-29T12:00:00Z", "claimedBy": "jon"}, "claimed"),
            (
                {"claimedAt": "2026-09-29T12:00:00Z", "completedAt": "2026-09-29T12:05:00Z"},
                "complete",
            ),
        ],
    )
    def test_the_saved_progress_decides(
        self, settings_file: Path, setup: dict[str, str], state: str
    ) -> None:
        write_settings(settings_file, setup=setup)
        settings_store.start()

        assert settings_store.setup_state() == state

    def test_an_open_setup_is_announced_at_every_boot(
        self, settings_file: Path, records: list["Record"]
    ) -> None:
        settings_store.start()

        opened = [r for r in records if r["extra"].get("event") == "setup.open"]
        assert len(opened) == 1 and opened[0]["level"].name == "WARNING"
        # No state file yet, so this isn't an install that lost its auth settings
        assert not [r for r in records if "auth variables are missing" in r["message"]]

    def test_an_open_setup_beside_an_old_state_file_warns_twice(
        self, state_file: Path, records: list["Record"]
    ) -> None:
        state_file.write_text("{}")

        settings_store.start()

        assert [r for r in records if "auth variables are missing" in r["message"]]


@pytest.mark.usefixtures("settings_file")
class TestEdit:
    @pytest.fixture(autouse=True)
    def unlocked(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret"}))

    async def test_changes_are_written_then_applied(self, settings_file: Path) -> None:
        async with settings_store.edit() as draft:
            draft.values["zipline_token"] = "synthetic-zipline-token"
            draft.values["media_export_limit"] = "3"
            draft.plex_server_name = "Home"

        saved = read_settings(settings_file)
        assert saved["values"] == {
            "zipline_token": "synthetic-zipline-token",
            "media_export_limit": 3,
        }
        assert saved["plexServerName"] == "Home"
        assert settings.zipline_token.get_secret_value() == "synthetic-zipline-token"
        assert settings.media_export_limit == 3

    async def test_an_invalid_value_writes_and_applies_nothing(self, settings_file: Path) -> None:
        with pytest.raises(settings_store.InvalidSettingError) as refused:
            async with settings_store.edit() as draft:
                draft.values["chat_enabled"] = True
                draft.values["media_export_limit"] = "many"

        assert refused.value.field == "media_export_limit"
        assert not settings_file.exists()
        assert settings.chat_enabled is False

    async def test_a_name_the_ui_cannot_set_is_refused(self) -> None:
        with pytest.raises(settings_store.InvalidSettingError, match="jwt_secret"):
            async with settings_store.edit() as draft:
                draft.values["jwt_secret"] = "x" * 64

    async def test_a_failed_write_applies_nothing(
        self, settings_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def fail(path: Path, document: dict[str, Any]) -> None:
            raise OSError("read-only file system")

        monkeypatch.setattr(settings_store, "write_json_atomic", fail)
        with pytest.raises(OSError):
            async with settings_store.edit() as draft:
                draft.values["chat_enabled"] = True
                draft.setup.claimed_by = "jon"

        assert settings.chat_enabled is False
        assert settings_store.setup_state() == "unclaimed"

    async def test_raising_inside_the_block_writes_nothing(self, settings_file: Path) -> None:
        with pytest.raises(LookupError):
            async with settings_store.edit() as draft:
                draft.values["chat_enabled"] = True
                raise LookupError

        assert not settings_file.exists()
        assert settings.chat_enabled is False

    async def test_values_in_a_locked_group_are_saved_but_not_applied(
        self, settings_file: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(config, "ENV_FIELDS", frozenset({"jwt_secret", "ntfy_url"}))

        async with settings_store.edit() as draft:
            draft.values["ntfy_topic"] = "synthetic-topic"

        assert read_settings(settings_file)["values"]["ntfy_topic"] == "synthetic-topic"
        assert settings.ntfy_topic == ""

    async def test_unknown_saved_values_survive_an_edit(self, settings_file: Path) -> None:
        write_settings(settings_file, values={"future_knob": 7})
        settings_store.start()

        async with settings_store.edit() as draft:
            draft.values["chat_enabled"] = True

        assert read_settings(settings_file)["values"] == {"future_knob": 7, "chat_enabled": True}


def test_startup_applies_the_saved_settings_before_anything_reads_them(
    settings_file: Path,
) -> None:
    from app.main import app

    write_settings(settings_file, values={"chat_enabled": True})

    with (
        patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
        TestClient(app) as client,
    ):
        assert settings.chat_enabled is True
        assert client.get("/api/health").status_code == 200
