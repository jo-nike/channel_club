"""Feedback service: sanitizing, per-user limits, message composition, delivery."""

from datetime import UTC, datetime

import httpx
import pytest
from fastapi import HTTPException

from app.config import settings
from app.models.feedback import FeedbackContext
from app.services import feedback


@pytest.fixture(autouse=True)
def clean_limiter():
    feedback.reset()
    yield
    feedback.reset()


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "ntfy_enabled", True)
    monkeypatch.setattr(settings, "ntfy_url", "https://ntfy.test")
    monkeypatch.setattr(settings, "ntfy_topic", "club-feedback")
    monkeypatch.setattr(settings, "ntfy_token", "synthetic-secret")
    monkeypatch.setattr(settings, "feedback_cooldown_seconds", 30)
    monkeypatch.setattr(settings, "feedback_hourly_limit", 3)


class TestSanitizeText:
    def test_whitespace_only_becomes_empty(self):
        assert feedback.sanitize_text("  \n\t \r\n ", 100) == ""

    def test_control_characters_are_dropped_but_newlines_kept(self):
        assert feedback.sanitize_text("a\x00b\x07c\r\nd\x1b[31m", 100) == "abc\nd[31m"

    def test_excess_blank_lines_collapse(self):
        assert feedback.sanitize_text("one\n\n\n\n\ntwo", 100) == "one\n\ntwo"

    def test_single_line_mode_flattens_newlines(self):
        assert feedback.sanitize_text("me@\nexample\t.com", 100, multiline=False) == (
            "me@ example .com"
        )

    def test_truncation_marks_the_cut(self):
        assert feedback.sanitize_text("abcdefghij", 5) == "abcd…"

    def test_nfc_normalization(self):
        assert feedback.sanitize_text("é", 10) == "é"


class TestRateLimit:
    def test_cooldown_blocks_rapid_repeat(self, configured):
        feedback.reserve("alice", now=100.0)
        with pytest.raises(HTTPException) as info:
            feedback.reserve("alice", now=110.0)
        assert info.value.status_code == 429
        assert info.value.headers == {"Retry-After": "20"}
        assert "20s" in info.value.detail

    def test_allowed_again_after_cooldown(self, configured):
        feedback.reserve("alice", now=100.0)
        feedback.reserve("alice", now=131.0)

    def test_hourly_cap(self, configured):
        for offset in (0.0, 60.0, 120.0):
            feedback.reserve("alice", now=offset)
        with pytest.raises(HTTPException) as info:
            feedback.reserve("alice", now=1000.0)
        assert info.value.status_code == 429
        # Wait until the oldest hit leaves the hour window.
        assert info.value.headers == {"Retry-After": "2600"}

    def test_pruning_frees_the_cap(self, configured):
        for offset in (0.0, 60.0, 120.0):
            feedback.reserve("alice", now=offset)
        feedback.reserve("alice", now=3601.0)

    def test_users_are_isolated(self, configured):
        feedback.reserve("alice", now=100.0)
        feedback.reserve("bob", now=101.0)

    def test_release_restores_the_slot(self, configured):
        feedback.reserve("alice", now=100.0)
        feedback.release("alice")
        feedback.reserve("alice", now=101.0)

    def test_release_without_reservation_is_harmless(self):
        feedback.release("nobody")


