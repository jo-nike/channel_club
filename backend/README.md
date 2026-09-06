# Channel Club backend

FastAPI backend. See the [root setup guide](../README.md) for the complete browser/proxy workflow.

```bash
uv sync --frozen
cp .env.example .env
```

Replace the example JWT signing key with `openssl rand -hex 32`, enable the desired login method, and configure unique local passwords or Plex server credentials. Empty passwords disable the corresponding local account. Configure Dispatcharr for live channels and ErsatzTV only when using that catalogue. `backend/.env` is read from the backend working directory; root `.env` is for Docker Compose.

```bash
uv run uvicorn app.main:app --reload --port 8001
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run basedpyright
```

Highlights and Cast require FFmpeg when enabled. Temporary recording/export roots, concurrent sessions, encoding limits and idle lifetimes are controlled by backend settings. Keep temporary roots dedicated to this application. Unit tests use synthetic configuration and reject unexpected external network access.

Application versioning and Docker releases are documented in the [root release guide](../README.md#application-version-and-releases).
