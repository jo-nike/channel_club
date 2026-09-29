"""Route the shared upstream clients (app.services.http_clients) to fake upstreams."""

from collections.abc import Callable, Coroutine
from typing import Any

import httpx

from app.services.http_clients import install_http_client
from app.services.tls import SSL_CONTEXT

Handler = (
    Callable[[httpx.Request], httpx.Response]
    | Callable[[httpx.Request], Coroutine[Any, Any, httpx.Response]]
)


def mock_upstream(name: str, handler: Handler) -> httpx.AsyncClient:
    """Install a MockTransport client for the named upstream and return it.

    It doesn't follow redirects, like the real clients. The conftest reset drops
    it before the next test; a MockTransport holds no connections to close.
    """
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(handler), follow_redirects=False, verify=SSL_CONTEXT
    )
    install_http_client(name, client)
    return client
