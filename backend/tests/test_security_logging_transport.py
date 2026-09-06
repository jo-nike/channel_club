"""SEC-03: actual Uvicorn HTTP and WebSocket logging with synthetic credentials."""

import os
import socket
import subprocess
import sys
import time

import httpx
import pytest
from websockets.sync.client import connect

SERVER = """
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from fastapi.responses import PlainTextResponse
import uvicorn
from app.logging_config import configure_logging
@asynccontextmanager
async def lifespan(app):
    configure_logging()
    yield
app = FastAPI(lifespan=lifespan)
@app.get('/api/ersatztv/stream/test')
async def stream():
    return PlainTextResponse('#EXTM3U\\n')
@app.websocket('/api/ws')
async def ws(socket: WebSocket):
    await socket.accept()
    await socket.send_text('ready')
    await socket.close()
uvicorn.run(app, fd=int(__import__('os').environ['TEST_SERVER_FD']))
"""


@pytest.mark.parametrize("log_format", ["pretty", "json"])
def test_sec03_real_protocol_logs(tmp_path, log_format):
    secret = "SYNTHETIC_TRANSPORT_BEARER_SECRET"
    with socket.socket() as listener, (tmp_path / "server.log").open("w+") as output:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        env = {**os.environ, "LOG_FORMAT": log_format, "TEST_SERVER_FD": str(listener.fileno())}
        process = subprocess.Popen(
            [sys.executable, "-c", SERVER],
            env=env,
            pass_fds=(listener.fileno(),),
            stdout=output,
            stderr=output,
        )
        try:
            with httpx.Client(timeout=0.2, trust_env=False) as client:
                for _ in range(100):
                    try:
                        response = client.get(
                            f"http://127.0.0.1:{port}/api/ersatztv/stream/test?token={secret}"
                        )
                        break
                    except httpx.TransportError:
                        time.sleep(0.02)
                else:
                    pytest.fail("Controlled Uvicorn fixture did not start")
                assert response.status_code == 200
            with connect(f"ws://127.0.0.1:{port}/api/ws?token={secret}&view=live") as ws:
                assert ws.recv() == "ready"
        finally:
            process.terminate()
            process.wait(timeout=10)
        output.seek(0)
        logs = output.read()
    assert secret not in logs
    assert "[REDACTED]" in logs
    assert "/api/ersatztv/stream/test" in logs
    assert "view=live" in logs
