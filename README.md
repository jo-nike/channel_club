# Channel Club

**Good TV. Better company.**

Version **1.1.0**.

A shared live TV player with optional ErsatzTV guide, Plex login, chat, highlight export and Chromecast controls.

## Local development

Install Node 22+, npm, Python 3.13 and uv. FFmpeg is required for enabled highlight/Chromecast transcoding features.

```bash
cd backend
uv sync --frozen
cd ..
cp .env.example .env
```

Edit the root `.env`: generate a signing key with `openssl rand -hex 32`, replace `JWT_SECRET`, and set a unique `ADMIN_PASSWORD` with `LOCAL_AUTH_ENABLED=true`. Blank local passwords disable that account. Set your Dispatcharr URL/API key; configure ErsatzTV/Plex only if used. Never commit credentials.

```bash
cd frontend
npm ci
cd ..
./run.sh
```

`run.sh` prints the selected configuration file, validates authentication, waits for backend readiness, and rejects occupied ports instead of silently switching URLs. Stop it with Ctrl+C to shut down both services.

Open `http://localhost:5173`. From another device on the same network, open `http://<development-machine-ip>:5173`. The frontend binds all interfaces; use a trusted development network. The backend listens on port 8001, and Vite proxies browser HTTP and WebSocket `/api` traffic to it. No frontend `.env` is required. ErsatzTV API calls use the same proxy. Browser clients must not use `localhost` to refer to a different machine.

Separate terminals work as well:

```bash
uv run --project backend --env-file .env uvicorn app.main:app --app-dir backend --reload --reload-dir backend --port 8001
```

```bash
cd frontend && npm run dev
```

## Settings and optional features

| File | Purpose |
| --- | --- |
| `frontend/.env` | Optional Vite build configuration, based on `frontend/.env.example` |
| Root `.env` | Shared `run.sh` and Docker Compose configuration, based on root `.env.example` |

The default frontend API path is `/api` in development and production. Set `VITE_API_URL` only when intentionally using a separate API origin. WebSockets use the browser origin. Chromecast must reach the media server itself; `VITE_CAST_BASE_URL` overrides its API origin, and local casting may require a backend bound to a receiver-reachable interface. Browser proxy tests do not establish physical receiver reachability.

Administrators control the shared live broadcast and settings; viewer channel selection is configurable. Highlights and Cast are optional server features with bounded subprocess/export budgets. Recording buffers and temporary exports use the configured temporary storage roots; retain enough disk space for enabled channels and upload/export limits. Captures are held server-side for up to 15 minutes (one per user) and streamed to the editor by byte range; exported trims and formats are cut from that held capture, never from the live buffer.

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

Configure root `.env` with strong credentials and your upstream URLs, then run `docker compose up --build`. The container is named `channel-club`; the internal Compose service remains `iptv-viewer` for deployment compatibility. Production serves the frontend and API from one origin. See the environment examples for feature switches and media resource limits.

### Clip capture and optional Zipline uploads

Enable `HIGHLIGHT_ENABLED=true` to capture recent footage from the player. The editor holds a fixed snapshot: choose a preset or drag Start/End, preview the selection, and download MP4 or WebM. Trimmed exports prioritize accurate cuts and can take longer than a full MP4 download. FFmpeg and FFprobe are required (both are included in the Docker image).

Zipline is optional and **off by default**. To allow all authenticated viewers to upload clips through a shared Zipline v4 account, set these backend environment variables and restart the backend/container:

```dotenv
ZIPLINE_ENABLED=true
ZIPLINE_URL=https://clips.example.com
ZIPLINE_TOKEN=your-account-token
```

Use the instance base URL, without `/api/upload`. Keep the token in backend configuration; do not use a `VITE_` variable. Docker Compose already reads these settings from `.env`. When the flag is off, the app makes no Zipline requests and shows no upload action, even if credentials are present. Missing/invalid configuration disables only uploads and is reported in the server startup log; capture and download remain available.

Upload uses the same selected range and format as Download. A successful upload displays Zipline's returned URL with Copy and Open actions. Zipline's configured naming, retention, quotas, and size limits apply. If an upload times out, check Zipline before retrying because the file may already have arrived. There is no automatic upload retry.

If you use a reverse proxy, allow request bodies up to your `MEDIA_EXPORT_MAX_BYTES` setting (default 256 MiB) and at least 150 seconds for clip export/upload responses. Smaller Zipline/proxy limits produce an upload error without losing the selection or disabling downloads.

