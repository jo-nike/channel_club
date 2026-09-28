"""Open /api/ws the way the current client does: no token in the URL, auth in the first frame."""

from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import urlencode

from starlette.testclient import TestClient, WebSocketTestSession


@contextmanager
def ws_connect(client: TestClient, token: str, **params: str) -> Iterator[WebSocketTestSession]:
    """Connect to /api/ws with the given query params and send the auth frame.

    Args:
        client: The test client to connect through.
        token: The JWT to send in the auth message.
        **params: Query parameters (view, session_id).
    """
    query = urlencode(params)
    with client.websocket_connect(f"/api/ws?{query}" if query else "/api/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        yield ws
