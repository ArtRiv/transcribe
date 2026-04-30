"""Disk lifecycle (CORE-07, SEC-08): every byte we wrote leaves disk.

Idempotent + log-but-don't-raise. Pipeline modules NEVER write to Supabase
Storage — see SEC-08 sentinel test in tests/test_lifecycle.py.
"""

from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


def normalized_wav_path(work_path: Path) -> Path:
    """Path of the normalized 16 kHz mono PCM WAV derived from `work_path`.

    Single source of truth shared by `worker._run_job` (where ffmpeg writes
    it) and `cleanup_job_files` (where the worker's outer finally deletes
    it). The path is ALWAYS distinct from `work_path`, even when the upload
    is itself a .wav — `with_name(f"{stem}.norm.wav")` produces a sibling
    file whose name differs from any plausible upload extension.

    The `.norm.wav` suffix is load-bearing: passing the same path to
    ffmpeg as both -i input and output triggers
    "Output X same as Input #0 - exiting / FFmpeg cannot edit existing
    files in-place", which previously crashed normalize_to_wav for every
    .wav upload through POST /jobs.
    """
    return work_path.with_name(f"{work_path.stem}.norm.wav")


async def cleanup_job_files(job: Any) -> None:
    """Idempotent cleanup. Safe to call multiple times. Never raises.

    Deletes both the original upload (`job.work_path`) and the intermediate
    16 kHz WAV (`normalized_wav_path(job.work_path)`). Missing files are
    silently skipped via `unlink(missing_ok=True)`; OS errors are logged +
    swallowed so the worker's `finally` cleanup never escalates a
    partial-failure into a crash.
    """
    for p in (job.work_path, normalized_wav_path(job.work_path)):
        try:
            p.unlink(missing_ok=True)
        except OSError as e:
            log.warning("cleanup failed for %s: %s", p, e)


async def sweep_orphans(uploads_dir: Path, ttl_hours: int = 24) -> None:
    """Lifespan-startup sweep: remove TUS uploads not touched in `ttl_hours`.

    Safe on first boot when `uploads_dir` doesn't exist (creates it; sweeps
    nothing). Each upload subdir is keyed by its `data` chunk-file mtime
    when present, otherwise the directory's own mtime.
    """
    uploads_dir = Path(uploads_dir)
    try:
        uploads_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        log.warning("sweep_orphans: cannot create %s: %s", uploads_dir, e)
        return
    cutoff = time.time() - (ttl_hours * 3600)
    for upload_dir in uploads_dir.glob("*"):
        if not upload_dir.is_dir():
            continue
        try:
            data = upload_dir / "data"
            mtime = data.stat().st_mtime if data.exists() else upload_dir.stat().st_mtime
            if mtime < cutoff:
                shutil.rmtree(upload_dir, ignore_errors=True)
                log.info("swept orphaned upload: %s", upload_dir.name)
        except OSError as e:
            log.warning("sweep failed for %s: %s", upload_dir, e)
