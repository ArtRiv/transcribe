"""FastAPI entry point.

Phase 1: lifespan is a no-op; only /healthz is exposed.
Phase 2 will:
  - Probe Vulkan in the lifespan startup (vulkaninfo + whisper.cpp --list-devices)
  - Load whisper.cpp model + pyannote pipeline once into memory
  - Start the asyncio.Queue worker task
  - Add /readyz that signals readiness vs liveness
  - Add /jobs and TUS endpoints

Run dev:
    uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

Run prod (Phase 2 will document the systemd unit):
    uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """App lifespan: Phase 1 no-op; Phase 2 adds model loading + worker startup."""
    # Startup
    settings = get_settings()
    # Phase 2: probe Vulkan, load whisper.cpp model, load pyannote pipeline,
    #          start asyncio.Queue worker task; store handles on app.state.
    app.state.settings = settings
    yield
    # Shutdown
    # Phase 2: cancel worker task, release model handles.


app = FastAPI(
    title="Transcribe Backend",
    version="0.1.0",
    description="whisper.cpp + pyannote transcription pipeline (Phase 1: scaffolding only)",
    lifespan=lifespan,
)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness probe. Always returns 200 if the process is up.

    Phase 5 SAFE-04: This endpoint MUST stay liveness-only (no DB/external dep checks).
    Phase 2 will add /readyz for readiness (model loaded, GPU detected, queue running).
    """
    return {"status": "ok"}
