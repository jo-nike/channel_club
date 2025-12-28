# Story 5.1: Docker Container Build

Status: review

## Story

As a developer,
I want a Docker container that runs the complete app,
So that I can deploy it easily to my VPS.

## Acceptance Criteria

1. **Given** the Dockerfile in project root
   **When** I run `docker build -t iptv-viewer .`
   **Then** frontend builds with Vite and outputs to static folder
   **And** backend installs dependencies via uv
   **And** final image serves both frontend static files and API on port 8080

2. **Given** a built container
   **When** I run `docker run -p 8080:8080 --env-file .env iptv-viewer`
   **Then** the app starts and is accessible at localhost:8080
   **And** all environment variables are loaded correctly

## Tasks / Subtasks

- [x] Task 1: Create multi-stage Dockerfile (AC: #1)
  - [x] 1.1: Create Node.js build stage for frontend (node:22)
  - [x] 1.2: Copy frontend files and run `npm ci && npm run build`
  - [x] 1.3: Create Python runtime stage (python:3.13-slim)
  - [x] 1.4: Install uv and sync backend dependencies
  - [x] 1.5: Copy frontend build artifacts to `./static` directory
  - [x] 1.6: Configure uvicorn to serve on port 8080

- [x] Task 2: Configure FastAPI to serve static files (AC: #1, #2)
  - [x] 2.1: Mount static file directory in main.py
  - [x] 2.2: Add catch-all route for SPA routing (return index.html for non-API routes)
  - [x] 2.3: Ensure /api routes take precedence over static file serving

- [x] Task 3: Test container build and run (AC: #1, #2)
  - [x] 3.1: Build image with `docker build -t iptv-viewer .`
  - [x] 3.2: Run container with test environment variables
  - [x] 3.3: Verify frontend loads at localhost:8080
  - [x] 3.4: Verify API endpoints respond at localhost:8080/api/*
  - [x] 3.5: Verify WebSocket connects at ws://localhost:8080/api/ws

## Dev Notes

### Dockerfile Structure (from Architecture)

The architecture specifies a multi-stage build:

```dockerfile
# Build frontend
FROM node:22 AS frontend-build
WORKDIR /app/frontend
COPY frontend/ .
RUN npm ci && npm run build

# Production
FROM python:3.13-slim
WORKDIR /app
COPY backend/ .
COPY --from=frontend-build /app/frontend/dist ./static
RUN pip install uv && uv sync
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### Static File Serving Pattern

FastAPI must:
1. Serve API routes at `/api/*`
2. Serve static files (JS, CSS, assets) from `/static`
3. Return `index.html` for all other routes (SPA client-side routing)

Example pattern for `main.py`:

```python
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

app = FastAPI()

# Mount API routers first
app.include_router(auth_router, prefix="/api")
app.include_router(channels_router, prefix="/api")

# Mount static files
static_path = Path(__file__).parent.parent / "static"
if static_path.exists():
    app.mount("/assets", StaticFiles(directory=static_path / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(static_path / "index.html")
```

### Critical Configuration

- **Port:** 8080 (internal container port)
- **Python Version:** 3.13-slim base image
- **Node Version:** 22 for frontend build
- **Package Manager:** uv (not pip directly)
- **Build Output:** `frontend/dist` → `static/`

### Environment Variables Required

The container expects these environment variables at runtime:

**Backend:**
- `DISPATCHARR_URL=http://10.8.0.2:9191`
- `JWT_SECRET=<secret-key>`
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=<password>`
- `VIEWER_USERNAME=viewer`
- `VIEWER_PASSWORD=<password>`

**Frontend (build-time):**
- `VITE_API_URL=/api`
- `VITE_WS_URL=wss://iptv.domain.com/api/ws`
- `VITE_STREAM_BASE_URL=https://streams.domain.com`

### Technology Notes

- **mpegts.js:** Used for video playback (not Vidstack as originally planned - see architecture post-implementation update)
- **Vite Build:** Outputs to `dist/` with assets in `dist/assets/`
- **uv sync:** Installs dependencies from `pyproject.toml` and `uv.lock`

### Project Structure Notes

**Files to create/modify:**
- `Dockerfile` (new - project root)
- `backend/app/main.py` (modify - add static file serving)

**Alignment with architecture:**
- Single container serving frontend + backend as specified
- Port 8080 as documented
- Multi-stage build for smaller final image

### References

- [Source: architecture.md#Docker Structure]
- [Source: architecture.md#Infrastructure & Deployment]
- [Source: epics.md#Story 5.1: Docker Container Build]
- [Source: project-context.md#Python/FastAPI Rules]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None - implementation completed without issues.

### Completion Notes List

- Created multi-stage Dockerfile following architecture specifications
- Stage 1: node:22-slim for frontend build with npm ci && npm run build
- Stage 2: python:3.13-slim for production runtime with uv for dependency management
- Modified backend/app/main.py to serve static files conditionally (only when static/ directory exists)
- API routes registered BEFORE static file serving to ensure /api/* routes take precedence
- Added catch-all route for SPA client-side routing that serves index.html for non-API, non-asset paths
- All 93 backend tests pass after modifications
- Container successfully builds and serves:
  - Frontend at localhost:8080/ (index.html with proper asset links)
  - Static assets at /assets/* (JS, CSS files)
  - API endpoints at /api/* (health, auth, channels)
  - WebSocket at /api/ws (101 Switching Protocols confirmed)

### File List

- Dockerfile (new)
- backend/app/main.py (modified)

## Change Log

- 2025-12-28: Initial implementation of Docker container build story
  - Created Dockerfile with multi-stage build (node:22-slim + python:3.13-slim)
  - Added static file serving to FastAPI main.py for production deployment
  - Verified all acceptance criteria met via manual testing
