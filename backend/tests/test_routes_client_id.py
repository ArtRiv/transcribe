"""Quick task 260430-lfu — backend honors client-supplied job_id.

The frontend (frontend/lib/job/submit.ts) generates a UUID v7 and sends it
as the ``job_id`` form field on POST /jobs and as ``job_id`` TUS metadata
on POST /uploads, then subscribes Realtime on ``id=eq.<that>``. Before
this fix the backend ignored the client value and generated a fresh
uuid.uuid4(), so subscriptions never matched and the UI sat at 0%.

Three behaviours per route:
  1. valid client UUID is honored (response/Location reflects it)
  2. missing → server falls back to a well-formed UUID
  3. malformed → 400 with a helpful detail
"""

from __future__ import annotations

import base64
import io
import os
import shutil
import tempfile
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

# ── /jobs route tests ──────────────────────────────────────────────────────

# Reuses the autouse `_default_mock_engine` from conftest + the `client` /
# `lifespan_app` fixtures already provided. Mirrors test_jobs.py setup so
# work_dir cleanup doesn't bleed across tests.


@pytest.fixture(autouse=True)
def _mock_env_for_jobs(monkeypatch, tmp_path):
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


_VALID_V7 = "019ddf85-af5f-72dc-a466-5452c13a61ea"


async def test_post_jobs_honors_client_supplied_job_id(client: AsyncClient) -> None:
    files = {"file": ("demo.mp3", io.BytesIO(b"\x00" * 100), "audio/mpeg")}
    data = {"preset": "fast", "diarize": "true", "job_id": _VALID_V7}
    r = await client.post("/jobs", files=files, data=data, headers={"Authorization": "Bearer test"})
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["job_id"] == _VALID_V7, (
        f"expected backend to honor client UUID v7 {_VALID_V7}, got {body['job_id']}"
    )


async def test_post_jobs_missing_job_id_falls_back_to_server_uuid(
    client: AsyncClient,
) -> None:
    files = {"file": ("demo.mp3", io.BytesIO(b"\x00" * 100), "audio/mpeg")}
    data = {"preset": "fast", "diarize": "true"}  # no job_id
    r = await client.post("/jobs", files=files, data=data, headers={"Authorization": "Bearer test"})
    assert r.status_code == 202, r.text
    body = r.json()
    # Returned id is a well-formed UUID (the canonical-string round-trip works)
    parsed = uuid.UUID(body["job_id"])
    assert str(parsed) == body["job_id"]


async def test_post_jobs_malformed_job_id_returns_400(client: AsyncClient) -> None:
    files = {"file": ("demo.mp3", io.BytesIO(b"\x00" * 100), "audio/mpeg")}
    data = {"preset": "fast", "diarize": "true", "job_id": "not-a-uuid"}
    r = await client.post("/jobs", files=files, data=data, headers={"Authorization": "Bearer test"})
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    detail_str = detail if isinstance(detail, str) else str(detail)
    assert "invalid job_id" in detail_str.lower() or "uuid" in detail_str.lower()


async def test_post_jobs_path_traversal_job_id_returns_400(client: AsyncClient) -> None:
    """Defence in depth: a traversal-shaped job_id must be rejected before
    it reaches the work_dir filename composition."""
    files = {"file": ("demo.mp3", io.BytesIO(b"\x00" * 100), "audio/mpeg")}
    data = {
        "preset": "fast",
        "diarize": "true",
        "job_id": "../../../etc/passwd",
    }
    r = await client.post("/jobs", files=files, data=data, headers={"Authorization": "Bearer test"})
    assert r.status_code == 400, r.text


# ── TUS create tests (mini-app pattern from test_tus_routes.py) ─────────────


def _b64(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


@pytest_asyncio.fixture
async def tus_app() -> AsyncIterator[tuple[FastAPI, Path]]:
    from app.routes.tus import router

    workroot = Path(tempfile.mkdtemp(prefix="tus_clientid_"))
    uploads_dir = workroot / "uploads"
    work_dir = workroot / "work"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    app = FastAPI()
    app.state.settings = SimpleNamespace(
        uploads_dir=uploads_dir,
        work_dir=work_dir,
        supabase_url="https://test.supabase.co",
    )

    from app.routes.deps import get_user_required

    app.dependency_overrides[get_user_required] = lambda: {
        "sub": "test-user-uuid",
        "aud": "authenticated",
        "is_anonymous": False,
    }
    app.include_router(router)
    try:
        yield app, uploads_dir
    finally:
        shutil.rmtree(workroot, ignore_errors=True)


@pytest_asyncio.fixture
async def tus_client(tus_app):
    app, _ = tus_app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def test_tus_post_honors_client_supplied_job_id(tus_client: AsyncClient, tus_app) -> None:
    _, uploads_dir = tus_app
    metadata = f"filename {_b64('demo.wav')},job_id {_b64(_VALID_V7)}"
    r = await tus_client.post(
        "/uploads",
        headers={
            "Upload-Length": "1000",
            "Tus-Resumable": "1.0.0",
            "Upload-Metadata": metadata,
        },
    )
    assert r.status_code == 201, r.text
    loc = r.headers["Location"]
    upload_id = loc.rsplit("/", 1)[1]
    assert upload_id == _VALID_V7, (
        f"expected TUS create to honor client UUID v7 {_VALID_V7}, got {upload_id}"
    )
    # The on-disk directory is created at the client's id, NOT a server uuid.
    assert (uploads_dir / _VALID_V7).is_dir()


async def test_tus_post_missing_job_id_falls_back(tus_client: AsyncClient) -> None:
    r = await tus_client.post(
        "/uploads",
        headers={
            "Upload-Length": "1000",
            "Tus-Resumable": "1.0.0",
            "Upload-Metadata": f"filename {_b64('demo.wav')}",  # no job_id
        },
    )
    assert r.status_code == 201, r.text
    upload_id = r.headers["Location"].rsplit("/", 1)[1]
    parsed = uuid.UUID(upload_id)
    assert str(parsed) == upload_id


async def test_tus_post_malformed_job_id_returns_400(tus_client: AsyncClient) -> None:
    metadata = f"filename {_b64('demo.wav')},job_id {_b64('not-a-uuid')}"
    r = await tus_client.post(
        "/uploads",
        headers={
            "Upload-Length": "1000",
            "Tus-Resumable": "1.0.0",
            "Upload-Metadata": metadata,
        },
    )
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    detail_str = detail if isinstance(detail, str) else str(detail)
    assert "invalid job_id" in detail_str.lower() or "uuid" in detail_str.lower()


# ── coerce_job_id helper unit tests ─────────────────────────────────────────


def test_coerce_job_id_none_returns_fresh_uuid() -> None:
    from app.routes._uuid import coerce_job_id

    out = coerce_job_id(None)
    assert str(uuid.UUID(out)) == out


def test_coerce_job_id_empty_returns_fresh_uuid() -> None:
    from app.routes._uuid import coerce_job_id

    out = coerce_job_id("")
    assert str(uuid.UUID(out)) == out


def test_coerce_job_id_canonicalises_uppercase_uuid() -> None:
    from app.routes._uuid import coerce_job_id

    out = coerce_job_id(_VALID_V7.upper())
    # uuid.UUID() lowercases on str() — consistent primary key.
    assert out == _VALID_V7


def test_coerce_job_id_rejects_random_string() -> None:
    from fastapi import HTTPException

    from app.routes._uuid import coerce_job_id

    with pytest.raises(HTTPException) as ei:
        coerce_job_id("not-a-uuid")
    assert ei.value.status_code == 400
