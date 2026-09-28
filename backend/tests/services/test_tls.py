"""Every httpx client in the app reuses the one shared SSL context (C-02)."""

import ast
import ssl
from pathlib import Path

import httpx

from app.services.tls import SSL_CONTEXT

APP_DIR = Path(__file__).resolve().parents[2] / "app"


def _httpx_calls_without_verify() -> list[str]:
    missing: list[str] = []
    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not (
                isinstance(func, ast.Attribute)
                and isinstance(func.value, ast.Name)
                and func.value.id == "httpx"
                and func.attr in ("AsyncClient", "Client", "stream")
            ):
                continue
            if not any(keyword.arg == "verify" for keyword in node.keywords):
                missing.append(
                    f"{path.relative_to(APP_DIR.parent)}:{node.lineno} httpx.{func.attr}"
                )
    return missing


def test_every_httpx_client_passes_the_shared_ssl_context() -> None:
    # Without verify=, httpx builds a fresh SSL context and loads the certifi bundle on
    # every construction, blocking the event loop for about 16 ms.
    assert _httpx_calls_without_verify() == []


def test_shared_context_verifies_certificates() -> None:
    assert isinstance(SSL_CONTEXT, ssl.SSLContext)
    assert SSL_CONTEXT.verify_mode == ssl.CERT_REQUIRED
    assert SSL_CONTEXT.check_hostname is True


async def test_client_built_with_shared_context_uses_it() -> None:
    async with httpx.AsyncClient(verify=SSL_CONTEXT) as client:
        pool = client._transport._pool  # pyright: ignore[reportAttributeAccessIssue, reportPrivateUsage, reportUnknownMemberType, reportUnknownVariableType]
        assert pool._ssl_context is SSL_CONTEXT  # pyright: ignore[reportUnknownMemberType, reportPrivateUsage]
