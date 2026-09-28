import re
from urllib.parse import urlsplit

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# JSON and media need nothing from a browser, so API responses deny everything.
API_CSP = "default-src 'none'; frame-ancestors 'none'"
# A Host header that could not smuggle another directive into the policy
SAFE_HOST = re.compile(r"[A-Za-z0-9.:\[\]-]+")


class SecurityHeadersMiddleware:
    """Add nosniff, Referrer-Policy, X-Frame-Options and a CSP to every HTTP response.

    /api responses get an enforced deny-all CSP; everything else (the SPA
    document and static files) gets the document policy as Report-Only. A header
    a route already set is left alone. Pure ASGI, so streamed bodies (the
    segment proxy) pass through unbuffered.
    """

    def __init__(self, app: ASGIApp, stream_base_url: str) -> None:
        self.app = app
        stream = urlsplit(stream_base_url)
        stream_origin = f"{stream.scheme}://{stream.netloc}"
        # Older Safari does not match wss: with 'self', so the socket's origin is
        # named per request from its Host header.
        self.document_csp_head = (
            "default-src 'self'; script-src 'self' https://www.gstatic.com; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https://*.giphy.com https://assets.nhle.com; "
            f"media-src 'self' blob: {stream_origin} https://*.giphy.com; "
            "connect-src 'self'"
        )
        self.document_csp_tail = (
            f" {stream_origin} https://plex.tv; worker-src 'self' blob:; object-src 'none'; "
            "base-uri 'none'; form-action 'self'; frame-ancestors 'none'; "
            "report-uri /api/csp-report"
        )

    def document_csp(self, host: str | None) -> str:
        socket = f" wss://{host}" if host and SAFE_HOST.fullmatch(host) else ""
        return self.document_csp_head + socket + self.document_csp_tail

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        is_api = path == "/api" or path.startswith("/api/")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
                # frame-ancestors in a Report-Only policy does not block framing
                headers.setdefault("X-Frame-Options", "DENY")
                if is_api:
                    headers.setdefault("Content-Security-Policy", API_CSP)
                else:
                    policy = self.document_csp(Headers(scope=scope).get("host"))
                    headers.setdefault("Content-Security-Policy-Report-Only", policy)
            await send(message)

        await self.app(scope, receive, send_with_headers)
