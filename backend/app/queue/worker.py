"""Pipeline runner: extracting → transcribing → diarizing → merging → done.

Six stage transitions, one row per transition, plus intra-Transcribing
progress writes at ≥5 s cadence (D3). All cleanup runs in the outer
``finally``: ``cleanup_job_files`` (CORE-07: deletes the source media + the
intermediate WAV) AND ``gc.collect()`` (OPS-07: releases per-job Python
buffers between jobs).

Cancellation is cooperative (D4 + Pitfall 1):
  * ``cancel.is_set()`` is checked at every stage boundary.
  * ``transcribe_subprocess`` itself reads ``cancel_event`` but NEVER sends
    SIGKILL mid-inference — that is the documented cause of Vulkan VRAM
    leaks on this stack and the soak test (TEST-04) is the falsifiable
    acceptance criterion. (Acceptance probe: this file contains zero
    occurrences of the kill-the-subprocess attribute access.)
  * On cancel, the worker writes ``status='cancelled'``, runs cleanup in the
    outer finally, and yields the GPU lock for the next job.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import subprocess
from pathlib import Path
from typing import Any

from app.pipeline.diarize import diarize as pyannote_diarize
from app.pipeline.lifecycle import cleanup_job_files, normalized_wav_path
from app.pipeline.merge import merge_to_payload
from app.pipeline.normalize import normalize_to_wav
from app.pipeline.transcribe import transcribe_subprocess
from app.queue.progress import update_job

log = logging.getLogger(__name__)


async def _ffprobe_duration(wav_path: Path) -> float:
    """Read the WAV's duration via ffprobe (used to convert seconds-processed
    from whisper-cli into a 0..100 progress percent for the jobs row).

    Returns 0.0 on any failure; the caller clamps with ``max(..., 1.0)`` so a
    division-by-zero is impossible regardless of ffprobe's mood.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(wav_path),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        # ffprobe not installed (e.g., mock-engine on a host without ffmpeg
        # tools). The intra-stage progress falls back to 0.0 → pct stays at 10.
        return 0.0
    out, _ = await proc.communicate()
    try:
        return float(out.decode().strip() or 0.0)
    except ValueError:
        return 0.0


async def _run_job(state: Any, job: Any) -> None:
    """Run one job through the full pipeline.

    Cooperative cancel between stages; cleanup unconditional in finally.
    Six expected ``update_job`` writes on the success path:
      1. status=running, stage=extracting, progress=5
      2. stage=transcribing, progress=10
      3. (one or more) progress=N during transcribing (D3 cadence — variable)
      4. stage=diarizing, progress=80
      5. stage=merging, progress=95
      6. status=succeeded, stage=done, progress=100, transcript_payload=<...>

    On cancel: ``_mark_cancelled`` writes ``status=cancelled`` once. On
    exception: the JobManager.worker_loop catches and writes ``status=failed``
    after this function's ``finally`` has already run cleanup + gc.
    """
    cancel: asyncio.Event = job.cancel_event
    settings = state.settings
    # Pitfall: must be DISTINCT from job.work_path even when the upload is
    # already a .wav — otherwise ffmpeg refuses to overwrite its input.
    # `normalized_wav_path` is the single source of truth (also used by
    # cleanup_job_files in the outer finally).
    wav: Path = normalized_wav_path(job.work_path)

    try:
        # ── STAGE: extracting ────────────────────────────────────────────────
        await update_job(
            settings, job.id, status="running", stage="extracting", progress=5
        )
        await normalize_to_wav(job.work_path, wav)
        if cancel.is_set():
            await _mark_cancelled(settings, job)
            return

        # ── STAGE: transcribing (D3 — intra-stage progress every ≥5 s) ───────
        await update_job(settings, job.id, stage="transcribing", progress=10)
        duration_s = max(await _ffprobe_duration(wav), 1.0)

        async def on_progress(seconds_processed: float) -> None:
            # Map 0..duration_s onto 10..80 so the bar reflects real Transcribe
            # progress while leaving room for the diar/merge stages above.
            pct = 10 + int(70 * min(seconds_processed / duration_s, 1.0))
            await update_job(settings, job.id, progress=pct)

        asr = await transcribe_subprocess(
            state.whisper_bin,
            job.preset["model_path"],
            wav,
            language=(job.meta.get("options") or {}).get("language"),
            on_progress=on_progress,
            cancel_event=cancel,
            vad_model_path=getattr(state, "whisper_vad_model_path", ""),
        )
        if cancel.is_set():
            await _mark_cancelled(settings, job)
            return

        # ── STAGE: diarizing (pyannote-CPU; one black-box call per L2) ───────
        await update_job(settings, job.id, stage="diarizing", progress=80)
        num_speakers = (job.meta.get("options") or {}).get("num_speakers")
        diarize_on = (job.meta.get("options") or {}).get("diarize", True)
        if diarize_on and state.pyannote_pipeline is not None:
            diar = await pyannote_diarize(
                state.pyannote_pipeline, str(wav), num_speakers=num_speakers
            )
        else:
            # Diarization disabled by user OR pyannote unavailable
            # (mock-engine / pyannote not loaded): merge tags everything as
            # SPEAKER_UNKNOWN → renumbers to a single S0.
            diar = []
        if cancel.is_set():
            await _mark_cancelled(settings, job)
            return

        # ── STAGE: merging (pure Python; cheap; never blocks event loop) ─────
        await update_job(settings, job.id, stage="merging", progress=95)
        payload = merge_to_payload(asr, diar)

        # ── STAGE: done (terminal status + transcripts row insert) ───────────
        # Phase 4 CORE-08: pass user_id + is_anonymous so progress.update_job
        # can gate the transcripts INSERT (anon jobs stay in jobs.transcript_payload).
        await update_job(
            settings,
            job.id,
            status="succeeded",
            stage="done",
            progress=100,
            transcript_payload=payload,
            user_id=getattr(job, "user_id", None),
            is_anonymous=getattr(job, "is_anonymous", False),
        )

    finally:
        # CORE-07 + OPS-07: every exit path cleans disk + collects garbage.
        try:
            await cleanup_job_files(job)
        except Exception:
            log.exception("cleanup_job_files crashed for job %s", job.id)
        gc.collect()


async def _mark_cancelled(settings: Any, job: Any) -> None:
    """Write the cancelled-status row. Cleanup runs in the outer finally."""
    try:
        await update_job(
            settings,
            job.id,
            status="cancelled",
            stage="cancelling",
            error="user cancelled",
        )
    except Exception:
        # Don't escalate — cleanup still needs to run from the outer finally.
        log.exception("update_job(cancelled) failed for job %s", job.id)
