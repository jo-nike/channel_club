"""ErsatzTV stream session registry (H-01) and the account key it is keyed on."""

from datetime import UTC, datetime

import pytest

from app.models.auth import TokenPayload, account_key
from app.services import stream_sessions
from app.services.chat import user_id_for
from app.services.stream_sessions import (
    STREAM_SESSION_IDLE_SECONDS,
    STREAM_SESSIONS_MAX,
    STREAM_SESSIONS_PER_ACCOUNT,
    StreamSessionLimitError,
)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """The registry's clock, moved by assigning now[0]."""
    now = [1000.0]
    monkeypatch.setattr(stream_sessions, "monotonic", lambda: now[0])
    return now


class TestAccountKey:
    def test_plex_account_is_keyed_on_its_plex_id(self) -> None:
        assert account_key("alice", "12345") == "plex:12345"

    def test_local_account_is_keyed_on_its_username(self) -> None:
        assert account_key("bob", None) == "local:bob"

    def test_token_payload_property(self) -> None:
        exp = datetime.now(UTC)
        assert TokenPayload(sub="a", role="viewer", exp=exp, plex_id="9").account_key == "plex:9"
        assert TokenPayload(sub="a", role="viewer", exp=exp).account_key == "local:a"

    def test_chat_user_id_is_unchanged(self) -> None:
        """Pinned from the code before user_id_for used account_key."""
        assert user_id_for("alice", "12345") == "u_3aa8b9e2e397bb47"
        assert user_id_for("bob", None) == "u_b7880558ba2806a7"


class TestStreamSessions:
    def test_create_returns_a_32_character_url_safe_id(self, clock: list[float]) -> None:
        session = stream_sessions.create("local:a", "8")
        assert len(session.id) == 32
        assert set(session.id) <= set(
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        )
        assert stream_sessions.get(session.id) is session
        assert session.channel_id == "8"
        assert session.account == "local:a"

    def test_unknown_id_is_none(self) -> None:
        assert stream_sessions.get("x" * 32) is None

    def test_idle_session_expires(self, clock: list[float]) -> None:
        session = stream_sessions.create("local:a", "8")
        clock[0] += STREAM_SESSION_IDLE_SECONDS
        assert stream_sessions.get(session.id) is None
        clock[0] -= STREAM_SESSION_IDLE_SECONDS
        assert stream_sessions.get(session.id) is None  # dropped, not just hidden

    def test_use_keeps_a_session_alive(self, clock: list[float]) -> None:
        session = stream_sessions.create("local:a", "8")
        for _ in range(5):
            clock[0] += 200
            assert stream_sessions.get(session.id) is session

    def test_manifest_path(self) -> None:
        assert stream_sessions.manifest_path("abc") == "/api/ersatztv/s/abc/stream.m3u8"

    def test_per_account_cap_evicts_that_accounts_least_recently_used(
        self, clock: list[float]
    ) -> None:
        other = stream_sessions.create("local:other", "1")
        own = []
        for _ in range(STREAM_SESSIONS_PER_ACCOUNT):
            clock[0] += 1
            own.append(stream_sessions.create("local:a", "8"))
        clock[0] += 1
        assert stream_sessions.get(own[0].id) is own[0]  # now own[1] is the LRU
        clock[0] += 1
        newest = stream_sessions.create("local:a", "8")

        assert stream_sessions.get(own[1].id) is None
        assert stream_sessions.get(own[0].id) is own[0]
        assert all(stream_sessions.get(s.id) is s for s in own[2:])
        assert stream_sessions.get(newest.id) is newest
        assert stream_sessions.get(other.id) is other

    def test_global_cap_raises_until_a_session_expires(self, clock: list[float]) -> None:
        for n in range(STREAM_SESSIONS_MAX):
            stream_sessions.create(f"local:{n}", "8")
        with pytest.raises(StreamSessionLimitError):
            stream_sessions.create("local:late", "8")

        clock[0] += STREAM_SESSION_IDLE_SECONDS
        assert stream_sessions.create("local:late", "8").account == "local:late"

    def test_clear_forgets_every_session(self) -> None:
        session = stream_sessions.create("local:a", "8")
        stream_sessions.clear()
        assert stream_sessions.get(session.id) is None

    def test_logs_never_carry_a_whole_id(self, clock: list[float]) -> None:
        from loguru import logger

        lines: list[str] = []
        ids: list[str] = []
        sink = logger.add(lines.append, level="DEBUG", format="{message}")
        try:
            for _ in range(STREAM_SESSIONS_PER_ACCOUNT + 1):
                clock[0] += 1
                ids.append(stream_sessions.create("local:a", "8").id)
        finally:
            logger.remove(sink)
        assert any("Evicted" in line for line in lines)
        assert any(ids[0][:8] in line for line in lines)
        assert not any(sid in line for sid in ids for line in lines)
