"""Per-task smoke gate for 02-05 Task 2 — /readyz, /jobs, TUS reachability.

Promotes the inline behaviour bash from the plan into a permanent regression
test. The Phase-1 ``test_health.py`` already covers ``/healthz``; this file
exercises the new Phase-2 surface plus confirms the TUS router mounts on the
real ``app.main:app``.
"""

from __future__ import annotations

import io
import os
from collections.abc import AsyncIterator

import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

# All async tests here are pytest-asyncio mode=auto (configured in pyproject.toml).
# We override the package-level fixtures so each test gets a fresh lifespan with
# the env vars below applied.


@pytest.fixture(autouse=True)
def _routes_smoke_env(monkeypatch, tmp_path):
    """Force the lifespan to see real whisper-cli + a tmp work_dir.

    The package-level ``_default_mock_engine`` autouse fixture sets
    ``SKIP_VULKAN_PROBE=1`` for everything; we delete it here so this file
    actually exercises the real ``probe_vulkan_or_die`` end-to-end. That makes
    the smoke gate a permanent regression for the operator-verify checkpoint
    (Task 3 of plan 02-05).

    ``monkeypatch.setenv`` / ``delenv`` is reversed at fixture teardown so the
    rest of the suite (Phase-1 health tests) is unaffected.
    """
    monkeypatch.setenv("MOCK_ENGINE", "1")
    monkeypatch.delenv("SKIP_VULKAN_PROBE", raising=False)
    monkeypatch.setenv(
        "WHISPER_BIN_PATH",
        os.path.expanduser("~/.transcribe/build/whisper.cpp/build/bin/whisper-cli"),
    )
    monkeypatch.setenv("MODELS_DIR", os.path.expanduser("~/.transcribe/models"))
    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("WORK_DIR", str(tmp_path / "work"))
    # Force config reload so the new env vars are picked up by lifespan.
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
async def smoke_app() -> AsyncIterator[FastAPI]:
    """Yield ``app.main:app`` with lifespan started under the routes-smoke env.

    We re-import the app inside the fixture so the function-level env tweaks
    above are in effect when the lifespan reads ``get_settings()``.
    """
    from app.main import app as fastapi_app

    async with LifespanManager(fastapi_app):
        yield fastapi_app


@pytest.fixture
async def smoke_client(smoke_app: FastAPI) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=smoke_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ─── Behavior tests ──────────────────────────────────────────────────────────


async def test_healthz_still_returns_ok(smoke_client: AsyncClient) -> None:
    """B-Phase1: the inline /healthz from main.py was moved into routes/health.py;
    the contract MUST remain identical."""
    r = await smoke_client.get("/healthz")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ok"}


async def test_readyz_returns_vulkan_device_and_presets(smoke_client: AsyncClient) -> None:
    """B2: GET /readyz → 200 + vulkan_device non-null + presets_available is a list."""
    r = await smoke_client.get("/readyz")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] in {"ready", "starting"}, body
    assert body["vulkan_device"] is not None, body
    assert isinstance(body["presets_available"], list), body
    # ``ready`` should be reached after the lifespan completes (mock-engine
    # path skips pyannote so this should be True by the time we hit /readyz).
    assert body["status"] == "ready", body


async def test_post_jobs_small_multipart_returns_202(smoke_client: AsyncClient) -> None:
    """B4: POST /jobs with multipart upload <90 MB returns 202 with job_id."""
    files = {"file": ("smoke.wav", io.BytesIO(b"\x00" * 100), "audio/wav")}
    data = {"preset": "fast", "diarize": "true"}
    # Phase 4: authenticated route; MOCK_ENGINE bypasses JWKS, any Bearer value works.
    r = await smoke_client.post("/jobs", files=files, data=data, headers={"Authorization": "Bearer test"})
    assert r.status_code == 202, r.text
    body = r.json()
    assert "job_id" in body, body
    # Wave 2 ships before 02-07's JobManager; route returns the no-manager status.
    assert "queued" in body["status"], body


async def test_post_jobs_invalid_preset_returns_400(smoke_client: AsyncClient) -> None:
    """B6: POST /jobs with an unrecognised preset returns 400."""
    files = {"file": ("smoke.wav", io.BytesIO(b"x"), "audio/wav")}
    data = {"preset": "nonsense"}
    # Phase 4: authenticated route; MOCK_ENGINE bypasses JWKS, any Bearer value works.
    r = await smoke_client.post("/jobs", files=files, data=data, headers={"Authorization": "Bearer test"})
    assert r.status_code == 400, r.text


async def test_post_jobs_oversize_returns_413(smoke_client: AsyncClient) -> None:
    """B5: POST /jobs with a Content-Length > 90 MB returns 413 + 'use TUS' hint."""
    files = {"file": ("smoke.wav", io.BytesIO(b"x"), "audio/wav")}
    data = {"preset": "fast"}
    # Spoof Content-Length to trigger the early >90 MB rejection.
    # Phase 4: authenticated route; include Bearer token alongside content-length.
    r = await smoke_client.post(
        "/jobs",
        files=files,
        data=data,
        headers={"content-length": str(95 * 1024 * 1024), "Authorization": "Bearer test"},
    )
    assert r.status_code == 413, r.text
    assert "use TUS" in r.json()["detail"], r.json()


async def test_post_jobs_unknown_extension_defaults_to_bin(
    smoke_client: AsyncClient, smoke_app: FastAPI
) -> None:
    """B7: An unrecognised file extension is normalised to .bin (does NOT crash)."""
    files = {"file": ("smoke.weirdext", io.BytesIO(b"\x00" * 32), "application/octet-stream")}
    data = {"preset": "fast"}
    # Phase 4: authenticated route; MOCK_ENGINE bypasses JWKS, any Bearer value works.
    r = await smoke_client.post("/jobs", files=files, data=data, headers={"Authorization": "Bearer test"})
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]
    work_dir = smoke_app.state.settings.work_dir
    assert (work_dir / f"{job_id}.bin").exists(), list(work_dir.iterdir())


async def test_tus_options_reachable(smoke_client: AsyncClient) -> None:
    """B8: OPTIONS /uploads (TUS Capability) returns 204 with Tus-Resumable header
    — proves the TUS router from 02-04 is mounted on the app via include_router."""
    r = await smoke_client.options("/uploads")
    assert r.status_code == 204, r.text
    assert r.headers.get("Tus-Resumable") == "1.0.0"


async def test_post_uploads_returns_201_with_location(
    smoke_client: AsyncClient, smoke_app: FastAPI
) -> None:
    """B-bonus: POST /uploads (TUS Creation) returns 201 with a Location header
    containing the upload UUID — confirms the full TUS surface is wired."""
    import uuid as uu

    # Phase 4: TUS creation route now requires JWT; MOCK_ENGINE bypasses JWKS.
    r = await smoke_client.post(
        "/uploads",
        headers={"Tus-Resumable": "1.0.0", "Upload-Length": "100", "Authorization": "Bearer test"},
    )
    assert r.status_code == 201, r.text
    loc = r.headers.get("Location", "")
    uid = loc.rsplit("/", 1)[1]
    assert uu.UUID(uid)
    assert (smoke_app.state.settings.uploads_dir / uid).exists()