### Feedback via ntfy

Feedback is optional and **off by default**. When configured, every logged-in viewer gets a "Send feedback" button in the header that opens a short form (bug / suggestion / other, a message, and an optional way to reach them). Each submission is pushed to an [ntfy](https://ntfy.sh) topic with the username, role, app version and build, current view, browser, and viewport attached, so a bug report is actionable without a follow-up. Set these backend environment variables and restart the backend/container:

```dotenv
NTFY_ENABLED=true
NTFY_URL=https://ntfy.sh
NTFY_TOPIC=channel-club-feedback
NTFY_TOKEN=your-access-token   # only for protected topics
```

Use the instance base URL without the topic. Topics are created on first publish, so just subscribe to the topic name on your phone. On a public server, choose a topic name that cannot be guessed. Keep the URL, topic, and token in backend configuration; do not use a `VITE_` variable. When the flag is off or the configuration is invalid, the button is hidden, `POST /api/feedback` returns 503, the app makes no ntfy requests, and the startup log names what is missing.

Each user may send one report every `FEEDBACK_COOLDOWN_SECONDS` (default 30) and at most `FEEDBACK_HOURLY_LIMIT` per hour (default 10); limits are per backend process. A failed delivery does not count against the user. Message bodies stay under ntfy's default 4 KiB message limit.

### Viewing analytics from logs

The backend emits structured presence events at INFO so viewing history can be charted from the log store without a database. Each event is a loguru record with bound fields (`event`, `user`, `session`, `view`, `channel`, `channel_id`, `programme`, `duration_s`, `reason`):

| event | when |
|---|---|
| `session.start` / `session.stop` | a viewer's WebSocket connects / disconnects (stop carries `duration_s` and a reason: `disconnect`, `stale`, `view_switch`) |
| `watch.start` / `watch.stop` | the viewer's selected channel changes (stop carries `duration_s`; reason `switch`, `cleared`, or the session reason). A programme title rollover on the same channel emits nothing. |
| `channel.change` | the shared live channel is changed (`user`, `channel`, `channel_id`) |

Run with `LOG_FORMAT=json` so the fields are machine-readable; in Loki they parse as `{container="channel-club"} | json | record_extra_event="watch.stop"`. The frontend sends `channelId` with every `channel_update` WebSocket message (the Dispatcharr stream UUID for Live, the tvg-id for ErsatzTV) so events join to the channel catalogue by id as well as by name. The Grafana dashboard that consumes these events is generated by `ops/grafana/generate-channel-club-dashboard.py` into `ops/grafana/dashboards/channel-club.json`; `backend/tests/test_analytics_contract.py` checks the events carry every field its queries read.

## Application version and releases

The Admin Panel header shows the frontend version. **Status → Channel Club** shows
frontend/backend versions, the exact build ID and source revision, independently
of upstream service health. `/api/health` exposes the same backend information.

`backend/pyproject.toml` is the authoritative application version. From the repository
root, update all application manifest/lockfile entries together:

```bash
python3 scripts/version.py --set 1.1.1
python3 scripts/version.py
```

The helper preserves dependency versions. Update the version shown in this README
when preparing a release. CI rejects mismatched application metadata.

Every successful `master` push builds and deploys a unique image such as
`gitea.example.com/jons-org/channel-club:1.1.0-build-abc1234-<build-id>`. Production
Compose uses the resulting immutable image digest, not a moving version tag.

To publish version **1.1.0**, push an annotated Git tag at the tested commit whose
application manifests say `1.1.0`:

```bash
git tag -a v1.1.0 -m "Channel Club 1.1.0"
git push origin v1.1.0
```

The tag workflow tests, builds, scans and publishes
`gitea.example.com/jons-org/channel-club:1.1.0`. It does not trigger another production
deployment. Later master builds never move this release tag. A retry reuses an
existing image with matching version/source labels; conflicting tags or registry
errors fail publication. No `latest` alias is published.

On the next normal deployment, Compose recreates the existing service with the
new `channel-club` container name and image repository. Port `8334`, the host stack
directory, Infisical secret path and Plex client identifier are unchanged. Update
any external monitoring that refers directly to the old container name. Historical
images remain available for digest-based rollback. See [release execution](scripts/README.md)
for verification and rollback details.
