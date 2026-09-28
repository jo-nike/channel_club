"""SPA static serving (mount_spa) against a tmp_path build directory."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.spa import mount_spa

INDEX = "<!doctype html><title>spa</title>"
SECRET = "outside-the-static-root"


@pytest.fixture
def client(tmp_path):
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text(INDEX)
    (static / "sw.js").write_text("// sw")
    (static / "favicon.svg").write_text("<svg/>")
    (static / "assets" / "index-abc123.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text(SECRET)
    (static / "escape").symlink_to(tmp_path / "secret.txt")
    app = FastAPI()
    mount_spa(app, static)
    return TestClient(app)


def test_root_serves_index(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.text == INDEX


def test_spa_route_falls_back_to_index(client):
    response = client.get("/watch/channel-7")
    assert response.status_code == 200
    assert response.text == INDEX


def test_existing_file_is_served(client):
    assert client.get("/favicon.svg").text == "<svg/>"
    assert client.get("/assets/index-abc123.js").text == "console.log(1)"


@pytest.mark.parametrize(
    "path",
    [
        "/%2e%2e/secret.txt",
        "/%2E%2E%2Fsecret.txt",
        "/assets/..%2f..%2fsecret.txt",
        "/..%5csecret.txt",
        "/%2e%2e%5csecret.txt",
        "/escape",
        "/%00",
    ],
)
def test_traversal_cannot_escape_the_static_root(client, path):
    response = client.get(path)
    assert SECRET not in response.text
    assert response.status_code in (200, 404)
    if response.status_code == 200:
        assert response.text == INDEX
