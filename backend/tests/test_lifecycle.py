"""CORE-07 + SEC-08: cleanup_job_files idempotency + no-Storage assertion.

The SEC-08 sentinel test imports app.pipeline.transcribe and app.pipeline.diarize
which ship in Task 2 of plan 02-06. Until those modules exist, the sentinel will
ImportError; once Task 2 lands the test passes.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from types import SimpleNamespace

from app.pipeline.lifecycle import cleanup_job_files, normalized_wav_path, sweep_orphans


async def test_cleanup_missing_files_is_silent(tmp_path: Path) -> None:
    """cleanup_job_files on a job with non-existent files succeeds without error."""
    job = SimpleNamespace(work_path=tmp_path / "absent.mp3")
    await cleanup_job_files(job)  # no exception


async def test_cleanup_deletes_both_paths(tmp_path: Path) -> None:
    """cleanup deletes BOTH the source media AND the normalized intermediate WAV."""
    src = tmp_path / "j.mp3"
    wav = tmp_path / "j.norm.wav"  # matches normalized_wav_path() derivation
    src.write_bytes(b"x")
    wav.write_bytes(b"y")
    job = SimpleNamespace(work_path=src)
    await cleanup_job_files(job)
    assert not src.exists() and not wav.exists()


async def test_cleanup_idempotent_second_call(tmp_path: Path) -> None:
    """A second cleanup call after the files are already gone does not raise."""
    src = tmp_path / "j.mp3"
    src.write_bytes(b"x")
    job = SimpleNamespace(work_path=src)
    await cleanup_job_files(job)
    await cleanup_job_files(job)  # second call, no error


async def test_cleanup_silent_when_only_source_exists(tmp_path: Path) -> None:
    """If only the source media exists (no .norm.wav yet), source is deleted, no error."""
    src = tmp_path / "j.mp3"
    src.write_bytes(b"x")
    job = SimpleNamespace(work_path=src)
    await cleanup_job_files(job)
    assert not src.exists()
    assert not (tmp_path / "j.norm.wav").exists()


def test_normalized_wav_path_never_aliases_input() -> None:
    """Regression: ffmpeg refuses to overwrite its input. The normalized output
    path MUST differ from the source path for every plausible upload extension —
    including .wav itself, which is the case the original `with_suffix('.wav')`
    derivation collapsed onto the input and crashed POST /jobs in the soak UAT.
    """
    for ext in (".wav", ".mp3", ".m4a", ".flac", ".ogg", ".mp4", ".bin", ""):
        src = Path(f"/tmp/job-uuid-{ext.lstrip('.')}{ext}")
        out = normalized_wav_path(src)
        assert out != src, f"normalized path aliases input for ext={ext!r}: {out}"
        assert out.suffix == ".wav", f"normalized output must be .wav, got {out.suffix!r}"
        assert out.parent == src.parent, "normalized output should be a sibling of input"


async def test_sweep_orphans_creates_missing_dir(tmp_path: Path) -> None:
    """sweep_orphans on a non-existent dir creates the dir + does nothing."""
    dir_ = tmp_path / "uploads-fresh"
    await sweep_orphans(dir_, ttl_hours=24)
    assert dir_.exists() and dir_.is_dir()


async def test_sweep_orphans_removes_old_keeps_fresh(tmp_path: Path) -> None:
    """Subdirs with old `data` mtime are removed; fresh ones preserved."""
    # Old upload
    old = tmp_path / "old"
    old.mkdir()
    (old / "data").write_bytes(b"x")
    # Backdate
    ago = time.time() - 48 * 3600
    os.utime(old / "data", (ago, ago))
    os.utime(old, (ago, ago))

    # Fresh upload
    fresh = tmp_path / "fresh"
    fresh.mkdir()
    (fresh / "data").write_bytes(b"y")

    await sweep_orphans(tmp_path, ttl_hours=24)
    assert not old.exists()
    assert fresh.exists()


def test_no_supabase_storage_imports_in_pipeline_modules() -> None:
    """SEC-08 sentinel: pipeline modules MUST never call Supabase Storage."""
    import inspect

    from app.pipeline import diarize, lifecycle, merge, normalize, presets, transcribe

    for mod in (normalize, transcribe, diarize, merge, lifecycle, presets):
        src = inspect.getsource(mod)
        assert "supabase.storage" not in src, f"{mod.__name__} touches supabase.storage"
        assert "storage.from_(" not in src, f"{mod.__name__} calls storage.from_"