class TestBuildMessage:
    def build(self, kind="bug", **overrides):
        args = {
            "kind": kind,
            "message": "The guide is blank",
            "contact": "",
            "username": "alice",
            "role": "viewer",
            "context": FeedbackContext(),
            "sent_at": datetime(2026, 9, 8, 14, 3, 22, tzinfo=UTC),
        }
        args.update(overrides)
        return feedback.build_message(**args)

    @pytest.mark.parametrize(
        "kind,title,tags,priority",
        [
            ("bug", "Bug report", "bug,channel-club", "4"),
            ("suggestion", "Suggestion", "bulb,channel-club", "3"),
            ("other", "Feedback", "speech_balloon,channel-club", "3"),
        ],
    )
    def test_kind_drives_title_tags_priority(self, kind, title, tags, priority):
        message = self.build(kind=kind)
        assert message.title == f"[Channel Club] {title} from alice"
        assert message.tags == tags
        assert message.priority == priority

    def test_headers_stay_ascii_for_non_ascii_usernames(self):
        message = self.build(username="Zoë 🎉 Ünal")
        assert message.title == "[Channel Club] Bug report from Zoe Unal"
        assert message.title.isascii()
        assert "Zoë 🎉 Ünal" in message.body

    def test_unusable_username_gets_a_fallback_title(self):
        assert self.build(username="🎉").title == "[Channel Club] Bug report from a viewer"

    def test_body_carries_message_and_diagnostics(self, monkeypatch):
        monkeypatch.setattr(settings, "app_build_id", "42")
        monkeypatch.setattr(settings, "app_revision", "abc123")
        context = FeedbackContext(
            user_agent="Mozilla/5.0 Test",
            viewport="1440x900",
            path="/tv",
            session_id="3fa9c1d2",
            app_version="1.0.0",
        )
        message = self.build(contact="me@example.com", role="admin", context=context)
        assert message.body.startswith("The guide is blank\n\n")
        assert "From: alice (admin)" in message.body
        assert "Contact: me@example.com" in message.body
        assert "build 42 (abc123); web 1.0.0" in message.body
        assert "View: /tv  Session: 3fa9c1d2" in message.body
        assert "Client: Mozilla/5.0 Test  Viewport: 1440x900" in message.body
        assert "Sent: 2026-09-08 14:03:22 UTC" in message.body

    def test_missing_context_uses_placeholders(self):
        body = self.build().body
        assert "Contact: not provided" in body
        assert "View: /  Session: unknown" in body
        assert "Client: unknown  Viewport: unknown" in body

    def test_body_is_bounded_in_bytes_and_keeps_footer(self):
        message = self.build(message="🎉" * 2000)  # 8000 bytes of multibyte text
        assert len(message.body.encode("utf-8")) <= feedback.MAX_BODY_BYTES
        assert "…\n\nFrom: alice (viewer)" in message.body
        assert message.body.endswith("Sent: 2026-09-08 14:03:22 UTC")


def _message() -> feedback.NtfyMessage:
    return feedback.NtfyMessage(
        title="[Channel Club] Bug report", body="hi", tags="bug", priority="4"
    )


class TestPublish:
    async def test_disabled_never_contacts_ntfy(self):
        with pytest.raises(HTTPException) as info:
            await feedback.publish(_message())
        assert info.value.status_code == 503

    async def test_posts_headers_and_body_to_topic(self, configured):
        seen = []

        async def handler(request):
            seen.append(request)
            return httpx.Response(200, json={"id": "x"})

        await feedback.publish(
            feedback.NtfyMessage(
                title="[Channel Club] Bug report from alice",
                body="Zoë says hi\n\nFrom: Zoë (viewer)",
                tags="bug,channel-club",
                priority="4",
            ),
            transport=httpx.MockTransport(handler),
        )
        assert len(seen) == 1
        request = seen[0]
        assert request.method == "POST"
        assert request.url == "https://ntfy.test/club-feedback"
        assert request.headers["Title"] == "[Channel Club] Bug report from alice"
        assert request.headers["Tags"] == "bug,channel-club"
        assert request.headers["Priority"] == "4"
        assert request.headers["Authorization"] == "Bearer synthetic-secret"
        assert request.headers["Content-Type"] == "text/plain; charset=utf-8"
        assert request.content.decode("utf-8") == "Zoë says hi\n\nFrom: Zoë (viewer)"

    async def test_no_authorization_header_without_token(self, configured, monkeypatch):
        monkeypatch.setattr(settings, "ntfy_token", "  ")
        seen = []

        async def handler(request):
            seen.append(request)
            return httpx.Response(200)

        await feedback.publish(_message(), transport=httpx.MockTransport(handler))
        assert "authorization" not in seen[0].headers

    @pytest.mark.parametrize(
        "status,expected",
        [(401, 502), (403, 502), (400, 502), (413, 502), (429, 429), (302, 502), (500, 502)],
    )
    async def test_upstream_failures_are_mapped_without_leaking(self, configured, status, expected):
        async def handler(request):
            return httpx.Response(status, text="synthetic-secret leaked?")

        with pytest.raises(HTTPException) as info:
            await feedback.publish(_message(), transport=httpx.MockTransport(handler))
        assert info.value.status_code == expected
        assert "synthetic-secret" not in info.value.detail
        assert "ntfy.test" not in info.value.detail

    async def test_timeout_maps_to_504(self, configured):
        async def handler(request):
            raise httpx.ReadTimeout("slow")

        with pytest.raises(HTTPException) as info:
            await feedback.publish(_message(), transport=httpx.MockTransport(handler))
        assert info.value.status_code == 504

    async def test_connection_error_maps_to_502(self, configured):
        async def handler(request):
            raise httpx.ConnectError("refused")

        with pytest.raises(HTTPException) as info:
            await feedback.publish(_message(), transport=httpx.MockTransport(handler))
        assert info.value.status_code == 502
