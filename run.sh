#!/usr/bin/env bash
# Start Channel Club locally: backend and frontend in one command.
#
#   ./run.sh                  dev: backend on :8001 (auto-reload) + Vite dev server on :5173
#   ./run.sh --prod           production build served by the backend on :8001, as in the
#                             Docker image (service worker, manifest and icons)
#   ./run.sh --local-auth     also allow signing in as a local admin with a random password
#                             (printed at start); the rest of the auth set in .env stays on
#   ./run.sh --branch REF     run REF (e.g. redesign/integration) from a disposable worktree
#                             under ~/.cache, leaving this checkout as it is
#
# Flags combine, e.g. ./run.sh --branch redesign/integration --prod --local-auth
# Configuration always comes from this checkout's .env. Stop with Ctrl-C.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$ROOT_DIR/$(basename "${BASH_SOURCE[0]}")"
cd "$ROOT_DIR"

usage() { sed -n '2,13p' "$SCRIPT_PATH" | sed 's/^# \{0,1\}//'; }

MODE=dev
LOCAL_AUTH=false
REF=""
while (($#)); do
  case "$1" in
    --prod) MODE=prod ;;
    --local-auth) LOCAL_AUTH=true ;;
    --branch)
      [[ $# -ge 2 && -n "$2" ]] || { echo "--branch needs a branch or commit" >&2; exit 2; }
      REF="$2"
      shift
      ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# Share the root configuration with Compose.
if [[ -f "$ROOT_DIR/.env" ]]; then
  ENV_FILE="$ROOT_DIR/.env"
else
  echo "No .env found. Copy .env.example to .env and configure authentication first." >&2
  exit 1
fi

REQUIRED=(uv npm setsid curl timeout)
[[ -n "$REF" ]] && REQUIRED+=(git)
for command in "${REQUIRED[@]}"; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

# Refuse before touching anything, so a second launch can't disturb a running one.
PORTS=(8001)
[[ "$MODE" == dev ]] && PORTS+=(5173)
for port in "${PORTS[@]}"; do
  if timeout 1 bash -c 'exec 3<>"/dev/tcp/127.0.0.1/$1"' _ "$port" 2>/dev/null; then
    echo "Cannot start: port $port is already in use. Stop the existing launcher first." >&2
    exit 1
  fi
done

# Which tree to run: this checkout, or REF in a worktree of its own.
APP_DIR="$ROOT_DIR"
if [[ -n "$REF" ]]; then
  # Resolve REF here once: inside the worktree, HEAD or @{-1} would name the worktree's own refs.
  COMMIT="$(git rev-parse --verify --quiet "$REF^{commit}")" \
    || { echo "Unknown branch or commit: $REF" >&2; exit 1; }
  APP_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/channel-club/worktrees/${REF//[^A-Za-z0-9._-]/-}"
  if [[ -e "$APP_DIR/.git" ]]; then
    if [[ "$(git -C "$APP_DIR" rev-parse --path-format=absolute --git-common-dir)" \
      != "$(git rev-parse --path-format=absolute --git-common-dir)" ]]; then
      echo "$APP_DIR belongs to another repository; remove it and try again." >&2
      exit 1
    fi
    if [[ -n "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]]; then
      echo "$APP_DIR has local edits; refusing to reset it." >&2
      exit 1
    fi
    git -C "$APP_DIR" checkout --quiet --detach "$COMMIT"
  else
    mkdir -p "$(dirname "$APP_DIR")"
    # Forget registrations whose directories were deleted (e.g. a cleared ~/.cache).
    git worktree prune
    git worktree add --quiet --detach "$APP_DIR" "$COMMIT"
  fi
  # The worktree has no frontend/.env of its own; share this checkout's, if there is one.
  if [[ -f "$ROOT_DIR/frontend/.env" && ! -e "$APP_DIR/frontend/.env" ]]; then
    ln -s "$ROOT_DIR/frontend/.env" "$APP_DIR/frontend/.env"
  fi
  echo "Running $REF ($(git -C "$APP_DIR" log --oneline -1)) from $APP_DIR"
fi

if [[ "$LOCAL_AUTH" == true ]]; then
  # Shell variables take precedence over --env-file, so .env stays untouched.
  export LOCAL_AUTH_ENABLED=true ADMIN_USERNAME=admin
  ADMIN_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
  JWT_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '/+=')"
  export ADMIN_PASSWORD JWT_SECRET
fi

echo "Using configuration: $ENV_FILE"
# Validate before spawning a reload supervisor, which otherwise survives failed startup.
uv run --project "$APP_DIR/backend" --env-file "$ENV_FILE" python - "$APP_DIR/backend" <<'PY'
import sys

sys.path.insert(0, sys.argv[1])
from app.main import validate_auth_configuration

try:
    validate_auth_configuration()
except RuntimeError as error:
    print(f"Cannot start: {error}", file=sys.stderr)
    sys.exit(1)
PY

# Frontend dependencies: npm ci when they're missing or older than the lockfile.
if [[ ! -f "$APP_DIR/frontend/node_modules/.package-lock.json" \
  || "$APP_DIR/frontend/package-lock.json" -nt "$APP_DIR/frontend/node_modules/.package-lock.json" ]]; then
  echo "Installing frontend dependencies..."
  (cd "$APP_DIR/frontend" && npm ci --prefer-offline --no-audit --no-fund --loglevel=error)
fi

# The backend serves backend/static when it exists. --prod fills it with a fresh build; dev mode
# removes a build left by an earlier --prod run (only one this script made) so :8001 serves no stale app.
STATIC_DIR="$APP_DIR/backend/static"
if [[ "$MODE" == prod ]]; then
  if [[ -e "$STATIC_DIR" && ! -f "$STATIC_DIR/.built-by-run-sh" ]]; then
    echo "$STATIC_DIR exists and wasn't made by run.sh; move it away first." >&2
    exit 1
  fi
  echo "Building the frontend..."
  (cd "$APP_DIR/frontend" && npm run build --silent)
  rm -rf -- "$STATIC_DIR"
  # Marker first, so a copy cut short is still recognised (and replaced) as ours.
  mkdir "$STATIC_DIR"
  touch "$STATIC_DIR/.built-by-run-sh"
  cp -r "$APP_DIR/frontend/dist/." "$STATIC_DIR"
elif [[ -f "$STATIC_DIR/.built-by-run-sh" ]]; then
  rm -rf -- "$STATIC_DIR"
fi

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
if [[ "$MODE" == dev ]]; then
  (cd "$APP_DIR" && exec setsid uv run --project "$APP_DIR/backend" --env-file "$ENV_FILE" \
    uvicorn app.main:app --app-dir "$APP_DIR/backend" --reload \
    --reload-dir "$APP_DIR/backend" --port 8001) &
else
  # Listen on all interfaces so phones on the LAN can reach the production build directly.
  (cd "$APP_DIR" && exec setsid uv run --project "$APP_DIR/backend" --env-file "$ENV_FILE" \
    uvicorn app.main:app --app-dir "$APP_DIR/backend" --host 0.0.0.0 --port 8001) &
fi
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

PORT=8001
if [[ "$MODE" == dev ]]; then
  echo "Starting the Vite dev server on :5173 (browser /api traffic is proxied to :8001)..."
  (cd "$APP_DIR/frontend" && exec setsid npm run dev -- --port 5173 --strictPort) &
  FRONTEND_PID=$!
  PORT=5173
fi

# The home-LAN address: eth0 first (hostname -I lists VPN and Docker bridges before it).
LAN_IP="$(ip -4 -o addr show eth0 2>/dev/null | awk '{sub(/\/.*/, "", $4); print $4; exit}' || true)"
[[ -n "$LAN_IP" ]] || LAN_IP="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -m1 '^192\.168\.' || true)"

echo ""
echo "Channel Club is running ($MODE mode)"
echo "  This machine: http://localhost:$PORT"
[[ -n "$LAN_IP" ]] && echo "  LAN:          http://$LAN_IP:$PORT"
[[ "$LOCAL_AUTH" == true ]] && echo "  Sign in:      admin / $ADMIN_PASSWORD"
if [[ "$MODE" == prod && -n "$LAN_IP" ]]; then
  echo "  To install the app on Android over plain http, Chrome needs the origin marked secure:"
  echo "  open chrome://flags/#unsafely-treat-insecure-origin-as-secure, add http://$LAN_IP:$PORT,"
  echo "  relaunch Chrome, then use Install app."
fi
echo "Press Ctrl-C to stop."

if [[ "$MODE" == dev ]]; then
  wait -n "$BACKEND_PID" "$FRONTEND_PID"
else
  wait "$BACKEND_PID"
fi
