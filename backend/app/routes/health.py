"""Liveness + readiness endpoints (OPS-08).

GET /healthz: liveness only — process is up. Phase 5 SAFE-04 mandates this
              endpoint stays free of DB / external-dependency checks.
GET /readyz:  readiness — Vulkan probe completed, pyannote loaded, queue
              running. Returns ``status: starting`` while the lifespan is
              still warming up; ``status: ready`` once ``app.state.ready``
              flips to True.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.schemas import ReadyzResponse

router = APIRouter()


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Phase 1 contract preserved verbatim — never block on external deps."""
    return {"status": "ok"}


@router.get("/readyz", response_model=ReadyzResponse)
async def readyz(request: Request) -> ReadyzResponse:
    state = request.app.state
    ready = bool(getattr(state, "ready", False))

    vulkan_device: str | None = None
    raw_dev = getattr(state, "vulkan_device", None)
    if raw_dev is not None:
        vulkan_device = raw_dev.get("name") if isinstance(raw_dev, dict) else str(raw_dev)

    presets_available: list = []
    jobs_mgr = getattr(state, "jobs", None)
    if jobs_mgr is not None and hasattr(jobs_mgr, "presets_available"):
        try:
            presets_available = list(jobs_mgr.presets_available())
        except Exception:
            presets_available = []
    elif hasattr(state, "presets_available"):
        # Wave 2 shim: lifespan computes a best-effort list before 02-07's
        # JobManager attaches its own presets_available() callable.
        presets_available = list(state.presets_available)

    return ReadyzResponse(
        status="ready" if ready else "starting",
        vulkan_device=vulkan_device,
        presets_available=presets_available,
    )
