"""FastAPI entry point.

Phase 2 lifespan: Vulkan probe → model paths → pyannote load → ready →
orphan sweep → JobManager + worker_task → yield. Shutdown cancels the
worker task and awaits CancelledError for a clean exit.

Run dev:
    uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

Run prod (Phase 2 will document the systemd unit):
    uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from logging.config import dictConfig
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.platform.memory import find_amd_card_dir, vram_total_mb
from app.platform.vulkan import probe_vulkan_or_die

# ── Logging config (module-load time, before anything imports `log`) ─────────
# uvicorn's `--log-level` only configures uvicorn.error / uvicorn.access. App
# loggers (`app.*`) inherit the root logger which defaults to WARNING, so any
# `log.info(...)` from the lifespan or queue worker silently disappears. Add
# a handler for the `app` namespace whose format mirrors uvicorn's
# "INFO:     <msg>" lines so operator output stays consistent across both
# layers. Override the level via the LOG_LEVEL env var (default INFO).
dictConfig(
    {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "transcribe": {"format": "%(levelname)s:     %(message)s"},
        },
        "handlers": {
            "transcribe": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stderr",
                "formatter": "transcribe",
            },
        },
        "loggers": {
            "app": {
                "level": os.environ.get("LOG_LEVEL", "INFO").upper(),
                "handlers": ["transcribe"],
                "propagate": False,
            },
        },
    }
)

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Phase 2 lifespan: Vulkan probe → model paths → pyannote load → orphan sweep → ready."""
    settings = get_settings()
    app.state.settings = settings

    # ── OPS-05: Vulkan self-check (fail-fast) ────────────────────────────────
    # ``SKIP_VULKAN_PROBE=1`` is a narrow test/CI escape hatch — used by the
    # default conftest fixture when the host has no whisper-cli + GGML model
    # available (so the Phase 1 health tests still pass without GPU setup).
    # MOCK_ENGINE=1 alone does NOT bypass the probe; tests that exercise the
    # real probe (e.g., test_routes_smoke.py) keep SKIP_VULKAN_PROBE unset and
    # provide WHISPER_BIN_PATH + MODELS_DIR via their own monkeypatch fixture.
    if os.environ.get("SKIP_VULKAN_PROBE") == "1":
        app.state.vulkan_device = {
            "name": "mock-vulkan-probe",
            "driver_version": "mock",
            "api_version": "mock",
        }
        log.info("SKIP_VULKAN_PROBE=1 — bypassing Vulkan probe; advertising mock device")
    else:
        app.state.vulkan_device = await probe_vulkan_or_die(settings)
        log.info(
            "vulkan ready: %s (driver %s, api %s)",
            app.state.vulkan_device["name"],
            app.state.vulkan_device["driver_version"],
            app.state.vulkan_device["api_version"],
        )

    # ── OPS-06 (half): cache whisper bin/model paths for the worker ──────────
    # The actual whisper.cpp subprocess invocation lives in 02-06's transcribe.py.
    app.state.whisper_bin = settings.whisper_bin_path
    app.state.whisper_model_path = settings.whisper_model_path
    # Pitfall 5: whisper.cpp 1.8+ requires --vad-model when --vad is enabled.
    # Resolve to the configured path, or fall back to the canonical Silero
    # filename inside MODELS_DIR (downloaded by scripts/download_models.sh).
    app.state.whisper_vad_model_path = (
        settings.whisper_vad_model_path
        or str(Path(settings.models_dir) / "ggml-silero-v5.1.2.bin")
    )

    # ── Best-effort presets_available shim until 02-07 attaches state.jobs ───
    try:
        total_mb = vram_total_mb(find_amd_card_dir())
        candidate = ["fast", "average", "average_turbo"]
        if settings.enable_slow_preset and total_mb >= 7200:
            candidate.append("slow")
        app.state.presets_available = candidate
    except Exception as e:
        log.warning("could not compute presets_available shim: %s", e)
        app.state.presets_available = []

    # ── OPS-06 (other half): load pyannote pipeline once into RAM, pinned to CPU ─
    # Lazy import so this plan can ship before 02-06 lands diarize.py.
    # ``MOCK_ENGINE=1`` is the same test/CI escape hatch as ``SKIP_VULKAN_PROBE``:
    # the conftest mock_engine fixture monkey-patches ``diarize`` after lifespan
    # startup, so the real HF + torch load is unnecessary (and on this stack
    # currently fails because pyannote 3.4 forwards ``use_auth_token`` to
    # huggingface_hub 1.x which removed the kwarg).
    if os.environ.get("MOCK_ENGINE") == "1":
        log.info("MOCK_ENGINE=1 — bypassing pyannote load; advertising None")
        app.state.pyannote_pipeline = None
    else:
        try:
            from app.pipeline.diarize import (
                load_pyannote,  # type: ignore[import-not-found]
            )

            app.state.pyannote_pipeline = await load_pyannote(settings)
            # pyannote.audio 3.x Pipeline is not a torch.nn.Module — its
            # .parameters() returns hyperparameters; the canonical device
            # check is the .device attribute set inside Pipeline.to().
            device_type = getattr(
                getattr(app.state.pyannote_pipeline, "device", None), "type", None
            ) or "unknown"
            log.info("pyannote loaded; pinned to %s", device_type)
        except ImportError:
            log.info("app.pipeline.diarize not yet shipped (Wave 2); skipping pyannote load")
            app.state.pyannote_pipeline = None
        except Exception as e:
            # Pitfall 8: HF license-accept reminder
            log.error(
                "pyannote load failed: %s\n"
                "If 401 Unauthorized, accept the license at "
                "huggingface.co/pyannote/segmentation-3.0 and "
                "huggingface.co/pyannote/speaker-diarization-3.1",
                e,
            )
            raise

    # ── OPS-08: readiness gate flips green ───────────────────────────────────
    app.state.ready = True

    # ── CORE-07 hygiene: orphan sweep (sweep_orphans ships in 02-06; lazy import) ─
    try:
        from app.pipeline.lifecycle import sweep_orphans  # type: ignore[import-not-found]

        await sweep_orphans(settings.uploads_dir, ttl_hours=24)
    except ImportError:
        log.info("app.pipeline.lifecycle not yet shipped (Wave 2); skipping orphan sweep")

    # ── L3 (02-07): single-job queue + worker task ───────────────────────────
    # JobManager construction probes VRAM via memory.py + computes the OPTS-07
    # preset gate; the worker task is the long-lived background coroutine that
    # pumps the queue. Both attach to ``app.state`` so routes (jobs.py, tus.py,
    # health.py) can read them via ``request.app.state.jobs``.
    from app.queue.manager import JobManager

    app.state.jobs = JobManager(app.state)
    app.state.worker_task = asyncio.create_task(app.state.jobs.worker_loop())
    log.info(
        "queue worker_task started; presets_available=%s",
        app.state.jobs.presets_available(),
    )

    # ── Phase 4 D-05: anon-job 24h TTL cleanup background task ──────────────
    # Mirrors the worker_task pattern; cancelled on shutdown so the event loop
    # exits cleanly without dangling tasks.
    from app.queue.cleanup import cleanup_anon_jobs_loop

    app.state.cleanup_task = asyncio.create_task(cleanup_anon_jobs_loop(settings))
    log.info("cleanup_anon_jobs_loop started")

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    # Cancel the worker task and await its clean CancelledError exit so the
    # asyncio.Lock + queue are released before the process terminates.
    if hasattr(app.state, "worker_task"):
        app.state.worker_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await app.state.worker_task

    if hasattr(app.state, "cleanup_task"):
        app.state.cleanup_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await app.state.cleanup_task


