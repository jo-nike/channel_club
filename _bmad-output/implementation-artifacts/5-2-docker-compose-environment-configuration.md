# Story 5.2: Docker Compose & Environment Configuration

Status: review

## Story

As a developer,
I want docker-compose for easy deployment,
So that I can manage the app alongside my other services.

## Acceptance Criteria

1. **Given** docker-compose.yml in project root
   **When** I run `docker-compose up -d`
   **Then** the container builds (if needed) and starts
   **And** environment variables are loaded from .env file
   **And** container restarts automatically on failure

2. **Given** .env.example in project root
   **When** a new developer clones the repo
   **Then** they can copy to .env and fill in their values
   **And** all required variables are documented

## Tasks / Subtasks

- [x] Task 1: Create docker-compose.yml (AC: #1)
  - [x] 1.1: Define service using local Dockerfile build
  - [x] 1.2: Configure port mapping (8080:8080)
  - [x] 1.3: Set restart policy to `unless-stopped`
  - [x] 1.4: Configure env_file to load from `.env`
  - [x] 1.5: Add healthcheck for container monitoring

- [x] Task 2: Create .env.example with documentation (AC: #2)
  - [x] 2.1: Document all backend environment variables
  - [x] 2.2: Add comments explaining each variable's purpose
  - [x] 2.3: Include placeholder values showing expected format

- [x] Task 3: Update .gitignore (AC: #2)
  - [x] 3.1: Ensure `.env` is ignored (not committed)
  - [x] 3.2: Ensure `.env.example` is NOT ignored (should be committed)

- [x] Task 4: Test deployment workflow (AC: #1, #2)
  - [x] 4.1: Copy .env.example to .env and fill values
  - [x] 4.2: Run `docker-compose up -d --build`
  - [x] 4.3: Verify container starts and stays running
  - [x] 4.4: Verify automatic restart after simulated failure
  - [x] 4.5: Verify app accessible at localhost:8080

## Dev Notes

### Docker Compose Structure

```yaml
version: '3.8'

services:
  iptv-viewer:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: iptv-viewer
    ports:
      - "8080:8080"
    env_file:
      - .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Environment Variables Template (.env.example)

```bash
# IPTV Viewer Configuration
# Copy this file to .env and fill in your values

# ===================
# Backend Configuration
# ===================

# Dispatcharr API URL (via Wireguard VPN)
# This is the internal IP of your VPS running Dispatcharr
DISPATCHARR_URL=http://10.8.0.2:9191

# JWT Secret Key - CHANGE THIS!
# Generate with: openssl rand -hex 32
JWT_SECRET=your-secret-key-change-me

# Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password

# Viewer Credentials
VIEWER_USERNAME=viewer
VIEWER_PASSWORD=change-this-password

# ===================
# Frontend Configuration (Build-time)
# ===================

# API URL - relative path for same-origin requests
VITE_API_URL=/api

# WebSocket URL - full URL for production
# Replace domain.com with your actual domain
VITE_WS_URL=wss://iptv.domain.com/api/ws

# Stream base URL - where Dispatcharr streams are exposed
# Replace domain.com with your actual domain
VITE_STREAM_BASE_URL=https://streams.domain.com
```

### Healthcheck Endpoint

Add a simple health endpoint to `backend/app/routers/` or directly in `main.py`:

```python
@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}
```

### Critical Configuration

- **Restart Policy:** `unless-stopped` ensures container restarts after crashes but respects manual stops
- **Port Mapping:** External 8080 → Internal 8080
- **Build Context:** `.` (project root) with `Dockerfile`
- **Environment Loading:** `env_file` directive loads `.env` at container start

### .gitignore Entries

Ensure these entries exist:

```gitignore
# Environment files
.env
.env.local
.env.*.local

# Keep the example file
!.env.example
```

### Deployment Workflow

1. Clone repository
2. `cp .env.example .env`
3. Edit `.env` with actual values
4. `docker-compose up -d --build`
5. Access at http://localhost:8080

### Network Considerations

- Container needs access to Wireguard VPN network (10.8.0.x) to reach Dispatcharr
- If running on VPS with Wireguard already configured at host level, container inherits network access
- For isolated networks, may need `network_mode: host` or proper bridge configuration

### Project Structure Notes

**Files to create:**
- `docker-compose.yml` (project root)
- `.env.example` (project root)

**Files to modify:**
- `.gitignore` (add .env exclusion)
- `backend/app/main.py` (add health endpoint if not exists)

**Alignment with architecture:**
- Docker Compose for deployment as specified
- Environment variable pattern matches architecture document
- Restart policy for reliability (NFR6-8)

### References

- [Source: architecture.md#Infrastructure & Deployment]
- [Source: architecture.md#Environment Variables]
- [Source: epics.md#Story 5.2: Docker Compose & Environment Configuration]
- [Source: project-context.md#Environment Variables]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

None required - straightforward implementation.

### Completion Notes List

- Created `docker-compose.yml` using modern format (without version key for Compose Spec v2)
- Configured single service `iptv-viewer` that builds from local Dockerfile
- Port mapping 8080:8080 matches Dockerfile EXPOSE
- Restart policy `unless-stopped` for crash recovery while respecting manual stops
- Added healthcheck using curl to `/api/health` endpoint (already exists in backend)
- Updated Dockerfile to install `curl` for healthcheck functionality
- Created comprehensive `.env.example` with all backend and frontend environment variables documented
- Updated `.gitignore` to explicitly unignore `.env.example` with `!.env.example` pattern
- Verified deployment workflow: container builds, starts, stays healthy, and auto-restarts on failure
- All acceptance criteria met and tested

### Change Log

- 2025-12-28: Story 5-2 implemented - Docker Compose and environment configuration complete

### File List

- docker-compose.yml (created)
- .env.example (created)
- Dockerfile (modified - added curl installation for healthcheck)
- .gitignore (modified - added !.env.example unignore rule)
