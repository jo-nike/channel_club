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

    @app.get("/api/known")
    async def known() -> dict[str, bool]:
        return {"ok": True}

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


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE"])
@pytest.mark.parametrize("path", ["/api", "/api/", "/api/nope", "/api/auth/removed/route"])
def test_unknown_api_path_is_404_json_not_the_shell(client, method, path):
    response = client.request(method, path)
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_registered_api_route_still_wins(client):
    assert client.get("/api/known").json() == {"ok": True}


def test_hashed_assets_are_immutable(client):
    response = client.get("/assets/index-abc123.js")
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


@pytest.mark.parametrize("path", ["/", "/index.html", "/sw.js", "/watch/channel-7"])
def test_shell_and_service_worker_are_revalidated(client, path):
    assert client.get(path).headers["cache-control"] == "no-cache"


def test_other_root_files_get_no_cache_policy(client):
    assert "cache-control" not in client.get("/favicon.svg").headers
