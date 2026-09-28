# Stage 1: Build frontend
FROM node:22-slim AS frontend-build

# Build args for Vite env vars (must be present at build time)
ARG VITE_API_URL=/api
ARG VITE_WS_URL
ARG VITE_STREAM_BASE_URL
ARG VITE_CHAT_ENABLED=false
ARG VITE_GIF_ENABLED=false
ARG VITE_LOG_LEVEL=info

# Set as env vars so Vite can access them during build
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_STREAM_BASE_URL=$VITE_STREAM_BASE_URL
ENV VITE_CHAT_ENABLED=$VITE_CHAT_ENABLED
ENV VITE_GIF_ENABLED=$VITE_GIF_ENABLED
ENV VITE_LOG_LEVEL=$VITE_LOG_LEVEL

WORKDIR /app/frontend

# Copy package files first for better layer caching
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# The client compares its build id with the server's; declared after npm ci
# so a new build id doesn't invalidate the dependency layer
ARG APP_BUILD_ID=dev
ENV VITE_APP_BUILD_ID=$APP_BUILD_ID

# Copy frontend source
COPY frontend/ .

# Build frontend (output to dist/)
RUN npm run build

# Stage 2: Production runtime
FROM python:3.13-slim

# Build identity is distinct from the application version in pyproject.toml.
ARG APP_BUILD_ID=dev
ARG APP_REVISION=dev
ENV APP_BUILD_ID=$APP_BUILD_ID
ENV APP_REVISION=$APP_REVISION

# Cache-buster for the apt upgrade below. CI passes today's date so the layer
# re-runs daily; without it a warm build cache reuses a stale layer and the
# image ships base-OS packages that the vulnerability scan rightly fails on.
ARG APT_REFRESH=0

WORKDIR /app

# Install curl for healthcheck, ffmpeg for highlight capture, and uv for Python package management
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends curl ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

# Copy backend dependency files first for better layer caching
COPY backend/pyproject.toml backend/uv.lock ./

# Install Python dependencies, then drop the build-only tooling. uv and pip are
# not on any runtime path (the CMD invokes .venv/bin/uvicorn directly), and
# pip's vendored tree carries CVEs we cannot patch and do not run — keeping the
# image scan actionable on things that actually ship.
RUN uv sync --frozen --no-dev \
    && rm -rf /usr/local/bin/uv /usr/local/bin/uvx \
       /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.13 \
       /usr/local/lib/python3.13/site-packages/uv \
       /usr/local/lib/python3.13/site-packages/uv-*.dist-info \
       /usr/local/lib/python3.13/site-packages/pip \
       /usr/local/lib/python3.13/site-packages/pip-*.dist-info

# Copy backend source code
COPY backend/app ./app

# Copy frontend build artifacts to static directory
COPY --from=frontend-build /app/frontend/dist ./static

# Run as a non-root user (Trivy DS-0002). The highlight and cast features write
# to their temp dirs, so create them up front owned by appuser rather than
# relying on the app to mkdir them at runtime. /data holds the state file
# (admin settings and Live); compose mounts a named volume there, which Docker
# seeds from this directory with its ownership.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /tmp/highlights /tmp/cast_hls /data \
    && chown -R appuser:appuser /app /tmp/highlights /tmp/cast_hls /data
ENV STATE_FILE=/data/state.json
USER appuser

# Expose port 8080
EXPOSE 8080

# Invoke the venv's uvicorn directly rather than via `uv run`: uv would try to
# re-resolve and write to the environment at startup, which a non-root user
# cannot do.
# The frame ceiling sits above the app's 16 KiB message cap (MAX_MESSAGE_BYTES)
# so oversize frames are refused (1009) before uvicorn buffers them; without
# permessage-deflate a small frame cannot inflate into a large one.
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", \
     "--ws-max-size", "32768", "--ws-per-message-deflate", "false", \
     "--timeout-graceful-shutdown", "8"]
