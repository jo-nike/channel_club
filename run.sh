#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  echo ""
  echo "Shutting down..."
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting backend on :8001..."
(cd "$ROOT_DIR/backend" && uv run uvicorn app.main:app --reload --port 8001) &
BACKEND_PID=$!

echo "Starting frontend at http://localhost:5173 (LAN: http://<this-machine-ip>:5173)..."
echo "Browser /api HTTP and WebSocket traffic is proxied to backend :8001."
(cd "$ROOT_DIR/frontend" && npm run dev) &
FRONTEND_PID=$!

wait -n
