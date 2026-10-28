# Channel Club backend

FastAPI backend. For the full app in development, run `./run.sh` from the repository root: it starts this backend on port 8001 and the Vite frontend on 5173, which proxies `/api` to it.

```bash
uv sync --frozen
```

Configuration lives in the root `.env` (copied from the root `.env.example`). Replace the example JWT signing key with `openssl rand -hex 32`, enable the desired login method, and configure unique local passwords or Plex server credentials. Empty passwords disable the corresponding local account. Configure Dispatcharr for live channels and ErsatzTV only when using that catalogue.

```bash
uv run --env-file ../.env uvicorn app.main:app --reload --port 8001
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run basedpyright
```

Casting (always on) and highlights (when enabled) require FFmpeg. Temporary recording/export roots, concurrent sessions, encoding limits and idle lifetimes are controlled by backend settings. Keep temporary roots dedicated to this application. Unit tests use synthetic configuration and reject unexpected external network access.

Application versioning and Docker releases are documented in the [release guide](../scripts/README.md).
