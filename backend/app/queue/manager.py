"""Single-job queue + asyncio.Lock around GPU stages (L3 invariant).

JobManager is the symbol attached to ``app.state.jobs`` by the lifespan. It owns:
  * an unbounded ``asyncio.Queue`` (admission control / size caps are Phase 5)
  * a single ``asyncio.Lock`` (``gpu_lock``) wrapping each job's GPU-touching
    pipeline so only ONE job ever runs whisper.cpp + pyannote at a time on the
    8 GB Vulkan-on-AMD host
  * a dict of in-flight ``Job`` records keyed by ``job_id`` so ``/jobs/{id}/cancel``
    can flip the per-job ``cancel_event``
  * the OPTS-07-gated preset list, computed once from the live VRAM probe at
    construction (the lifespan calls this AFTER probe_vulkan_or_die has run)

The worker loop runs as a single ``asyncio.Task`` started from the lifespan
(``app.state.worker_task``); CancelledError is the sole clean exit path.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.pipeline.presets import available_presets
from app.platform.memory import find_amd_card_dir, vram_total_mb
from app.queue.progress import insert_job_row, update_job
from app.queue.worker import _run_job

log = logging.getLogger(__name__)


@dataclass
class Job:
    """In-flight job record. Lives in ``JobManager.jobs`` until the worker
    finishes its outer ``finally`` and pops it; the ``cancel_event`` is the
    cooperative-cancel handle (D4 — never SIGKILL'd mid-inference).

    Phase 4: ``user_id`` and ``is_anonymous`` come from the verified JWT claims
    (Plan 04-04) and are used by the worker to gate the CORE-08 transcripts
    INSERT — anonymous completions NEVER write to public.transcripts.
    """

    id: str
    work_path: Path  # original upload (e.g., work_dir/<uuid>.mp3)
    meta: dict[str, Any]  # filename, ext, content_type, options{preset, language, ...}
    preset: dict[str, Any]  # resolved preset row (model_path + estimated_vram_mb)
    user_id: str | None = None  # Phase 4: from JWT claims["sub"]
    is_anonymous: bool = False  # Phase 4: from JWT claims["is_anonymous"]
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    submitted_at: float = field(default_factory=time.time)


class JobManager:
    """Owns the asyncio.Queue + asyncio.Lock + in-flight jobs dict (L3)."""

    def __init__(self, app_state: Any) -> None:
        self.state = app_state
        self.queue: asyncio.Queue[Job] = asyncio.Queue()
        self.gpu_lock = asyncio.Lock()
        self.jobs: dict[str, Job] = {}

        # OPTS-07: compute presets once from the live VRAM budget + settings flag.
        # The probe is best-effort — a hostile sysfs layout falls back to the
        # documented baseline (8 GB on the RX 6600) so the worker stays usable.
        try:
            total_mb = vram_total_mb(find_amd_card_dir())
        except Exception as e:
            # Sysfs probe failure is intentionally wide — any unexpected layout
            # falls back to the documented baseline so the worker stays usable.
            log.warning("VRAM probe failed; defaulting to 8192 MB: %s", e)
            total_mb = 8192
        self._presets: dict[str, dict[str, Any]] = available_presets(app_state.settings, total_mb)
        log.info("presets_available: %s", sorted(self._presets.keys()))

    # ── Read-only accessors used by routes (jobs.py, health.py) ──────────────
    def presets_available(self) -> list[str]:
        """Return preset names eligible on this host (OPTS-07 gate result)."""
        return sorted(self._presets.keys())

    def get_preset(self, name: str) -> dict[str, Any] | None:
        """Resolve a preset by name; ``None`` if not gated-in on this host."""
        return self._presets.get(name)

    # ── Mutating API used by routes ──────────────────────────────────────────
    async def submit_from_upload(
        self,
        job_id: str,
        work_path: Path,
        meta: dict[str, Any],
    ) -> str:
        """Construct a Job, register it, enqueue it, and seed the queued row.

        Returns the ``job_id`` (echoed for caller convenience). The route is
        responsible for pre-validating the preset name; if a caller bypasses
        that (e.g., a test or a future internal path) we fall back to the
        first available preset so the worker has something to dispatch on.
        """
        preset_name = (meta.get("options") or {}).get("preset", "average")
        preset = self.get_preset(preset_name)
        if preset is None:
            fallback = next(
                iter(self._presets.values()),
                {"model_path": "", "estimated_vram_mb": 0, "model_filename": ""},
            )
            preset = fallback
            log.warning(
                "preset %r unavailable for job %s; using fallback %r",
                preset_name,
                job_id,
                preset.get("model_filename", "<unknown>"),
            )

        # Phase 4: thread the verified JWT identity from meta onto the Job so
        # the worker's `update_job(user_id=…, is_anonymous=…)` carries the
        # right values into progress.update_job's CORE-08/AUTH-09 gate. Without
        # this, getattr(job, "user_id", None) returns None and the transcripts
        # INSERT never fires for signed-in completions (transcript_id stays
        # null on the jobs row). Quick task 260430-lr0.
        job = Job(
            id=job_id,
            work_path=work_path,
            meta=meta,
            preset=preset,
            user_id=meta.get("user_id"),
            is_anonymous=bool(meta.get("is_anonymous", False)),
        )
        self.jobs[job_id] = job

        # Seed the row in public.jobs BEFORE queueing the job. Without this,
        # every subsequent update_job(...) is an UPDATE on a row that does
        # not exist (supabase-py treats that as 0 rows affected, raises
        # nothing) — the worker runs end-to-end and the transcript is
        # silently discarded. Phase 2↔4 boundary bug fixed in quick task
        # 260430-kxc; insert_job_row is tolerant of 23505 unique_violation
        # so legitimate replays don't crash the queue.
        await insert_job_row(
            self.state.settings,
            job_id,
            source_filename=meta.get("filename") or "upload",
            user_id=meta.get("user_id"),
            options=meta.get("options") or {},
            anon_token=meta.get("anon_token"),
        )

        await self.queue.put(job)
        await update_job(
            self.state.settings,
            job_id,
            status="queued",
            stage="queued",
            progress=0,
        )
        return job_id

    async def cancel(self, job_id: str) -> bool:
        """Flag a job for cooperative cancellation.

        Sets the per-job ``cancel_event``; the worker picks it up at the next
        stage boundary (D4). Returns ``True`` if the job is still in-flight,
        ``False`` if no such job is registered (already completed, never
        existed, or already swept after a previous cancel).
        """
        job = self.jobs.get(job_id)
        if job is None:
            return False
        job.cancel_event.set()
        return True

    # ── Worker entry point (started as asyncio.Task from main.py lifespan) ───
    async def worker_loop(self) -> None:
        """Infinite job pump.

        ``CancelledError`` is the only clean exit path (lifespan shutdown).
        Any other exception raised by ``_run_job`` is logged + reflected onto
        the jobs row as ``status=failed`` and the worker keeps going so a
        single bad job cannot deadlock the entire backend.
        """
        log.info("worker_loop started")
        try:
            while True:
                job = await self.queue.get()
                try:
                    async with self.gpu_lock:
                        await _run_job(self.state, job)
                except asyncio.CancelledError:
                    # Lifespan shutdown. Do NOT mark the in-flight job as
                    # failed — it stays in 'running' so an operator restart
                    # can decide whether to reconcile or drop it.
                    log.info("worker_loop cancelled mid-job (lifespan shutdown)")
                    raise
                except Exception as e:
                    # Catch-all is intentional: a single bad job MUST NOT
                    # take down the worker (T-02-07-WorkerDeath mitigation).
                    log.exception("job %s crashed in worker_loop", job.id)
                    try:
                        await update_job(
                            self.state.settings,
                            job.id,
                            status="failed",
                            error=str(e)[:500],
                        )
                    except Exception:
                        log.exception("update_job(failed) also crashed for job %s", job.id)
                finally:
                    # Drop the in-memory handle so cancel() returns False
                    # for completed jobs and we don't leak Event objects.
                    self.jobs.pop(job.id, None)
        except asyncio.CancelledError:
            log.info("worker_loop exiting on cancel")
            raise


# Re-exports — routes import these directly when they need to construct a Job
# (e.g., test fakes). uuid is exposed for symmetry with submit_from_upload's
# job_id contract; callers SHOULD prefer ``str(uuid.uuid4())``.
__all__ = ["Job", "JobManager", "uuid"]
