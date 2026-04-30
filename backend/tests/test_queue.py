"""JobManager + worker behavior — gpu_lock serialization, exception isolation, cancel.

These tests use a deterministic event recorder (``update_recorder`` fixture)
that monkey-patches ``app.queue.progress.update_job`` AND the symbols
imported into ``app.queue.worker`` / ``app.queue.manager``. Tests assert on
the *order* of recorded events (gpu_lock invariant: at any moment at most
one job is in ``status='running'``), not on wall-clock timestamps — that
keeps the tests deterministic on slow CI runners.

OPS-06 ("pyannote loads exactly once across N jobs") is intentionally
isolated to ``test_models_loaded_once.py`` — that test must monkey-patch
``app.pipeline.diarize.load_pyannote`` BEFORE ``app.main`` is imported, and
this file's lifespan_app/client fixtures from conftest already trigger the
import on first use, so the patch would race the import here.
"""

from __future__ import annotations

import asyncio
import io
import os

import pytest
from fastapi import FastAPI
from httpx import AsyncClient

from app.queue import progress as progress_mod


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch, tmp_path):
    monkeypatch.setenv("MOCK_ENGINE", "1")
    monkeypatch.setenv(
        "WHISPER_BIN_PATH",
        os.path.expanduser("~/.transcribe/build/whisper.cpp/build/bin/whisper-cli"),
    )
    monkeypatch.setenv("MODELS_DIR", os.path.expanduser("~/.transcribe/models"))
    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("WORK_DIR", str(tmp_path / "work"))
    monkeypatch.setenv("ENABLE_SLOW_PRESET", "false")
    from app.config import get_settings

    get_settings.cache_clear()
    progress_mod.reset_client_for_tests()

    # Conftest's ``mock_engine`` autouse only patches transcribe + diarize.
    # ``normalize_to_wav`` still shells out to real ffmpeg, which on the tiny
    # garbage payloads we use for queue tests can race itself across
    # concurrent jobs and exit non-zero (T-02-08-RaceFlake mitigation). Mock
    # it deterministically so these tests assert on queue + worker behaviour,
    # not on ffmpeg's mood.
    async def fake_normalize(_src, dst):
        # Touch the WAV so cleanup_job_files has something to remove.
        dst.write_bytes(b"")

    monkeypatch.setattr("app.pipeline.normalize.normalize_to_wav", fake_normalize)
    monkeypatch.setattr("app.queue.worker.normalize_to_wav", fake_normalize)
    yield
    get_settings.cache_clear()


@pytest.fixture
def update_recorder(monkeypatch):
    """Records every update_job call in order.

    Returns the shared list of (job_id, fields) tuples. We patch the symbol
    at THREE bind sites because Python's ``from app.queue.progress import
    update_job`` copies the reference into the importing module's namespace
    — patching only ``app.queue.progress.update_job`` would miss the worker
    + manager module-level rebinds.
    """
    calls: list[tuple[str, dict]] = []

    async def fake_update(_settings, job_id, **fields):
        calls.append((job_id, dict(fields)))

    monkeypatch.setattr("app.queue.progress.update_job", fake_update)
    monkeypatch.setattr("app.queue.worker.update_job", fake_update)
    monkeypatch.setattr("app.queue.manager.update_job", fake_update)
    return calls


async def _submit(client: AsyncClient, preset: str = "fast") -> str:
    files = {"file": ("a.wav", io.BytesIO(b"\x00" * 80), "audio/wav")}
    # Phase 4: POST /jobs requires JWT; MOCK_ENGINE bypasses JWKS in conftest fixture.
    r = await client.post(
        "/jobs",
        files=files,
        data={"preset": preset, "diarize": "true"},
        headers={"Authorization": "Bearer test"},
    )
    assert r.status_code == 202, r.text
    return r.json()["job_id"]


