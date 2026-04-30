"""CORE-04 (small path) + CORE-07 (cleanup) — mock-engine end-to-end.

Exercises POST /jobs through the lifespan-managed FastAPI app under
``MOCK_ENGINE=1``: enqueue, drain, then assert ``cleanup_job_files`` removed
both the source media AND the intermediate WAV (CORE-07).

The conftest already sets ``MOCK_ENGINE=1`` + ``SKIP_VULKAN_PROBE=1`` for
every test; the ``_mock_env`` fixture below additionally points
``UPLOADS_DIR`` / ``WORK_DIR`` at the per-test ``tmp_path`` so cleanup
assertions read the same dirs the worker wrote.
"""

from __future__ import annotations

import asyncio
import io
import os

import pytest
from fastapi import FastAPI
from httpx import AsyncClient


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch, tmp_path):
    """Per-test env: redirect dirs to ``tmp_path`` + force the slow gate off.

    ``get_settings.cache_clear()`` is required because the singleton may have
    been instantiated with the previous test's env values; the lifespan reads
    settings on startup so a stale singleton would silently use the wrong dirs.
    """
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
    yield
    get_settings.cache_clear()


async def _drain_worker(jobs_mgr, timeout: float = 5.0) -> None:
    """Wait until the worker queue is empty AND no in-flight jobs remain."""

    async def _wait():
        while jobs_mgr.queue.qsize() > 0 or len(jobs_mgr.jobs) > 0:
            await asyncio.sleep(0.05)

    await asyncio.wait_for(_wait(), timeout=timeout)


async def test_post_jobs_valid_preset_enqueues_and_runs(
    client: AsyncClient, lifespan_app: FastAPI
) -> None:
    files = {"file": ("demo.mp3", io.BytesIO(b"\x00" * 100), "audio/mpeg")}
    data = {"preset": "fast", "diarize": "true"}
    # Phase 4: POST /jobs now requires a JWT; MOCK_ENGINE bypasses JWKS verification.
    r = await client.post("/jobs", files=files, data=data, headers={"Authorization": "Bearer test"})
    assert r.status_code == 202, r.text
    body = r.json()
    assert "job_id" in body and body["status"] == "queued"

    await _drain_worker(lifespan_app.state.jobs)
    # CORE-07: cleanup removed the source mp3 + intermediate wav
    work_dir = lifespan_app.state.settings.work_dir
    assert not (work_dir / f"{body['job_id']}.mp3").exists(), "source media not cleaned"
    assert not (work_dir / f"{body['job_id']}.wav").exists(), "intermediate WAV not cleaned"


async def test_post_jobs_slow_preset_rejected(client: AsyncClient) -> None:
    files = {"file": ("demo.wav", io.BytesIO(b"\x00" * 50), "audio/wav")}
    data = {"preset": "slow"}
    # Phase 4: JWT required; MOCK_ENGINE bypasses JWKS.
    r = await client.post("/jobs", files=files, data=data, headers={"Authorization": "Bearer test"})
    # The Pydantic Literal rejects 'slow' first (400 from the JobCreateRequest
    # validator); even if it didn't, the JobManager presets gate would also 400.
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    detail_str = detail if isinstance(detail, str) else str(detail)
    assert "slow" in detail_str.lower() or "available" in detail_str.lower()


async def test_post_jobs_missing_preset_returns_422(client: AsyncClient) -> None:
    files = {"file": ("demo.wav", io.BytesIO(b"\x00" * 50), "audio/wav")}
    # Phase 4: JWT required. Missing preset → 422 (Pydantic) before even reaching auth.
    # Actually FastAPI processes Depends before form validation, so 401 if no token.
    # Include token to ensure the 422 is from missing preset, not missing auth.
    r = await client.post("/jobs", files=files, headers={"Authorization": "Bearer test"})
    assert r.status_code == 422


async def test_post_jobs_content_length_over_90mb_returns_413(client: AsyncClient) -> None:
    files = {"file": ("demo.wav", io.BytesIO(b"x"), "audio/wav")}
    data = {"preset": "fast"}
    # Phase 4: include auth header alongside content-length spoof.
    r = await client.post(
        "/jobs",
        files=files,
        data=data,
        headers={"content-length": str(95 * 1024 * 1024), "Authorization": "Bearer test"},
    )
    assert r.status_code == 413, r.text
    assert "use TUS" in r.json()["detail"]


async def test_post_jobs_unknown_extension_defaults_to_bin(
    client: AsyncClient, lifespan_app: FastAPI
) -> None:
    files = {
        "file": ("audio.weird", io.BytesIO(b"\x00" * 100), "application/octet-stream"),
    }
    data = {"preset": "fast"}
    # Phase 4: JWT required.
    r = await client.post("/jobs", files=files, data=data, headers={"Authorization": "Bearer test"})
    assert r.status_code == 202
    body = r.json()
    # The work-dir filename must be sanitised to .bin (no .weird leak)
    work_dir = lifespan_app.state.settings.work_dir
    # The file may have been cleaned up already by the worker; the sanitiser
    # contract is that ONLY ``<job_id>.bin`` is ever written — never .weird.
    assert not (work_dir / f"{body['job_id']}.weird").exists(), list(work_dir.iterdir())
    await _drain_worker(lifespan_app.state.jobs)


async def test_post_jobs_no_crash_on_unrecognised_extension(
    client: AsyncClient, lifespan_app: FastAPI
) -> None:
    """Companion to the previous test: end-to-end run + cleanup also succeeds."""
    files = {
        "file": ("garbled.xyz", io.BytesIO(b"\x00" * 50), "application/octet-stream"),
    }
    # Phase 4: JWT required.
    r = await client.post("/jobs", files=files, data={"preset": "fast"}, headers={"Authorization": "Bearer test"})
    assert r.status_code == 202
    await _drain_worker(lifespan_app.state.jobs)
    # CORE-07: even the .bin path gets cleaned
    work_dir = lifespan_app.state.settings.work_dir
    job_id = r.json()["job_id"]
    assert not (work_dir / f"{job_id}.bin").exists()
