# Stage 1: Build frontend
FROM node:22-slim AS frontend-build

# The bundle takes no configuration: the server sends its feature switches at
# runtime, so one image serves any deploy. Only the build id is baked in.
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
# The uv version moves together with UV_VERSION in .gitea/workflows/build.yml
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends curl ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.10.11

# Copy backend dependency files first for better layer caching
COPY backend/pyproject.toml backend/uv.lock ./

# Install Python dependencies, then drop the build-only tooling. uv and pip are
# not on any runtime path (the CMD invokes .venv/bin/uvicorn directly), and
# pip's vendored tree carries CVEs we cannot patch and do not run — keeping the
# image scan actionable on things that actually ship. The venv is compiled to
# .pyc here because the runtime user cannot write to it.
RUN UV_COMPILE_BYTECODE=1 uv sync --frozen --no-dev \
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
# seeds from this directory with its ownership. /app (code, venv, static) stays
# root-owned, so a bug in the app cannot rewrite what it runs or serves; the
# app package is compiled to .pyc now for the same reason as the venv.
RUN useradd --create-home --uid 10001 appuser \
    && python -m compileall -q /app/app \
    && mkdir -p /tmp/highlights /tmp/cast_hls /data \
    && chown appuser:appuser /tmp/highlights /tmp/cast_hls /data
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
