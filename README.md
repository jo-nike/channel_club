# IPTV Viewer

## Development

**Backend:**
```bash
cd backend && uv run uvicorn app.main:app --reload  --port 8001
```

**Frontend:**
```bash
cd frontend && npm run dev
```

**Docker:**
```bash
docker-compose up
```

## Environment Files

| File | Used By | Purpose |
|------|---------|---------|
| `backend/.env` | Local dev | Backend settings when running `uv run uvicorn` |
| `.env` (root) | Docker Compose | Combined frontend + backend settings for production |

Copy from `.env.example` files to get started. For local dev, only `backend/.env` is needed.
