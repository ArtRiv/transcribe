"""SEC-08 sentinel: no Supabase Storage HTTP call ever fires from the pipeline.

Boots the lifespan with a fake Supabase URL + service-role key, mocks ALL
HTTP traffic via respx, submits one job, drains, and asserts zero matches
against the ``/storage/v1/object`` URL pattern. The static SEC-08 sentinel
in ``test_lifecycle.py`` already prevents source-level imports of
``supabase.storage``; this is the *runtime* backstop that catches a
regression where pipeline code calls Storage indirectly (e.g., via a
custom HTTP client).

We don't expect ANY Postgres REST calls under MOCK_ENGINE either — the
mock_engine path uses a fresh supabase client each test (reset in the
fixture) and the conftest doesn't set SUPABASE_URL by default. We set it
in this fixture so the supabase client is constructible — then patch HTTP
to assert nothing leaks.
"""

from __future__ import annotations

import asyncio
import io
import os

import httpx
import pytest
import respx
from fastapi import FastAPI
from httpx import AsyncClient

from app.queue import progress as progress_mod


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch, tmp_path):
    """Use a fake Supabase URL so the supabase client constructs successfully;
    respx will intercept any traffic that hits it. We also reset the
    progress-module client cache so this test's fake URL takes effect even
    if a previous test populated the singleton.
    """
    monkeypatch.setenv("MOCK_ENGINE", "1")
    monkeypatch.setenv("SUPABASE_URL", "https://fake-project.supabase.co")
    monkeypatch.setenv(
        "SUPABASE_SERVICE_ROLE_KEY", "fake-key-for-respx-only-not-a-real-secret"
    )
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

    # As in test_queue.py, mock normalize_to_wav so the worker drains a
    # garbage 100-byte payload deterministically without exercising real
    # ffmpeg (T-02-08-RaceFlake mitigation, also keeps the test focused
    # on the SEC-08 assertion rather than ffmpeg's behaviour).
    async def fake_normalize(_src, dst):
        dst.write_bytes(b"")

    monkeypatch.setattr("app.pipeline.normalize.normalize_to_wav", fake_normalize)
    monkeypatch.setattr("app.queue.worker.normalize_to_wav", fake_normalize)
    yield
    get_settings.cache_clear()
    progress_mod.reset_client_for_tests()


@respx.mock(assert_all_called=False)
async def test_no_supabase_storage_calls_during_job(
    respx_mock, client: AsyncClient, lifespan_app: FastAPI
) -> None:
    # Allow + capture all Postgres REST + Realtime calls (UPDATEs to jobs and
    # transcripts go through here). We mock generously so the supabase client
    # doesn't 404 itself into a retry storm.
    respx_mock.route(
        url__regex=r"https://fake-project\.supabase\.co/rest/v1/.*"
    ).mock(return_value=httpx.Response(200, json=[{}]))
    respx_mock.route(
        url__regex=r"https://fake-project\.supabase\.co/auth/v1/.*"
    ).mock(return_value=httpx.Response(200, json={}))

    # FORBIDDEN: any /storage/v1/object call. We register the route but never
    # expect it to fire — the assertion below is on call_count == 0.
    storage_route = respx_mock.route(
        url__regex=r"https://fake-project\.supabase\.co/storage/v1/.*"
    ).mock(return_value=httpx.Response(200, json={}))

    # Submit a job and wait for completion
    # Phase 4: POST /jobs requires JWT; MOCK_ENGINE bypasses JWKS in conftest fixture.
    files = {"file": ("a.wav", io.BytesIO(b"\x00" * 100), "audio/wav")}
    r = await client.post(
        "/jobs",
        files=files,
        data={"preset": "fast", "diarize": "true"},
        headers={"Authorization": "Bearer test"},
    )
    assert r.status_code == 202

    async def _wait():
        jm = lifespan_app.state.jobs
        while jm.queue.qsize() > 0 or len(jm.jobs) > 0:
            await asyncio.sleep(0.05)

    await asyncio.wait_for(_wait(), timeout=10.0)

    # SEC-08: storage route MUST NOT have been called.
    assert storage_route.call_count == 0, (
        f"SEC-08 violation: pipeline made {storage_route.call_count} Supabase Storage calls "
        f"(URLs: {[str(c.request.url) for c in storage_route.calls]})"
    )