async def _drain(jm, timeout: float = 5.0) -> None:
    async def _wait():
        while jm.queue.qsize() > 0 or len(jm.jobs) > 0:
            await asyncio.sleep(0.02)

    await asyncio.wait_for(_wait(), timeout=timeout)


async def test_gpu_lock_serializes_concurrent_jobs(
    client: AsyncClient, lifespan_app: FastAPI, update_recorder
) -> None:
    """Submit 3 jobs simultaneously; assert no two ``status='running'`` events
    overlap (gpu_lock invariant). The recorder is the single source of truth
    — we walk the events in order and verify each ``running`` is followed
    by the *same* job's terminal event before the next ``running`` appears.
    """
    job_ids = await asyncio.gather(_submit(client), _submit(client), _submit(client))
    assert len(set(job_ids)) == 3, job_ids
    await _drain(lifespan_app.state.jobs)

    running_starts = [(jid, f) for jid, f in update_recorder if f.get("status") == "running"]
    succeeded = [(jid, f) for jid, f in update_recorder if f.get("status") == "succeeded"]
    assert len(running_starts) == 3, running_starts
    assert len(succeeded) == 3, succeeded

    # Walk update_recorder; once we see status="running" for job X, the next
    # status= event for ANY job must be a terminal event for X.
    active: str | None = None
    for jid, fields in update_recorder:
        if fields.get("status") == "running":
            assert active is None, (
                f"job {jid} started while {active} still active (gpu_lock violation)"
            )
            active = jid
        elif fields.get("status") in ("succeeded", "failed", "cancelled"):
            assert active == jid, f"terminal for {jid} but active was {active}"
            active = None


async def test_exception_isolation_worker_survives(
    client: AsyncClient, lifespan_app: FastAPI, monkeypatch, update_recorder
) -> None:
    """A failing job must not kill the worker; subsequent jobs still run."""
    from app.pipeline import transcribe as transcribe_mod

    call_count = {"n": 0}
    original = transcribe_mod.transcribe_subprocess

    async def flaky_transcribe(*args, **kwargs):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("simulated transcribe failure")
        return await original(*args, **kwargs)

    # Replace the symbol at the bind site the worker actually uses
    # (``from app.pipeline.transcribe import transcribe_subprocess``).
    monkeypatch.setattr("app.queue.worker.transcribe_subprocess", flaky_transcribe)

    job_a = await _submit(client)
    job_b = await _submit(client)
    await _drain(lifespan_app.state.jobs, timeout=10.0)

    # Worker still alive
    assert not lifespan_app.state.worker_task.done(), (
        "worker_task died on a single job exception"
    )

    # Job A failed, Job B succeeded
    a_terminal = [
        f for jid, f in update_recorder
        if jid == job_a and f.get("status") in ("failed", "succeeded", "cancelled")
    ]
    assert a_terminal and a_terminal[-1].get("status") == "failed", a_terminal
    b_terminal = [
        f for jid, f in update_recorder
        if jid == job_b and f.get("status") in ("failed", "succeeded", "cancelled")
    ]
    assert b_terminal and b_terminal[-1].get("status") == "succeeded", b_terminal


async def test_cancel_picks_up_at_stage_boundary(
    client: AsyncClient, lifespan_app: FastAPI, update_recorder
) -> None:
    """Submit + cancel + drain. In mock-engine the job may finish before
    cancel takes effect; the hard assertion is that *something* terminal
    landed AND the worker is still alive (no crash, no deadlock).
    """
    job_id = await _submit(client)
    # Cooperative cancel signals; the worker honours at the next stage boundary.
    await lifespan_app.state.jobs.cancel(job_id)
    await _drain(lifespan_app.state.jobs, timeout=10.0)
    terminal = [
        f for jid, f in update_recorder
        if jid == job_id and f.get("status") in ("succeeded", "failed", "cancelled")
    ]
    assert terminal, f"no terminal status for {job_id}"
    assert not lifespan_app.state.worker_task.done()
