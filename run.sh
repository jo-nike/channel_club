#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Share the root configuration with Compose; retain older local-only setups.
if [[ -f "$ROOT_DIR/.env" ]]; then
  ENV_FILE="$ROOT_DIR/.env"
elif [[ -f "$ROOT_DIR/backend/.env" ]]; then
  ENV_FILE="$ROOT_DIR/backend/.env"
else
  echo "No .env found. Copy .env.example to .env and configure authentication first." >&2
  exit 1
fi

for command in uv npm setsid curl; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

echo "Using configuration: $ENV_FILE"
# Validate before spawning a reload supervisor, which otherwise survives failed startup.
uv run --project "$ROOT_DIR/backend" --env-file "$ENV_FILE" python - <<'PY'
import socket
import sys

sys.path.insert(0, "backend")
from app.main import validate_auth_configuration

try:
    validate_auth_configuration()
except RuntimeError as error:
    print(f"Cannot start: {error}", file=sys.stderr)
    sys.exit(1)
for port in (8001, 5173):
    with socket.socket() as connection:
        connection.settimeout(0.5)
        if connection.connect_ex(("127.0.0.1", port)) == 0:
            print(f"Cannot start: port {port} is already in use. Stop the existing launcher first.", file=sys.stderr)
            sys.exit(1)
PY

cleanup() {
  trap - EXIT INT TERM
  echo ""
  echo "Shutting down..."
  # Each service has its own process group, including reloaders and npm children.
  for pid in "${BACKEND_PID:-}" "${FRONTEND_PID:-}"; do
    if [[ -n "$pid" ]]; then kill -TERM -- "-$pid" 2>/dev/null || true; fi
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Starting backend on :8001..."
setsid uv run --project "$ROOT_DIR/backend" --env-file "$ENV_FILE" \
  uvicorn app.main:app --app-dir "$ROOT_DIR/backend" --reload \
  --reload-dir "$ROOT_DIR/backend" --port 8001 &
BACKEND_PID=$!

READY=false
for ((attempt = 0; attempt < 60; attempt++)); do
  if curl --silent --fail --max-time 1 http://127.0.0.1:8001/api/health >/dev/null; then
    READY=true
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then break; fi
  sleep 0.5
done
if [[ "$READY" != true ]]; then
  echo "Backend did not become ready. Check the startup error above." >&2
  exit 1
fi

echo "Starting frontend at http://localhost:5173 (LAN: http://<this-machine-ip>:5173)..."
echo "Browser /api HTTP and WebSocket traffic is proxied to backend :8001."
(cd "$ROOT_DIR/frontend" && exec setsid npm run dev -- --port 5173 --strictPort) &
FRONTEND_PID=$!

wait -n "$BACKEND_PID" "$FRONTEND_PID"
