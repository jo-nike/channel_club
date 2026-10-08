from collections.abc import Callable

from fastapi import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

TOO_LARGE = "Request body too large"


class BodySizeLimitMiddleware:
    """Answer 413 to HTTP bodies over max_bytes before routing or JSON parsing.

    FastAPI reads and parses the whole body before it resolves auth, so without
    this an anonymous request of any size costs its full parse. Pure ASGI, so a
    chunked body is counted as it streams and never buffered here. The cap may
    be a getter, read once per request, so a changed setting applies at once.
    """

    def __init__(
        self, app: ASGIApp, max_bytes: int | Callable[[], int], exempt_paths: frozenset[str]
    ) -> None:
        self.app = app
        self._max_bytes = max_bytes
        self.exempt_paths = exempt_paths

    @property
    def max_bytes(self) -> int:
        return self._max_bytes() if callable(self._max_bytes) else self._max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in self.exempt_paths:
            await self.app(scope, receive, send)
            return
        max_bytes = self.max_bytes
        for name, value in scope["headers"]:
            if name == b"content-length" and value.isdigit() and int(value) > max_bytes:
                await JSONResponse({"detail": TOO_LARGE}, status_code=413)(scope, receive, send)
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > max_bytes:
                    # FastAPI re-raises HTTPException from body reading, and its
                    # exception handler turns it into the 413 JSON response.
                    raise HTTPException(status_code=413, detail=TOO_LARGE)
            return message

        await self.app(scope, limited_receive, send)
