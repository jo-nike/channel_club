"""One long-lived httpx client per upstream: ErsatzTV and Dispatcharr (C-02).

A proxied segment, a manifest poll or a catalogue call reuses a pooled
connection instead of building a client and opening a fresh TCP connection each
time. Clients are created lazily in the running loop and closed by the lifespan
teardown (aclose_http_clients).

Timeouts stay per call: each site passes the timeout it has always used. The
client default of 10 s is what the logo fetches (fetch_logo) run under.

Neither client keeps cookies, so a Set-Cookie from one request is never sent
on every later one, just as with the per-call clients before.
"""

import asyncio
import http.cookiejar

import httpx

from app.services.tls import SSL_CONTEXT

ERSATZTV = "ersatztv"
DISPATCHARR = "dispatcharr"

_DEFAULT_TIMEOUT = 10.0

_clients: dict[str, httpx.AsyncClient] = {}


def _no_cookies() -> http.cookiejar.CookieJar:
    """A cookie jar whose policy accepts no domain, so it never stores a cookie."""
    return http.cookiejar.CookieJar(policy=http.cookiejar.DefaultCookiePolicy(allowed_domains=[]))


def ersatztv_client() -> httpx.AsyncClient:
    """The shared ErsatzTV client.

    follow_redirects stays off: fetch_ersatztv and fetch_logo re-validate every
    redirect hop against the allowlist before connecting to it.
    """
    client = _clients.get(ERSATZTV)
    if client is None:
        client = _clients[ERSATZTV] = httpx.AsyncClient(
            follow_redirects=False,
            timeout=_DEFAULT_TIMEOUT,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
            verify=SSL_CONTEXT,
            cookies=_no_cookies(),
        )
    return client


def dispatcharr_client() -> httpx.AsyncClient:
    """The shared Dispatcharr client; the ApiKey header is added per request."""
    client = _clients.get(DISPATCHARR)
    if client is None:
        client = _clients[DISPATCHARR] = httpx.AsyncClient(
            follow_redirects=False,
            timeout=_DEFAULT_TIMEOUT,
            verify=SSL_CONTEXT,
            cookies=_no_cookies(),
        )
    return client


def install_http_client(name: str, client: httpx.AsyncClient) -> None:
    """Use `client` for the named upstream (tests: a MockTransport client)."""
    _clients[name] = client


async def aclose_http_clients() -> None:
    """Close every client (the lifespan teardown); a later call builds a new one."""
    clients = list(_clients.values())
    _clients.clear()
    await asyncio.gather(*(client.aclose() for client in clients))


def reset_http_clients() -> None:
    """Drop every client (tests: each test runs in a new event loop).

    A client can't be closed without a loop here; a test that opened real
    connections closes its client itself.
    """
    _clients.clear()
