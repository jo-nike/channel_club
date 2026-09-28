"""B-06: the Dockerfile's uvicorn flags refuse oversize WebSocket frames at the protocol.

TestClient never runs uvicorn's WebSocket parser, so this starts a real uvicorn
with the flags read from the Dockerfile CMD. Deleting them there fails the test.
"""

import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
from websockets.exceptions import ConnectionClosed
from websockets.sync.client import connect

from app.models.websocket import MAX_MESSAGE_BYTES

DOCKERFILE = Path(__file__).parents[2] / "Dockerfile"

# Hermetic: no app.main import (it would read the checkout's .env). Like the real
# endpoint, it accepts before anything else and closes with 4001 once a message
# gets through, so a frame that reaches the app is visible as 4001, not 1009.
SERVER = """
import os
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
app = FastAPI()
@app.websocket('/ws')
async def ws(socket: WebSocket):
    await socket.accept()
    try:
        await socket.receive_text()
    except WebSocketDisconnect:
        return
    await socket.close(code=4001)
uvicorn.run(
    app,
    fd=int(os.environ['TEST_SERVER_FD']),
    ws_max_size=int(os.environ['WS_MAX_SIZE']),
    ws_per_message_deflate=os.environ['WS_PER_MESSAGE_DEFLATE'] == 'true',
    log_level='warning',
)
"""


def dockerfile_cmd_option(name: str) -> str:
    text = DOCKERFILE.read_text().replace("\\\n", " ")
    match = re.search(r"^CMD (\[.*\])$", text, re.MULTILINE)
    assert match, "Dockerfile has no exec-form CMD"
    cmd = json.loads(match.group(1))
    assert name in cmd, f"Dockerfile CMD lacks {name}"
    return cmd[cmd.index(name) + 1]


def test_dockerfile_frame_ceiling_is_above_the_app_message_cap():
    assert int(dockerfile_cmd_option("--ws-max-size")) > MAX_MESSAGE_BYTES


def test_compressible_oversize_frame_is_refused_before_the_app(tmp_path):
    max_size = dockerfile_cmd_option("--ws-max-size")
    deflate = dockerfile_cmd_option("--ws-per-message-deflate").lower()
    with socket.socket() as listener, (tmp_path / "server.log").open("w+") as output:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        env = {
            "PATH": os.environ.get("PATH", ""),
            "TEST_SERVER_FD": str(listener.fileno()),
            "WS_MAX_SIZE": max_size,
            "WS_PER_MESSAGE_DEFLATE": deflate,
        }
        process = subprocess.Popen(
            [sys.executable, "-c", SERVER],
            cwd=tmp_path,
            env=env,
            pass_fds=(listener.fileno(),),
            stdout=output,
            stderr=output,
        )
        try:
            for _ in range(100):
                try:
                    ws = connect(f"ws://127.0.0.1:{port}/ws", compression="deflate", open_timeout=1)
                    break
                except OSError:
                    time.sleep(0.02)
            else:
                pytest.fail("Controlled Uvicorn fixture did not start")
            with ws:
                # 1 MiB of one character deflates to about 1 KiB on the wire.
                started = time.monotonic()
                with pytest.raises(ConnectionClosed) as closed:
                    ws.send("a" * (1024 * 1024))
                    ws.recv(timeout=3)
                elapsed = time.monotonic() - started
        finally:
            process.terminate()
            process.wait(timeout=10)
    received = closed.value.rcvd
    assert received is None or received.code == 1009, f"app accepted the frame: {received}"
    assert elapsed < 3
