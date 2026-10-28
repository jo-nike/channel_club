"""Feedback router: gating, validation, limits, delivery, and secret hygiene."""

from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.services import feedback
from app.services.auth import create_access_token


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def auth_header() -> dict[str, str]:
    token = create_access_token({"sub": "testuser", "role": "viewer"})
    return {"Authorization": f"Bearer {token}"}


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
    monkeypatch.setattr(settings, "feedback_hourly_limit", 10)


def ntfy(handler):
    """Patch the service's client so every publish goes through `handler`."""
    real_client = httpx.AsyncClient
    return patch(
        "app.services.feedback.httpx.AsyncClient",
        side_effect=lambda **kw: real_client(**{**kw, "transport": httpx.MockTransport(handler)}),
    )


REPORT = {
    "type": "bug",
    "message": "The guide is blank after refresh",
    "contact": "me@example.com",
    "context": {
        "userAgent": "Mozilla/5.0 Test",
        "viewport": "1440x900",
        "path": "/tv",
        "sessionId": "3fa9c1d2",
        "appVersion": "1.0.0",
    },
}


class TestFeature:
    def test_requires_authentication(self, client):
        assert client.get("/api/feedback/feature").status_code == 401

    @pytest.mark.parametrize(
        "flag,url,topic,available",
        [
            (False, "", "", False),
            (False, "https://ntfy.test", "club", False),
            (True, "", "club", False),
            (True, "https://ntfy.test", "", False),
            (True, "https://ntfy.test", "../admin", False),
            (True, "https://ntfy.test", "club feedback", False),
            (True, "not a url", "club", False),
            (True, "https://user:pw@ntfy.test", "club", False),
            (True, "https://ntfy.test/?x=1", "club", False),
            (True, "https://ntfy.test", "club-feedback_1", True),
            (True, "http://10.0.0.5:8090", "club", True),
        ],
    )
    def test_flag_and_configuration_gate_the_feature(
        self, client, auth_header, monkeypatch, flag, url, topic, available
    ):
        monkeypatch.setattr(settings, "ntfy_enabled", flag)
        monkeypatch.setattr(settings, "ntfy_url", url)
        monkeypatch.setattr(settings, "ntfy_topic", topic)
        monkeypatch.setattr(settings, "ntfy_token", "synthetic-secret")
        response = client.get("/api/feedback/feature", headers=auth_header)
        assert response.status_code == 200
        assert response.json() == {"enabled": available}
        assert "synthetic-secret" not in response.text
        assert "ntfy.test" not in response.text

    def test_token_is_optional(self, client, auth_header, configured, monkeypatch):
        monkeypatch.setattr(settings, "ntfy_token", "")
        response = client.get("/api/feedback/feature", headers=auth_header)
        assert response.json() == {"enabled": True}


