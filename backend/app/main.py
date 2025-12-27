from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers.auth import router as auth_router
from app.routers.channels import router as channels_router

app = FastAPI(title="IPTV Viewer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth_router, prefix="/api/auth")
app.include_router(channels_router, prefix="/api")


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
