"""Local sign-in passwords: scrypt hashes for passwords set in the app.

hashlib.scrypt is in the standard library, so there is no new dependency. A
stored hash reads "scrypt$16384$8$1$<salt>$<key>" (base64). Each check costs
16 MiB and tens of milliseconds of CPU, so it runs in a thread, two at a time.
A plaintext password from the environment still works and wins over a saved
hash; it is compared as UTF-8 bytes in constant time.
"""

import asyncio
import base64
import hashlib
import hmac
import secrets
from collections.abc import Callable
from dataclasses import dataclass

from pydantic import SecretStr

from app.config import Settings

SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16
KEY_BYTES = 32
# scrypt needs 128 * r * n bytes (16 MiB here); OpenSSL's default cap is 32 MiB
SCRYPT_MAXMEM = 64 * 1024 * 1024
# Hashes computed at once; each holds 16 MiB and a CPU while it runs
MAX_CONCURRENT_HASHES = 2

# Created on first use, so it binds to the running loop (reset_password_slots)
_slots: asyncio.Semaphore | None = None
# A hash of a random password, checked when no account has the username given
_dummy_hash: str | None = None


def _utf8(text: str) -> bytes:
    # surrogatepass: a lone surrogate from JSON must not turn a wrong password into a 500
    return text.encode("utf-8", "surrogatepass")


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _derive(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(
        _utf8(password),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        maxmem=SCRYPT_MAXMEM,
        dklen=KEY_BYTES,
    )


def _hash(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    key = _derive(password, salt)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(key)}"


def _verify(password: str, stored: str) -> bool:
    """True when password matches; False for a wrong password or any unusable hash."""
    try:
        scheme, n, r, p, salt, key = stored.split("$")
        # Only the cost this module writes: a stored hash can't make a check dearer
        if scheme != "scrypt" or (n, r, p) != (str(SCRYPT_N), str(SCRYPT_R), str(SCRYPT_P)):
            return False
        expected = base64.b64decode(key, validate=True)
        derived = _derive(password, base64.b64decode(salt, validate=True))
    except ValueError:
        # Also binascii.Error (bad base64) and scrypt's own parameter errors
        return False
    return hmac.compare_digest(derived, expected)


async def _in_slot[R](function: Callable[..., R], *args: str) -> R:
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(MAX_CONCURRENT_HASHES)
    async with _slots:
        return await asyncio.to_thread(function, *args)


async def hash_password(password: str) -> str:
    """A new salted scrypt hash of password, to save in place of the password."""
    return await _in_slot(_hash, password)


async def verify_password(password: str, stored: str) -> bool:
    """Check password against a hash from hash_password; a garbled hash is False."""
    return await _in_slot(_verify, password, stored)


@dataclass(frozen=True)
class LocalAccount:
    """One local sign-in: the admin or the shared viewer (guest) login."""

    role: str
    username: str
    # Plaintext from the environment; wins over the hash when set
    password: SecretStr | None
    # Saved from the app
    password_hash: SecretStr | None

    @property
    def plaintext(self) -> str:
        return self.password.get_secret_value() if self.password else ""

    @property
    def hashed(self) -> str:
        return self.password_hash.get_secret_value() if self.password_hash else ""

    @property
    def usable(self) -> bool:
        """An account without any password can't be signed in to."""
        return bool(self.plaintext or self.hashed)


def local_accounts(config: Settings) -> list[LocalAccount]:
    """The admin then the viewer account, as configured now."""
    return [
        LocalAccount(
            "admin", config.admin_username, config.admin_password, config.admin_password_hash
        ),
        LocalAccount(
            "viewer", config.viewer_username, config.viewer_password, config.viewer_password_hash
        ),
    ]


async def check_local_login(
    accounts: list[LocalAccount], username: str, password: str
) -> str | None:
    """The role these credentials sign in as, or None.

    Accounts are tried in order, so the admin wins when both share a username.
    When no account has this username but some account keeps a hash, one
    scrypt check still runs, so response times don't show which usernames exist.
    """
    global _dummy_hash
    matched = False
    for account in accounts:
        if account.username != username or not account.usable:
            continue
        matched = True
        if account.plaintext:
            if hmac.compare_digest(_utf8(password), _utf8(account.plaintext)):
                return account.role
        elif await verify_password(password, account.hashed):
            return account.role
    if not matched and any(account.usable and not account.plaintext for account in accounts):
        if _dummy_hash is None:
            _dummy_hash = await hash_password(secrets.token_urlsafe(16))
        await verify_password(password, _dummy_hash)
    return None


def reset_password_slots() -> None:
    """Forget the semaphore (each test runs on a fresh loop)."""
    global _slots
    _slots = None
