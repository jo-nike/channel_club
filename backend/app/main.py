from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.config import settings
from app.logging_config import configure_logging
from app.routers.admin import router as admin_router
from app.routers.auth import router as auth_router
from app.routers.channels import router as channels_router
from app.routers.epg import router as epg_router
from app.routers.ersatztv import router as ersatztv_router
from app.routers.highlight import router as highlight_router
from app.routers.websocket import router as websocket_router
from app.services.highlight import highlight_service


def validate_auth_configuration() -> None:
    """Validate authentication configuration on startup."""
    if not settings.local_auth_enabled and not settings.plex_auth_enabled:
        logger.warning(
            "No authentication methods enabled! "
            "Set LOCAL_AUTH_ENABLED=true or PLEX_AUTH_ENABLED=true"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown events."""
    # Startup
    configure_logging()
    logger.info(
        "IPTV Viewer API starting",
        version="0.1.0",
        log_level=settings.log_level,
        log_format=settings.log_format,
    )
    if settings.highlight_enabled:
        logger.info(
            "Highlight capture enabled (buffer: {}s, segments: {}s)",
            settings.highlight_buffer_seconds,
            settings.highlight_segment_seconds,
        )
        # Clean up any stale segments from previous runs
        highlight_service.cleanup_stale_segments()
    validate_auth_configuration()
    yield
    # Shutdown
    logger.info("IPTV Viewer API shutting down")
    # Stop all highlight recorders
    await highlight_service.stop_all()


app = FastAPI(title="IPTV Viewer API", lifespan=lifespan)

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
app.include_router(epg_router, prefix="/api")
app.include_router(ersatztv_router)
app.include_router(admin_router, prefix="/api/admin")
app.include_router(highlight_router)
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
