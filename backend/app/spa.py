import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.staticfiles import PathLike
from starlette.types import Scope

# Vite content-hashes everything under /assets, so a URL never changes content.
IMMUTABLE = "public, max-age=31536000, immutable"
# The shell and service-worker files keep their names across deploys, so the
# browser must revalidate them (ETag) on every load to pick up a new build.
NO_CACHE_FILES = frozenset({"index.html", "sw.js", "registerSW.js", "manifest.webmanifest"})
NO_CACHE = {"Cache-Control": "no-cache"}
# With DOCS_ENABLED off FastAPI registers none of these, so they would fall
# through to the SPA shell; answer 404 as if the app had no such page.
API_DOCS_PATHS = frozenset({"docs", "redoc", "openapi.json"})
API_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]


class ImmutableStaticFiles(StaticFiles):
    def file_response(
        self, full_path: PathLike, stat_result: os.stat_result, scope: Scope, status_code: int = 200
    ) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)
        response.headers["Cache-Control"] = IMMUTABLE
        return response


def mount_spa(app: FastAPI, static_dir: Path) -> None:
    """Serve the built frontend from static_dir. Register after every API route."""
    # Symlink-resolved root the SPA catch-all confines every request to
    static_root = static_dir.resolve()

    # Mount assets directory for JS, CSS, and other static files
    assets_path = static_dir / "assets"
    if assets_path.exists():
        app.mount("/assets", ImmutableStaticFiles(directory=assets_path), name="assets")

    # Unknown API paths answer 404 JSON for every method rather than falling
    # through to the SPA shell (200 HTML) or the catch-all's 405.
    async def api_not_found() -> None:
        raise HTTPException(status_code=404, detail="Not Found")

    for path in ("/api", "/api/{rest:path}"):
        app.add_api_route(path, api_not_found, methods=API_METHODS, include_in_schema=False)

    # Serve index.html for the root path
    @app.get("/")
    async def serve_root() -> FileResponse:
        return FileResponse(static_dir / "index.html", headers=NO_CACHE)

    # Catch-all route for SPA client-side routing
    # This must be defined AFTER all other routes
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        # uvicorn percent-decodes the request path without normalising "..", so
        # a request for /%2e%2e%2f%2e%2e%2fetc%2fpasswd arrives here verbatim.
        # Resolve the join and serve it only if it stays inside the static root,
        # otherwise the catch-all hands out any file the process can read.
        # resolve()/is_file() touch the filesystem, so a percent-encoded NUL
        # (/%00) or other malformed path raises ValueError/OSError — swallow it
        # and fall back to the SPA rather than 500-ing with a traceback.
        if full_path in API_DOCS_PATHS:
            raise HTTPException(status_code=404, detail="Not Found")
        try:
            file_path = (static_dir / full_path).resolve()
            if file_path.is_relative_to(static_root) and file_path.is_file():
                relative = file_path.relative_to(static_root).as_posix()
                return FileResponse(
                    file_path, headers=NO_CACHE if relative in NO_CACHE_FILES else None
                )
        except (ValueError, OSError):
            pass
        # Otherwise return index.html for SPA routing
        return FileResponse(static_dir / "index.html", headers=NO_CACHE)
