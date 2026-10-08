# Channel Club

**Good TV. Better company.**

Version **1.2.0**.

A shared live TV player with Chromecast, and optional ErsatzTV guide, Plex login, chat, highlight export and NHL scores.

## Quick start

Build the image and run it with a volume for `/data`. No configuration is needed:

```bash
docker build -t channel-club .
docker run -d --name channel-club -p 8334:8080 -v channel-club-data:/data channel-club
```

Open `http://<docker-host>:8334` and the app sends you to `/setup`. The first visitor sets up the club and becomes its admin, so finish setup before you expose the port beyond a trusted network. Until then the log says "Setup is open". The wizard takes about five minutes:

1. **Your account:** sign in with Plex and pick the server you own (its members can then join), or make a username and password.
2. **Channels:** the Dispatcharr address and API key, the ErsatzTV address, or both, each with a connection test.
3. **Who can join:** Plex members and their admins, local accounts, and the house rules.
4. **Extras:** chat, GIFs, clips (with optional Zipline uploads), NHL scores and feedback via ntfy. Chromecast is always on.
5. **Review**, then open the club.

Everything can be changed later under **Admin Panel › Server**. Saved changes apply at once, without a restart. The wizard and the Server tab save to `/data/settings.json`; see [Settings saved from the app](#settings-saved-from-the-app). `docker compose up --build` works the same way: see [Docker](#docker).

## Local development

Install Node 22+, npm, Python 3.13 and uv. FFmpeg is required for Chromecast (always on) and for clips when enabled.

```bash
cd backend
uv sync --frozen
cd ..
cp .env.example .env
```

Edit the root `.env`, uncommenting what you set: set `JWT_SECRET` to a key from `openssl rand -hex 32` (`run.sh` sets no `STATE_FILE`, so there is nowhere to save a generated one), and a unique `ADMIN_PASSWORD` with `LOCAL_AUTH_ENABLED=true`. Blank local passwords disable that account. Set `DISPATCHARR_URL` and `DISPATCHARR_API_KEY`; the server and browsers both reach Dispatcharr at that URL (browsers play streams from it). Set `ERSATZTV_BASE_URL` and Plex only if used. Neither source URL has a default, and startup names any that is unset. Never commit credentials.

```bash
cd frontend
npm ci
cd ..
./run.sh
```

`run.sh` prints the selected configuration file, validates authentication, waits for backend readiness, and rejects occupied ports instead of silently switching URLs. Stop it with Ctrl+C to shut down both services.

To try the first-run wizard, run `./run.sh --setup`. It ignores `.env` and starts with a fresh data folder that is deleted when you stop it, so `/setup` opens and the environment locks nothing. It doesn't combine with `--local-auth`.

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
| Root `.env` | Shared `run.sh` and Docker Compose configuration, based on root `.env.example` |

The frontend build takes no configuration, so one image serves any deploy. It calls `/api` and opens its WebSocket on the page's origin, and the server says at connect time whether chat (`CHAT_ENABLED`), GIFs (`GIPHY_API_KEY` set) and NHL scores (`NHL_ENABLED`) are on. The browser console logs at debug level in development and info in production builds. Chromecast must reach the media server itself; the receiver's API URL is built from the page's origin, and local casting may require a backend bound to a receiver-reachable interface. Browser proxy tests do not establish physical receiver reachability.

`.env.example` lists what a deploy sets. The Advanced block at the end of `backend/app/config.py` (media admission limits, HLS and highlight timings, temporary directories, feedback rate limits, body caps) has tuned defaults and stays out of it; each can still be overridden by its upper-case name. Startup warns about variables that are no longer read (`OBSOLETE_ENV_KEYS` in the same file), such as `STREAM_BASE_URL`, which `DISPATCHARR_URL` replaced.

Administrators control the shared live broadcast and settings; viewer channel selection is configurable. Casting is always on and highlights are optional; both have bounded subprocess/export budgets (the Advanced settings). Recording buffers and temporary exports use the configured temporary storage roots; retain enough disk space for enabled channels and upload/export limits. Captures are held server-side for up to 15 minutes (one per user) and streamed to the editor by byte range; exported trims and formats are cut from that held capture, never from the live buffer.

## Settings saved from the app

The setup wizard and **Admin Panel › Server** save to `settings.json`, beside the state file (`STATE_FILE`, `/data/state.json` in the image, so `/data/settings.json`).

**Precedence.** An environment variable wins over `settings.json`, which wins over the defaults in `backend/app/config.py`. A variable locks its whole group, shown as locked in the wizard and the Server tab: Dispatcharr (address and API key), ErsatzTV, sign-in (every local and Plex auth setting), chat, GIFs, clips, Zipline, NHL scores, feedback, and each Advanced setting on its own. A locked group's saved values are kept in the file but not used. Any auth variable in the environment (as the production deploy sets) closes setup, whatever the file says. The log format, temporary folders, API docs and CORS are set only in the environment.

**What the file holds.** Setup progress (who claimed the club and when), the token signing key generated at first start (unless `JWT_SECRET` is set), the linked Plex server's name, and every saved setting. That includes the Plex server token, the Dispatcharr API key, the GIPHY, Zipline and ntfy tokens, and local password hashes. Tokens and keys are stored in plaintext in a file only the app's user can read (mode 0600), and never sent to browsers. Back up `/data` with the same care as the secrets in it, and keep the volume when you update the container. A corrupt file, or one from a newer version, stops startup rather than reopening setup.

**When setup opens again.** Once finished, setup stays closed unless:

- **`settings.json` is deleted.** With the server stopped, delete it to start over: setup reopens to the first visitor, every saved setting is gone, and everyone is signed out because a new signing key is generated. This is the way back in if no admin can sign in. Setting the auth variables in the environment is the other.
- **Every auth variable is removed** from a club whose sign-in always came from the environment. It never ran the wizard, so setup reopens to the first visitor. Keep the variables, or plan to set the club up straight after the restart.

**One worker only.** Saved settings, the shared Live channel, chat and presence live in the server process. Run a single uvicorn worker, as the image does, and one container per data volume.

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

Run `docker compose up --build`, then set up the club at `/setup` as in [Quick start](#quick-start). Compose reads root `.env`: leave a setting out to set it in the app, or set it there to manage it from the environment, which locks it in the app (see [Settings saved from the app](#settings-saved-from-the-app)). If you set any auth variable there, setup never opens, so set all of sign-in there too. The container is named `channel-club`; the internal Compose service remains `iptv-viewer` for deployment compatibility. Production serves the frontend and API from one origin. See `.env.example` for feature switches; media resource limits are Advanced settings in `backend/app/config.py`.

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

The backend emits structured events at INFO so viewing history can be charted from the log store without a database. Each event is a loguru record with bound fields. Session events are per connection; watch and programme events are per person (`user_id`, else the username), taken from the connection the presence list shows for them, so two tabs or a TV plus a phone on one channel count once.

| event | when |
|---|---|
| `session.start` / `session.stop` | a WebSocket connection opens / closes (`user`, `user_id`, `session`; stop adds `duration_s` and a reason: `disconnect`, `stale`, or `server_restart` for the 1012 close a deploy sends). No `view`: every client connects as the unified TV view. |
| `watch.start` / `watch.stop` | the person's channel changes, or they stop watching (`user`, `user_id`, `session`, `view`, `channel`, `channel_id`, `channel_known`, `on_live`, `programme`, `reason`). Start reasons: `start` (first watch, or after a clear or reconnect), `switch`, `live_follow` (moving with the shared Live slot). Stop reasons: `switch`, `live_follow`, `cleared`, `disconnect`, `stale`, `server_restart`. Stop carries the whole `duration_s` and `delta_s`, the time since the last `watch.progress`. |
| `watch.progress` | every 5 minutes of an open watch, with `delta_s`, so watch time accrues in the interval it happened. Watch time is the sum of `delta_s` over `watch.progress` and `watch.stop` (plus `duration_s` of older `watch.stop` lines that have no `delta_s`). |
| `programme.change` / `programme.stop` | the programme title changes on the same channel; stop closes a titled segment (a new title or the watch ending) with its `duration_s` |
| `channel.change` | the shared live channel is changed (`user`, `channel`, `channel_id`), or stopped (`channel` and `channel_id` null) |
| `server.start` | the app starts (`version`, `build_id`), which the dashboard marks as a deploy |

Channel names are the catalogue's: the server looks the reported `channelId` up in its cached Dispatcharr and ErsatzTV catalogues (never fetching on this path). `channel_known` is true when found, false when the loaded catalogues don't hold the id, and null when a catalogue that could hold it hasn't loaded yet; `claimed_channel` carries the client's name only when it differs from the catalogue's. The dashboard joins events to the catalogue by `channel_id` (the Dispatcharr stream UUID for Live, the tvg-id for ErsatzTV).

"Hide what I'm watching" and the admin "Who's watching what" setting change what other people see, not what is logged: viewing is still recorded for the host's stats, and the app says so next to both.

Run with `LOG_FORMAT=json` so the fields are machine-readable; in Loki they parse as `{container="channel-club"} | json | record_extra_event="watch.stop"`. The Grafana dashboard that consumes these events is generated by `ops/grafana/generate-channel-club-dashboard.py` into `ops/grafana/dashboards/channel-club.json`; `backend/tests/test_analytics_contract.py` checks the events carry every field its queries read.

## Application version and releases

The Admin Panel header shows the frontend version. **Status → Channel Club** shows
frontend/backend versions, the exact build ID and source revision, independently
of upstream service health. `/api/health` exposes the same backend information.

`backend/pyproject.toml` is the authoritative application version. From the repository
root, update all application manifest/lockfile entries together:

```bash
python3 scripts/version.py --set 1.2.1
python3 scripts/version.py
```

The helper preserves dependency versions. Update the version shown in this README
when preparing a release. CI rejects mismatched application metadata.

Every successful `master` push builds and deploys a unique image such as
`gitea.example.com/jons-org/channel-club:1.2.0-build-abc1234-<build-id>`. Production
Compose uses the resulting immutable image digest, not a moving version tag.

To publish version **1.2.0**, push an annotated Git tag at the tested commit whose
application manifests say `1.2.0`:

```bash
git tag -a v1.2.0 -m "Channel Club 1.2.0"
git push origin v1.2.0
```

The tag workflow tests, builds, scans and publishes
`gitea.example.com/jons-org/channel-club:1.2.0`. It does not trigger another production
deployment. Later master builds never move this release tag. A retry reuses an
existing image with matching version/source labels; conflicting tags or registry
errors fail publication. No `latest` alias is published.

On the next normal deployment, Compose recreates the existing service with the
new `channel-club` container name and image repository. Port `8334`, the host stack
directory, Infisical secret path and Plex client identifier are unchanged. Update
any external monitoring that refers directly to the old container name. Historical
images remain available for digest-based rollback. See [release execution](scripts/README.md)
for verification and rollback details.
