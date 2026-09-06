# IPTV Viewer

A shared live TV player with optional ErsatzTV guide, Plex login, chat, highlight export and Chromecast controls.

## Local development

Install Node 22+, npm, Python 3.13 and uv. FFmpeg is required for enabled highlight/Chromecast transcoding features.

```bash
cd backend
uv sync --frozen
cp .env.example .env
```

Edit `backend/.env`: generate a signing key with `openssl rand -hex 32`, replace `JWT_SECRET`, and set a unique `ADMIN_PASSWORD` with `LOCAL_AUTH_ENABLED=true`. Blank local passwords disable that account. Set your Dispatcharr URL/API key; configure ErsatzTV/Plex only if used. Never commit credentials.

```bash
cd ../frontend
npm ci
cd ..
./run.sh
```

Open `http://localhost:5173`. From another device on the same network, open `http://<development-machine-ip>:5173`. The frontend binds all interfaces; use a trusted development network. The backend listens on port 8001, and Vite proxies browser HTTP and WebSocket `/api` traffic to it. No frontend `.env` is required. ErsatzTV API calls use the same proxy. Browser clients must not use `localhost` to refer to a different machine.

Separate terminals work as well:

```bash
cd backend && uv run uvicorn app.main:app --reload --port 8001
```

```bash
cd frontend && npm run dev
```

## Settings and optional features

| File | Purpose |
| --- | --- |
| `backend/.env` | Local backend configuration, based on `backend/.env.example` |
| `frontend/.env` | Optional Vite build configuration, based on `frontend/.env.example` |
| Root `.env` | Docker Compose configuration, based on root `.env.example` |

The default frontend API path is `/api` in development and production. Set `VITE_API_URL` only when intentionally using a separate API origin. WebSockets use the browser origin. Chromecast must reach the media server itself; `VITE_CAST_BASE_URL` overrides its API origin, and local casting may require a backend bound to a receiver-reachable interface. Browser proxy tests do not establish physical receiver reachability.

Administrators control the shared live broadcast and settings; viewer channel selection is configurable. Highlights and Cast are optional server features with bounded subprocess/export budgets. Recording buffers and temporary exports use the configured temporary storage roots; retain enough disk space for enabled channels and upload/export limits. Exported trims and formats use the held preview bytes.

## Verification

```bash
cd backend && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run basedpyright
```

```bash
cd frontend && npm test && npm run lint && npm run build
node scripts/check-dev-proxy.mjs
node scripts/check-service-worker.mjs
```

The browser scripts require Chrome (`CHROME_BIN` overrides its executable) and use temporary profiles with synthetic upstream data. The dev proxy check requires port 8001 free. These checks do not require or contact configured media providers.

## Docker

Configure root `.env` with strong credentials and your upstream URLs, then run `docker compose up --build`. Production serves the frontend and API from one origin. See the environment examples for feature switches and media resource limits.
