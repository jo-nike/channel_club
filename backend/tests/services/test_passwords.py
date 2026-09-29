"""Local sign-in passwords: scrypt hashes, env plaintext, and constant-time checks."""

import asyncio
import threading
import time

import pytest
from pydantic import SecretStr

from app.services import passwords
from app.services.passwords import LocalAccount, check_local_login


def accounts(
    admin_password: str | None = None,
    admin_hash: str | None = None,
    viewer_password: str | None = None,
    viewer_hash: str | None = None,
    viewer_username: str = "guest",
) -> list[LocalAccount]:
    def secret(value: str | None) -> SecretStr | None:
        return SecretStr(value) if value is not None else None

    return [
        LocalAccount("admin", "admin", secret(admin_password), secret(admin_hash)),
        LocalAccount("viewer", viewer_username, secret(viewer_password), secret(viewer_hash)),
    ]


class TestHashes:
    async def test_a_hash_checks_its_own_password_only(self) -> None:
        stored = await passwords.hash_password("synthetic-pässwörd")

        assert stored.startswith("scrypt$16384$8$1$")
        assert await passwords.verify_password("synthetic-pässwörd", stored) is True
        assert await passwords.verify_password("synthetic-password", stored) is False

    async def test_each_hash_has_its_own_salt(self) -> None:
        first = await passwords.hash_password("same")
        second = await passwords.hash_password("same")

        assert first != second

    @pytest.mark.parametrize(
        "stored",
        [
            "",
            "scrypt$",
            "not-a-hash",
            "bcrypt$16384$8$1$c2FsdA==$a2V5",
            "scrypt$16384$8$1$!!!!$a2V5",
            "scrypt$16384$8$1$c2FsdA==$not base64",
            # A dearer cost than this module writes is refused, not computed
            "scrypt$1048576$8$1$c2FsdA==$a2V5",
            "scrypt$16384$8$1$c2FsdA==$a2V5$extra",
        ],
    )
    async def test_a_garbled_hash_is_false_not_an_error(self, stored: str) -> None:
        assert await passwords.verify_password("anything", stored) is False

    async def test_a_lone_surrogate_is_just_a_wrong_password(self) -> None:
        stored = await passwords.hash_password("synthetic")

        assert await passwords.verify_password("\ud800", stored) is False

    async def test_at_most_two_hashes_run_at_once(self, monkeypatch: pytest.MonkeyPatch) -> None:
        running = 0
        peak = 0
        guard = threading.Lock()

        def slow_hash(password: str) -> str:
            nonlocal running, peak
            with guard:
                running += 1
                peak = max(peak, running)
            time.sleep(0.05)
            with guard:
                running -= 1
            return password

        monkeypatch.setattr(passwords, "_hash", slow_hash)

        await asyncio.gather(*(passwords.hash_password(str(n)) for n in range(6)))

        assert peak == passwords.MAX_CONCURRENT_HASHES


class TestCheckLocalLogin:
    async def test_a_plaintext_password_from_the_environment_still_works(self) -> None:
        configured = accounts(admin_password="synthetic-admin", viewer_password="synthetic-guest")

        assert await check_local_login(configured, "admin", "synthetic-admin") == "admin"
        assert await check_local_login(configured, "guest", "synthetic-guest") == "viewer"
        assert await check_local_login(configured, "admin", "synthetic-guest") is None

    async def test_a_non_ascii_password_is_compared_not_an_error(self) -> None:
        configured = accounts(admin_password="synthetic-pässwörd")

        assert await check_local_login(configured, "admin", "synthetic-pässwörd") == "admin"
        assert await check_local_login(configured, "admin", "synthetic-passwörd") is None

    async def test_a_saved_hash_signs_in(self) -> None:
        configured = accounts(admin_hash=await passwords.hash_password("synthetic-admin"))

        assert await check_local_login(configured, "admin", "synthetic-admin") == "admin"
        assert await check_local_login(configured, "admin", "wrong") is None

    async def test_the_environment_password_wins_over_a_saved_hash(self) -> None:
        configured = accounts(
            admin_password="from-env", admin_hash=await passwords.hash_password("from-app")
        )

        assert await check_local_login(configured, "admin", "from-env") == "admin"
        assert await check_local_login(configured, "admin", "from-app") is None

    async def test_an_account_without_a_password_is_closed(self) -> None:
        configured = accounts(admin_password="", viewer_password=None)

        assert await check_local_login(configured, "admin", "") is None
        assert await check_local_login(configured, "guest", "") is None

    async def test_the_admin_wins_a_shared_username(self) -> None:
        configured = accounts(
            admin_password="synthetic-admin",
            viewer_password="synthetic-guest",
            viewer_username="admin",
        )

        assert await check_local_login(configured, "admin", "synthetic-admin") == "admin"
        assert await check_local_login(configured, "admin", "synthetic-guest") == "viewer"

    async def test_an_unknown_username_costs_one_check_when_hashes_are_kept(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Otherwise a fast refusal would show which usernames exist."""
        configured = accounts(admin_hash=await passwords.hash_password("synthetic-admin"))
        checks: list[str] = []
        verify = passwords.verify_password

        async def counting(password: str, stored: str) -> bool:
            checks.append(password)
            return await verify(password, stored)

        monkeypatch.setattr(passwords, "verify_password", counting)

        assert await check_local_login(configured, "nobody", "guess") is None
        assert checks == ["guess"]

    async def test_plaintext_only_accounts_need_no_decoy_check(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        configured = accounts(admin_password="synthetic-admin")
        checks: list[str] = []

        async def counting(password: str, stored: str) -> bool:
            checks.append(password)
            return False

        monkeypatch.setattr(passwords, "verify_password", counting)

        assert await check_local_login(configured, "nobody", "guess") is None
        assert checks == []
