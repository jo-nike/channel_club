"""Tests for Plex authentication service."""

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from pydantic import SecretStr

from app.models.plex import PlexUser
from app.services.plex import (
    InvalidPlexTokenError,
    PlexUnavailableError,
    check_server_access,
    validate_plex_token,
)


class TestPlexTvFailures:
    """plex.tv outages and garbage raise PlexUnavailableError, not a verdict (A-04)."""

    @pytest.fixture(autouse=True)
    def server_config(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.services import plex

        monkeypatch.setattr(plex.settings, "plex_server_machine_id", "my-server-abc")

    @staticmethod
    def _install_plex_tv(monkeypatch: pytest.MonkeyPatch, respond) -> list[dict[str, Any]]:
        from app.services import plex

        clients: list[dict[str, Any]] = []
        factory = httpx.AsyncClient

        def client(**kwargs: Any) -> httpx.AsyncClient:
            clients.append(kwargs)
            return factory(transport=httpx.MockTransport(respond), **kwargs)

        monkeypatch.setattr(plex.httpx, "AsyncClient", client)
        return clients

    @pytest.mark.parametrize(
        "response",
        [
            httpx.Response(500),
            httpx.Response(503),
            httpx.Response(429),
            httpx.Response(403),
            httpx.Response(200, text="<html>maintenance</html>"),
            httpx.Response(200, json=[]),
            httpx.Response(200, json={"id": None, "username": "u"}),
            httpx.Response(200, json={"id": "", "username": "u"}),
            httpx.Response(200, json={"id": {"a": 1}, "username": "u"}),
            httpx.Response(200, json={"id": True, "username": "u"}),
            httpx.Response(200, json={"id": 1}),
        ],
    )
    async def test_user_lookup_failures_are_unavailable(
        self, monkeypatch: pytest.MonkeyPatch, response: httpx.Response
    ) -> None:
        self._install_plex_tv(monkeypatch, lambda request: response)

        with pytest.raises(PlexUnavailableError):
            await validate_plex_token("synthetic-token")

    async def test_only_a_401_means_an_invalid_token(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._install_plex_tv(monkeypatch, lambda request: httpx.Response(401))

        with pytest.raises(InvalidPlexTokenError):
            await validate_plex_token("synthetic-token")

    @pytest.mark.parametrize(
        "response",
        [
            httpx.Response(500),
            httpx.Response(429),
            httpx.Response(401),
            httpx.Response(200, text="<html>maintenance</html>"),
            httpx.Response(200, json={"clientIdentifier": "my-server-abc"}),
            httpx.Response(200, json=["my-server-abc"]),
        ],
    )
    async def test_resources_failures_are_unavailable(
        self, monkeypatch: pytest.MonkeyPatch, response: httpx.Response
    ) -> None:
        self._install_plex_tv(monkeypatch, lambda request: response)

        with pytest.raises(PlexUnavailableError):
            await check_server_access("synthetic-token")

    @pytest.mark.parametrize("error", [httpx.ConnectTimeout, httpx.ReadTimeout, httpx.ConnectError])
    async def test_transport_errors_are_unavailable(
        self, monkeypatch: pytest.MonkeyPatch, error: type[httpx.TransportError]
    ) -> None:
        def fail(request: httpx.Request) -> httpx.Response:
            raise error("down", request=request)

        self._install_plex_tv(monkeypatch, fail)

        with pytest.raises(PlexUnavailableError):
            await validate_plex_token("synthetic-token")
        with pytest.raises(PlexUnavailableError):
            await check_server_access("synthetic-token")

    async def test_both_calls_use_an_explicit_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def respond(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/api/v2/user":
                return httpx.Response(200, json={"id": 1, "username": "u"})
            return httpx.Response(200, json=[{"clientIdentifier": "my-server-abc"}])

        clients = self._install_plex_tv(monkeypatch, respond)

        await validate_plex_token("synthetic-token")
        assert await check_server_access("synthetic-token") is True

        assert [c["timeout"] for c in clients] == [httpx.Timeout(5.0, connect=3.0)] * 2


class TestValidatePlexToken:
    """Tests for validate_plex_token function."""

    @pytest.mark.asyncio
    async def test_valid_token_returns_plex_user(self) -> None:
        """Valid Plex token returns PlexUser with user data."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": 12345,
            "username": "testuser",
            "email": "test@example.com",
            "thumb": "https://plex.tv/users/avatar.png",
        }

        with patch("app.services.plex.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            user = await validate_plex_token("valid-token")

            assert isinstance(user, PlexUser)
            assert user.id == "12345"
            assert user.username == "testuser"
            assert user.email == "test@example.com"
            assert user.thumb == "https://plex.tv/users/avatar.png"

    @pytest.mark.asyncio
    async def test_invalid_token_raises_error(self) -> None:
        """Invalid Plex token raises InvalidPlexTokenError."""
        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch("app.services.plex.httpx.AsyncClient") as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                return_value=mock_response
            )

            with pytest.raises(InvalidPlexTokenError):
                await validate_plex_token("invalid-token")

    @pytest.mark.asyncio
    async def test_calls_plex_api_with_correct_headers(self) -> None:
        """validate_plex_token calls Plex API with correct headers."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": 12345,
            "username": "testuser",
            "email": "test@example.com",
        }

        with patch("app.services.plex.httpx.AsyncClient") as mock_client:
            mock_get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value.get = mock_get

            await validate_plex_token("test-token")

            mock_get.assert_called_once()
            call_args = mock_get.call_args
            assert call_args[0][0] == "https://plex.tv/api/v2/user"
            assert "X-Plex-Token" in call_args[1]["headers"]
            assert call_args[1]["headers"]["X-Plex-Token"] == "test-token"
            assert call_args[1]["headers"]["Accept"] == "application/json"


class TestCheckServerAccess:
    """Tests for check_server_access function."""

    @pytest.mark.asyncio
    async def test_returns_true_when_no_server_configured(self) -> None:
        """Returns True when plex_server_machine_id is not configured."""
        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_machine_id = None

            result = await check_server_access("any-token")

            assert result is True

    @pytest.mark.asyncio
    async def test_returns_true_when_user_has_server_access(self) -> None:
        """Returns True when user has access to configured server."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {"clientIdentifier": "other-server-123"},
            {"clientIdentifier": "my-server-abc"},
        ]

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_machine_id = "my-server-abc"

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                    return_value=mock_response
                )

                result = await check_server_access("valid-token")

                assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_user_lacks_server_access(self) -> None:
        """Returns False when user doesn't have access to configured server."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = [
            {"clientIdentifier": "other-server-123"},
            {"clientIdentifier": "another-server-456"},
        ]

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_machine_id = "my-server-abc"

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                    return_value=mock_response
                )

                result = await check_server_access("valid-token")

                assert result is False

    @pytest.mark.asyncio
    async def test_raises_unavailable_when_api_request_fails(self) -> None:
        """A failed resources request is plex.tv's outage, not 'no access' (A-04)."""
        mock_response = MagicMock()
        mock_response.status_code = 500

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_machine_id = "my-server-abc"

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                    return_value=mock_response
                )

                with pytest.raises(PlexUnavailableError):
                    await check_server_access("valid-token")

    @pytest.mark.asyncio
    async def test_calls_resources_api_with_correct_params(self) -> None:
        """check_server_access calls resources API with correct parameters."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = []

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_machine_id = "my-server-abc"

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_get = AsyncMock(return_value=mock_response)
                mock_client.return_value.__aenter__.return_value.get = mock_get

                await check_server_access("test-token")

                mock_get.assert_called_once()
                call_args = mock_get.call_args
                assert call_args[0][0] == "https://plex.tv/api/v2/resources"
                assert call_args[1]["params"]["includeHttps"] == 1


class TestGetServerOwnerId:
    """Tests for get_server_owner_id function."""

    @pytest.mark.asyncio
    async def test_returns_none_when_no_server_token(self) -> None:
        """Returns None when plex_server_token is not configured."""
        from app.services.plex import clear_server_owner_id_cache, get_server_owner_id

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_token = None

            # Clear cache before test
            clear_server_owner_id_cache()
            result = await get_server_owner_id()

            assert result is None

    @pytest.mark.asyncio
    async def test_returns_owner_id_from_api(self) -> None:
        """Returns server owner ID from Plex API."""
        from app.services.plex import clear_server_owner_id_cache, get_server_owner_id

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": 98765,
            "username": "serverowner",
            "email": "owner@example.com",
        }

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_token = SecretStr("server-token-123")

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                    return_value=mock_response
                )

                # Clear cache before test
                clear_server_owner_id_cache()
                result = await get_server_owner_id()

                assert result == "98765"

    @pytest.mark.asyncio
    async def test_returns_none_on_api_failure(self) -> None:
        """Returns None when Plex API request fails."""
        from app.services.plex import clear_server_owner_id_cache, get_server_owner_id

        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_token = SecretStr("invalid-token")

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                    return_value=mock_response
                )

                # Clear cache before test
                clear_server_owner_id_cache()
                result = await get_server_owner_id()

                assert result is None

    @pytest.mark.asyncio
    async def test_caches_result(self) -> None:
        """Caches the server owner ID after first call."""
        from app.services.plex import clear_server_owner_id_cache, get_server_owner_id

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "id": 98765,
            "username": "serverowner",
            "email": "owner@example.com",
        }

        with patch("app.services.plex.settings") as mock_settings:
            mock_settings.plex_server_token = SecretStr("server-token-123")

            with patch("app.services.plex.httpx.AsyncClient") as mock_client:
                mock_get = AsyncMock(return_value=mock_response)
                mock_client.return_value.__aenter__.return_value.get = mock_get

                # Clear cache before test
                clear_server_owner_id_cache()

                # Call twice
                await get_server_owner_id()
                await get_server_owner_id()

                # Should only call API once due to caching
                assert mock_get.call_count == 1


class TestServerOwnerLookup:
    """The owner id lookup behind require_admin's owner clause (A-02)."""

    @pytest.fixture(autouse=True)
    def owner_config(self, monkeypatch: pytest.MonkeyPatch):
        from app.services import plex

        monkeypatch.setattr(plex.settings, "plex_auth_enabled", True)
        monkeypatch.setattr(plex.settings, "plex_server_token", "synthetic-server-token")
        plex.clear_server_owner_id_cache()
        yield
        plex.clear_server_owner_id_cache()

    @staticmethod
    def _install_plex_tv(monkeypatch: pytest.MonkeyPatch, respond) -> list[dict[str, Any]]:
        """Route plex.tv to an async fake; returns the AsyncClient kwargs per call."""
        from app.services import plex

        clients: list[dict[str, Any]] = []
        factory = httpx.AsyncClient

        def client(**kwargs: Any) -> httpx.AsyncClient:
            clients.append(kwargs)
            return factory(transport=httpx.MockTransport(respond), **kwargs)

        monkeypatch.setattr(plex.httpx, "AsyncClient", client)
        return clients

    async def test_concurrent_misses_make_one_upstream_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        async def slow_owner(request: httpx.Request) -> httpx.Response:
            await asyncio.sleep(0.01)
            return httpx.Response(200, json={"id": 42})

        clients = self._install_plex_tv(monkeypatch, slow_owner)

        results = await asyncio.gather(*(plex.get_server_owner_id() for _ in range(5)))

        assert results == ["42"] * 5
        assert len(clients) == 1
        assert plex._owner_id_lookup is None

    async def test_lookup_has_a_three_second_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.services import plex

        clients = self._install_plex_tv(
            monkeypatch, lambda request: httpx.Response(200, json={"id": 42})
        )

        assert await plex.get_server_owner_id() == "42"
        assert [kwargs["timeout"] for kwargs in clients] == [3.0]

    @pytest.mark.parametrize("body", [{}, {"id": None}, {"id": ""}])
    async def test_missing_id_is_never_cached(
        self, monkeypatch: pytest.MonkeyPatch, body: dict[str, object]
    ) -> None:
        from app.services import plex

        clients = self._install_plex_tv(monkeypatch, lambda request: httpx.Response(200, json=body))

        assert await plex.get_server_owner_id() is None
        assert await plex.get_server_owner_id() is None
        assert plex._server_owner_id_cache == {}
        assert len(clients) == 2

    async def test_unreachable_plex_tv_returns_none_uncached(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        def unreachable(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectTimeout("synthetic outage", request=request)

        self._install_plex_tv(monkeypatch, unreachable)

        assert await plex.get_server_owner_id() is None
        assert plex._server_owner_id_cache == {}

    async def test_boot_lookup_warms_the_cache_without_waiting(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        clients = self._install_plex_tv(
            monkeypatch, lambda request: httpx.Response(200, json={"id": 42})
        )

        plex.start_server_owner_lookup()
        task = plex._owner_id_lookup
        assert task is not None
        assert not task.done()
        await task

        assert plex._server_owner_id_cache == {"owner_id": "42"}
        assert await plex.get_server_owner_id() == "42"
        assert len(clients) == 1

    async def test_boot_lookup_is_skipped_without_plex_sign_in(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        monkeypatch.setattr(plex.settings, "plex_auth_enabled", False)

        plex.start_server_owner_lookup()

        assert plex._owner_id_lookup is None

    async def test_clear_forgets_the_lookup_in_flight(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        self._install_plex_tv(monkeypatch, lambda request: httpx.Response(200, json={"id": 42}))
        plex.start_server_owner_lookup()
        task = plex._owner_id_lookup

        plex.clear_server_owner_id_cache()

        assert plex._owner_id_lookup is None
        assert task is not None
        await task

    async def test_a_lookup_overtaken_by_a_clear_caches_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A token or switch change clears the cache; the old lookup can't refill it."""
        from app.services import plex

        release = asyncio.Event()
        owners = iter([41, 42])

        async def owner(request: httpx.Request) -> httpx.Response:
            await release.wait()
            return httpx.Response(200, json={"id": next(owners)})

        self._install_plex_tv(monkeypatch, owner)
        plex.start_server_owner_lookup()
        stale = plex._owner_id_lookup
        assert stale is not None

        plex.clear_server_owner_id_cache()
        release.set()

        assert await stale is None
        assert plex._server_owner_id_cache == {}
        # The next caller looks the owner up again, under the new settings
        assert await plex.get_server_owner_id() == "42"
        assert plex._server_owner_id_cache == {"owner_id": "42"}

    async def test_stop_cancels_a_lookup_still_running(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        async def never_answers(request: httpx.Request) -> httpx.Response:
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

        self._install_plex_tv(monkeypatch, never_answers)
        plex.start_server_owner_lookup()
        task = plex._owner_id_lookup
        assert task is not None

        # Wait without cancelling anything, so only stop's own cancel can end the lookup
        stopper = asyncio.create_task(plex.stop_server_owner_lookup())
        done, _ = await asyncio.wait({stopper}, timeout=1)

        assert stopper in done
        assert task.cancelled()
        assert plex._owner_id_lookup is None

    def test_app_lifespan_stops_the_lookup(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from fastapi.testclient import TestClient

        from app.main import app
        from app.services import plex

        monkeypatch.setattr(plex.settings, "plex_auth_enabled", False)

        with (
            patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
            patch("app.services.plex.stop_server_owner_lookup", new=AsyncMock()) as stop,
        ):
            with TestClient(app):
                stop.assert_not_awaited()
            stop.assert_awaited_once_with()

    def test_app_lifespan_starts_the_lookup(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from fastapi.testclient import TestClient

        from app.main import app
        from app.services import plex

        # Plex sign-in without a machine id fails startup validation; the
        # lookup itself is stubbed, so only the call matters here.
        monkeypatch.setattr(plex.settings, "plex_auth_enabled", False)

        with (
            patch("app.main.get_grouped_channels", new=AsyncMock(return_value=[])),
            patch("app.services.plex.start_server_owner_lookup") as start,
            TestClient(app),
        ):
            start.assert_called_once_with()


class TestDetermineRole:
    """Tests for determine_role function."""

    @pytest.mark.asyncio
    async def test_default_viewer_role(self) -> None:
        """Users get viewer role by default."""
        from app.services.plex import determine_role

        user = PlexUser(id="123", username="testuser", email="test@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value="999"),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "viewer"
            mock_settings.plex_admin_users = []
            mock_settings.plex_admin_ids = []
            role = await determine_role(user)
            assert role == "viewer"

    @pytest.mark.asyncio
    async def test_configured_admin_role(self) -> None:
        """Users get admin role when PLEX_DEFAULT_ROLE=admin."""
        from app.services.plex import determine_role

        user = PlexUser(id="123", username="testuser", email="test@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value="999"),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "admin"
            mock_settings.plex_admin_users = []
            mock_settings.plex_admin_ids = []
            role = await determine_role(user)
            assert role == "admin"

    @pytest.mark.asyncio
    async def test_server_owner_always_admin(self) -> None:
        """Server owner gets admin role regardless of default."""
        from app.services.plex import determine_role

        owner_id = "123"
        user = PlexUser(id=owner_id, username="serverowner", email="owner@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value=owner_id),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "viewer"  # Default is viewer
            mock_settings.plex_admin_users = []
            mock_settings.plex_admin_ids = []
            role = await determine_role(user)
            assert role == "admin"  # But owner gets admin

    @pytest.mark.asyncio
    async def test_admin_users_list(self) -> None:
        """Users in plex_admin_users list get admin role."""
        from app.services.plex import determine_role

        user = PlexUser(id="456", username="vipuser", email="vip@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value="999"),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "viewer"
            mock_settings.plex_admin_users = ["vipuser", "anotheradmin"]
            mock_settings.plex_admin_ids = []
            role = await determine_role(user)
            assert role == "admin"

    @pytest.mark.asyncio
    async def test_non_owner_with_admin_default(self) -> None:
        """Non-owner with admin default still gets admin."""
        from app.services.plex import determine_role

        user = PlexUser(id="456", username="regularuser", email="user@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value="999"),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "admin"
            mock_settings.plex_admin_users = []
            mock_settings.plex_admin_ids = []
            role = await determine_role(user)
            assert role == "admin"

    @pytest.mark.asyncio
    async def test_admin_ids_need_no_owner_lookup(self) -> None:
        """Admins picked in the UI are known by account id, even after a rename."""
        from app.services.plex import determine_role

        user = PlexUser(id="456", username="renamed", email="")
        lookup = AsyncMock(return_value="999")

        with (
            patch("app.services.plex.get_server_owner_id", lookup),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "viewer"
            mock_settings.plex_admin_users = []
            mock_settings.plex_admin_ids = ["456"]
            assert await determine_role(user) == "admin"
        lookup.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_owner_detection_failure_uses_default(self) -> None:
        """When owner detection fails, uses default role."""
        from app.services.plex import determine_role

        user = PlexUser(id="123", username="testuser", email="test@test.com")

        with (
            patch("app.services.plex.get_server_owner_id", return_value=None),
            patch("app.services.plex.settings") as mock_settings,
        ):
            mock_settings.plex_default_role = "viewer"
            mock_settings.plex_admin_users = []
            mock_settings.plex_admin_ids = []
            role = await determine_role(user)
            assert role == "viewer"


OWNED = {
    "name": "Home Server",
    "clientIdentifier": "a1b2c3",
    "provides": "server",
    "owned": True,
    "presence": True,
    "lastSeenAt": "2026-09-29T10:00:00Z",
    "accessToken": "SYNTHETIC-SERVER-ACCESS-TOKEN",
    "connections": [{"uri": "https://10-0-0-5.synthetic.plex.direct:32400"}],
}
RESOURCES = [
    OWNED,
    {**OWNED, "name": "Cabin NAS", "clientIdentifier": "d4e5f6", "presence": False},
    # A friend's server, a player, and an owned player that also serves
    {**OWNED, "name": "Friend's", "clientIdentifier": "f00", "owned": False},
    {**OWNED, "name": "Phone", "clientIdentifier": "c11", "provides": "client,player"},
    {**OWNED, "name": "Shield", "clientIdentifier": "c22", "provides": "client,player,server"},
]
USERS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer friendlyName="myPlex" size="5">
  <User id="11" title="sam" username="sam" email="sam@example.com"
        thumb="https://plex.tv/a.png" home="0" restricted="0">
    <Server machineIdentifier="a1b2c3" name="Home Server" pending="0"/>
  </User>
  <User id="12" title="priya.k" username="priya.k" email="priya@example.com"
        home="0" restricted="0">
    <Server machineIdentifier="a1b2c3" name="Home Server" pending="1"/>
  </User>
  <User id="13" title="cabin-only" username="cabin-only" home="0" restricted="0">
    <Server machineIdentifier="d4e5f6" name="Cabin NAS" pending="0"/>
  </User>
  <User id="14" title="den-tv" username="" home="1" restricted="1"/>
  <User id="15" title="" username="" home="0" restricted="0">
    <Server machineIdentifier="a1b2c3" pending="0"/>
  </User>
</MediaContainer>
"""


class TestPlexLists:
    """The setup wizard's server picker and member list, from plex.tv."""

    @staticmethod
    def _install_plex_tv(monkeypatch: pytest.MonkeyPatch, routes) -> None:
        from app.services import plex

        factory = httpx.AsyncClient

        def respond(request: httpx.Request) -> httpx.Response:
            return routes[request.url.path](request)

        monkeypatch.setattr(
            plex.httpx,
            "AsyncClient",
            lambda **kwargs: factory(transport=httpx.MockTransport(respond), **kwargs),
        )

    @staticmethod
    def _plex_tv(users: httpx.Response | None = None) -> dict[str, Any]:
        return {
            "/api/v2/resources": lambda request: httpx.Response(200, json=RESOURCES),
            "/api/users": lambda request: users or httpx.Response(200, text=USERS_XML),
            "/api/v2/user": lambda request: httpx.Response(
                200, json={"id": 1, "username": "jon", "email": "jon@example.com"}
            ),
        }

    async def test_only_owned_servers_are_listed_with_their_member_counts(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        self._install_plex_tv(monkeypatch, self._plex_tv())

        servers = await plex.list_owned_servers("synthetic-token")

        assert [(s.name, s.machine_id, s.online) for s in servers] == [
            ("Home Server", "a1b2c3", True),
            ("Cabin NAS", "d4e5f6", False),
            ("Shield", "c22", True),
        ]
        # sam, plus den-tv from the Plex Home; priya's invitation is still pending
        assert [s.member_count for s in servers] == [2, 2, 1]
        assert servers[0].last_seen_at is not None

    async def test_no_token_address_or_email_leaves_the_service(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        self._install_plex_tv(monkeypatch, self._plex_tv())

        servers = await plex.list_owned_servers("synthetic-token")
        members = await plex.list_server_members("synthetic-token", "a1b2c3")

        shown = json.dumps([m.model_dump(mode="json") for m in [*servers, *members]])
        for secret in ("SYNTHETIC-SERVER-ACCESS-TOKEN", "plex.direct", "@example.com", "a.png"):
            assert secret not in shown

    async def test_members_are_the_owner_then_accepted_shares_and_the_home(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        self._install_plex_tv(monkeypatch, self._plex_tv())

        members = await plex.list_server_members("synthetic-token", "a1b2c3")

        assert [(m.plex_id, m.username, m.owner, m.managed) for m in members] == [
            ("1", "jon", True, False),
            ("11", "sam", False, False),
            # A managed user has no username, so its title stands in
            ("14", "den-tv", False, True),
        ]

    async def test_the_picker_works_without_the_member_list(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        self._install_plex_tv(monkeypatch, self._plex_tv(users=httpx.Response(503)))

        servers = await plex.list_owned_servers("synthetic-token")

        assert [s.member_count for s in servers] == [None, None, None]

    @pytest.mark.parametrize(
        "users",
        [
            httpx.Response(200, text="<MediaContainer><User id="),
            httpx.Response(200, json={"users": []}),
            httpx.Response(200, text="<html>maintenance</html>"),
            # An entity expansion is refused, not expanded
            httpx.Response(
                200,
                text='<!DOCTYPE m [<!ENTITY a "aaaa">]><MediaContainer>&a;</MediaContainer>',
            ),
        ],
    )
    async def test_a_malformed_member_list_is_unavailable(
        self, monkeypatch: pytest.MonkeyPatch, users: httpx.Response
    ) -> None:
        from app.services import plex

        self._install_plex_tv(monkeypatch, self._plex_tv(users=users))

        with pytest.raises(PlexUnavailableError):
            await plex.list_server_members("synthetic-token", "a1b2c3")

    @pytest.mark.parametrize(
        ("response", "error"),
        [
            (httpx.Response(401), InvalidPlexTokenError),
            (httpx.Response(500), PlexUnavailableError),
            (httpx.Response(200, text="not json"), PlexUnavailableError),
            (httpx.Response(200, json={"servers": []}), PlexUnavailableError),
            (
                httpx.Response(200, content=b"[" + b" " * (5 * 1024 * 1024) + b"]"),
                PlexUnavailableError,
            ),
        ],
    )
    async def test_resource_failures(
        self, monkeypatch: pytest.MonkeyPatch, response: httpx.Response, error: type[Exception]
    ) -> None:
        from app.services import plex

        self._install_plex_tv(monkeypatch, {"/api/v2/resources": lambda request: response})

        with pytest.raises(error):
            await plex.list_owned_servers("synthetic-token")

    async def test_the_lists_ask_plex_tv_for_the_right_formats(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.services import plex

        seen: dict[str, httpx.Request] = {}
        routes = self._plex_tv()

        def record(path: str):
            def respond(request: httpx.Request) -> httpx.Response:
                seen[path] = request
                return routes[path](request)

            return respond

        self._install_plex_tv(monkeypatch, {path: record(path) for path in routes})

        await plex.list_owned_servers("synthetic-token")

        assert seen["/api/v2/resources"].headers["accept"] == "application/json"
        assert seen["/api/users"].headers["accept"] == "application/xml"
        assert seen["/api/users"].headers["x-plex-token"] == "synthetic-token"
