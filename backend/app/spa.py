from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles


def mount_spa(app: FastAPI, static_dir: Path) -> None:
    """Serve the built frontend from static_dir. Register after every API route."""
    # Symlink-resolved root the SPA catch-all confines every request to
    static_root = static_dir.resolve()

    # Mount assets directory for JS, CSS, and other static files
    assets_path = static_dir / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    # Serve index.html for the root path
    @app.get("/")
    async def serve_root() -> FileResponse:
        return FileResponse(static_dir / "index.html")

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
        try:
            file_path = (static_dir / full_path).resolve()
            if file_path.is_relative_to(static_root) and file_path.is_file():
                return FileResponse(file_path)
        except (ValueError, OSError):
            pass
        # Otherwise return index.html for SPA routing
        return FileResponse(static_dir / "index.html")