app = FastAPI(
    title="Transcribe Backend",
    version="0.2.0",  # bumped for Phase 2
    description="whisper.cpp + pyannote transcription pipeline (Phase 2: pipeline + queue + TUS)",
    lifespan=lifespan,
)


# ── CORS — TUS browser uploads through Cloudflare Quick Tunnel ──────────────
# The tus-js-client harness loads from file:// (Origin=null) and the Vercel
# frontend loads from a *.vercel.app domain; the tunnel hostname churns on
# every cloudflared restart. allow_origins=["*"] covers all three without
# pinning a value that would silently break on tunnel restart. Safe here
# because we use no cookie auth (allow_credentials=False); future Phase 4
# Supabase JWT flows over the Authorization header, which CORS allows under
# this config. allow_headers and expose_headers list the TUS-specific
# headers the browser preflight asks for and the tus-js-client reads back.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "HEAD", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",  # Phase 4 forward-compat (Supabase JWT)
        "X-Previous-Anon-Token",  # Phase 4 D-08: promote ownership-chain check (T-04-05)
        "Tus-Resumable",
        "Upload-Length",
        "Upload-Offset",
        "Upload-Metadata",
        "Upload-Defer-Length",
        "Upload-Concat",
    ],
    expose_headers=[
        "Tus-Resumable",
        "Tus-Version",
        "Tus-Extension",
        "Tus-Max-Size",
        "Upload-Offset",
        "Upload-Length",
        "Location",
    ],
    max_age=600,  # cache preflight responses for 10 minutes
)


# ── Routers (mounted after `app` is created so include_router can resolve) ───
from app.routes import health as health_router  # noqa: E402
from app.routes import jobs as jobs_router  # noqa: E402
from app.routes import tus as tus_router  # noqa: E402
from app.routes import transcripts as transcripts_router  # noqa: E402

app.include_router(health_router.router)
app.include_router(jobs_router.router)
app.include_router(tus_router.router)
app.include_router(transcripts_router.router)
