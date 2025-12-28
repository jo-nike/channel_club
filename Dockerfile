# Stage 1: Build frontend
FROM node:22-slim AS frontend-build

WORKDIR /app/frontend

# Copy package files first for better layer caching
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ .

# Build frontend (output to dist/)
RUN npm run build

# Stage 2: Production runtime
FROM python:3.13-slim

WORKDIR /app

# Install curl for healthcheck and uv for Python package management
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

# Copy backend dependency files first for better layer caching
COPY backend/pyproject.toml backend/uv.lock ./

# Install Python dependencies
RUN uv sync --frozen --no-dev

# Copy backend source code
COPY backend/app ./app

# Copy frontend build artifacts to static directory
COPY --from=frontend-build /app/frontend/dist ./static

# Expose port 8080
EXPOSE 8080

# Run uvicorn server
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
