from fastapi import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

TOO_LARGE = "Request body too large"


class BodySizeLimitMiddleware:
    """Answer 413 to HTTP bodies over max_bytes before routing or JSON parsing.

    FastAPI reads and parses the whole body before it resolves auth, so without
    this an anonymous request of any size costs its full parse. Pure ASGI, so a
    chunked body is counted as it streams and never buffered here.
    """

    def __init__(self, app: ASGIApp, max_bytes: int, exempt_paths: frozenset[str]) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.exempt_paths = exempt_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in self.exempt_paths:
            await self.app(scope, receive, send)
            return
        for name, value in scope["headers"]:
            if name == b"content-length" and value.isdigit() and int(value) > self.max_bytes:
                await JSONResponse({"detail": TOO_LARGE}, status_code=413)(scope, receive, send)
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # FastAPI re-raises HTTPException from body reading, and its
                    # exception handler turns it into the 413 JSON response.
                    raise HTTPException(status_code=413, detail=TOO_LARGE)
            return message

        await self.app(scope, limited_receive, send)
