from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.routers.auth import router as auth_router
from app.routers.channels import router as channels_router
from app.routers.websocket import router as websocket_router

app = FastAPI(title="IPTV Viewer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routers FIRST (they take precedence over static files)
app.include_router(auth_router, prefix="/api/auth")
app.include_router(channels_router, prefix="/api")
app.include_router(websocket_router)


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


# Static file serving for production (when running in Docker container)
# The static directory contains the built frontend assets
static_path = Path(__file__).parent.parent / "static"

if static_path.exists():
    # Mount assets directory for JS, CSS, and other static files
    assets_path = static_path / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    # Serve index.html for the root path
    @app.get("/")
    async def serve_root() -> FileResponse:
        return FileResponse(static_path / "index.html")

    # Catch-all route for SPA client-side routing
    # This must be defined AFTER all other routes
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:
        # Check if requesting a static file that exists
        file_path = static_path / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        # Otherwise return index.html for SPA routing
        return FileResponse(static_path / "index.html")
