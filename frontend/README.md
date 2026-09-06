# Channel Club frontend

React/TypeScript frontend built with Vite. See the [root setup guide](../README.md) for credentials and complete local startup.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173` or the development machine's LAN address. `/api` HTTP and WebSocket requests pass through Vite to backend port 8001; no frontend `.env` is needed. Optional `VITE_API_URL` is an explicit deployment override, not a prerequisite. `.env.example` documents optional frontend feature flags and Chromecast receiver origin.

```bash
npm test
npm run lint
npm run build
node scripts/check-dev-proxy.mjs
node scripts/check-service-worker.mjs
```

Browser checks use Chrome and synthetic fixtures; the dev proxy check requires port 8001 free. Receiver/device/media playback checks require a separate controlled integration environment.

Application versioning and Docker releases are documented in the [root release guide](../README.md#application-version-and-releases).