class TestSubmit:
    def test_requires_authentication(self, client):
        assert client.post("/api/feedback", json=REPORT).status_code == 401

    def test_disabled_returns_503_without_contacting_ntfy(self, client, auth_header):
        def handler(request):
            raise AssertionError("ntfy must not be contacted while disabled")

        with ntfy(handler):
            response = client.post("/api/feedback", json=REPORT, headers=auth_header)
        assert response.status_code == 503

    @pytest.mark.parametrize(
        "body",
        [
            {**REPORT, "type": "praise"},
            {**REPORT, "message": ""},
            {**REPORT, "message": "x" * 2001},
            {**REPORT, "contact": "x" * 201},
            {**REPORT, "context": {**REPORT["context"], "extra": "nope"}},
            {**REPORT, "context": {**REPORT["context"], "userAgent": "x" * 2001}},
            {**REPORT, "surprise": True},
            {k: v for k, v in REPORT.items() if k != "message"},
        ],
    )
    def test_invalid_bodies_are_rejected(self, client, auth_header, configured, body):
        def handler(request):
            raise AssertionError("ntfy must not be contacted for invalid input")

        with ntfy(handler):
            response = client.post("/api/feedback", json=body, headers=auth_header)
        assert response.status_code == 422

    def test_whitespace_only_message_is_rejected(self, client, auth_header, configured):
        def handler(request):
            raise AssertionError("ntfy must not be contacted for an empty message")

        with ntfy(handler):
            response = client.post(
                "/api/feedback", json={**REPORT, "message": " \n\t "}, headers=auth_header
            )
        assert response.status_code == 422
        assert response.json()["detail"] == "Message is empty"

    def test_delivers_report_with_diagnostics(self, client, auth_header, configured):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200, json={"id": "x"})

        with ntfy(handler):
            response = client.post("/api/feedback", json=REPORT, headers=auth_header)
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        assert len(seen) == 1
        request = seen[0]
        assert request.url == "https://ntfy.test/club-feedback"
        assert request.headers["Authorization"] == "Bearer synthetic-secret"
        assert request.headers["Title"] == "[Channel Club] Bug report from testuser"
        assert request.headers["Priority"] == "4"
        assert request.headers["Tags"] == "bug,channel-club"
        body = request.content.decode("utf-8")
        assert body.startswith("The guide is blank after refresh\n\n")
        assert "From: testuser (viewer)" in body
        assert "Contact: me@example.com" in body
        assert "View: /tv  Session: 3fa9c1d2" in body
        assert "Client: Mozilla/5.0 Test  Viewport: 1440x900" in body
        assert "web 1.0.0" in body

    def test_long_user_agent_is_truncated_not_rejected(self, client, auth_header, configured):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        long_ua = "Mozilla/5.0 " + "x" * 289  # 301 characters, past the 300 display cap
        body = {**REPORT, "context": {**REPORT["context"], "userAgent": long_ua}}
        with ntfy(handler):
            response = client.post("/api/feedback", json=body, headers=auth_header)
        assert response.status_code == 200
        sent = seen[0].content.decode("utf-8")
        assert f"Client: {long_ua[:299]}…  Viewport: 1440x900" in sent

    def test_context_is_optional(self, client, auth_header, configured):
        seen = []

        def handler(request):
            seen.append(request)
            return httpx.Response(200)

        with ntfy(handler):
            response = client.post(
                "/api/feedback",
                json={"type": "suggestion", "message": "Add a sleep timer"},
                headers=auth_header,
            )
        assert response.status_code == 200
        body = seen[0].content.decode("utf-8")
        assert "Contact: not provided" in body
        assert "Client: unknown  Viewport: unknown" in body

    def test_cooldown_returns_429_with_retry_after(self, client, auth_header, configured):
        calls = []

        def handler(request):
            calls.append(request)
            return httpx.Response(200)

        with ntfy(handler):
            first = client.post("/api/feedback", json=REPORT, headers=auth_header)
            second = client.post("/api/feedback", json=REPORT, headers=auth_header)
        assert first.status_code == 200
        assert second.status_code == 429
        assert second.headers["Retry-After"] == "30"
        assert "wait" in second.json()["detail"]
        assert len(calls) == 1

    def test_a_plex_account_named_like_a_local_one_has_its_own_quota(self, client, configured):
        local = create_access_token({"sub": "admin", "role": "admin"})
        plex = create_access_token({"sub": "admin", "role": "viewer", "plex_id": "7"})
        with ntfy(lambda request: httpx.Response(200)):
            for token in (local, plex):
                response = client.post(
                    "/api/feedback", json=REPORT, headers={"Authorization": f"Bearer {token}"}
                )
                assert response.status_code == 200

    @pytest.mark.parametrize(
        "status,expected",
        [(401, 502), (403, 502), (400, 502), (413, 502), (429, 429), (500, 502)],
    )
    def test_upstream_failures_are_sanitized_and_release_the_slot(
        self, client, auth_header, configured, status, expected
    ):
        def handler(request):
            return httpx.Response(status, text="synthetic-secret")

        with ntfy(handler):
            response = client.post("/api/feedback", json=REPORT, headers=auth_header)
        assert response.status_code == expected
        assert "synthetic-secret" not in response.text
        assert "ntfy.test" not in response.text
        # The failed attempt did not spend the user's allowance.
        feedback.reserve("testuser")

    def test_timeout_maps_to_504_and_releases_the_slot(self, client, auth_header, configured):
        def handler(request):
            raise httpx.ReadTimeout("slow")

        with ntfy(handler):
            response = client.post("/api/feedback", json=REPORT, headers=auth_header)
        assert response.status_code == 504
        feedback.reserve("testuser")
