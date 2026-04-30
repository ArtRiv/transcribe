"""TUS 1.0.0 server contract tests (Creation + File + Termination extensions).

Covers all 14 behaviour cases from 02-04-tus-server-PLAN.md (Task 2). The router
is mounted on a fresh FastAPI() in the fixture (the real app.main does NOT
include this router until plan 02-05). Settings are duck-typed via a tiny stand-in
since uploads_dir/work_dir land on the real Settings object in plan 02-02.
"""

from __future__ import annotations

import asyncio
import base64
import json
import shutil
import tempfile
import uuid as uu
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient


def _b64(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


@pytest_asyncio.fixture
async def tus_app() -> AsyncIterator[tuple[FastAPI, list[tuple], Path, Path]]:
    """Yield (FastAPI app, capture-list-for-finalize, uploads_dir, work_dir)."""
    from app.routes.tus import router

    workroot = Path(tempfile.mkdtemp(prefix="tus_test_"))
    uploads_dir = workroot / "uploads"
    work_dir = workroot / "work"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    app = FastAPI()
    # Settings is duck-typed: tus.py reads .uploads_dir / .work_dir / .supabase_url.
    # Phase 4: supabase_url is needed by get_user_required to build the JWKS URL;
    # the actual JWKS call is bypassed by the _mock_jwt_verify conftest fixture.
    app.state.settings = SimpleNamespace(
        uploads_dir=uploads_dir,
        work_dir=work_dir,
        supabase_url="https://test.supabase.co",
    )

    # Phase 4: override get_user_required so all TUS unit tests skip live JWT
    # verification. The tus_app fixture builds its own mini FastAPI and does not
    # go through the MOCK_ENGINE lifespan; dependency_overrides is the FastAPI
    # way to stub a dep for a specific app instance.
    from app.routes.deps import get_user_required

    app.dependency_overrides[get_user_required] = lambda: {
        "sub": "test-user-uuid",
        "aud": "authenticated",
        "is_anonymous": False,
    }

    submitted: list[tuple] = []

    class FakeJobs:
        async def submit_from_upload(
            self, upload_id: str, work_path: Path, meta: dict
        ) -> str:
            submitted.append((upload_id, str(work_path), meta))
            return f"job_{upload_id}"

    app.state.jobs = FakeJobs()
    app.include_router(router)

    try:
        yield app, submitted, uploads_dir, work_dir
    finally:
        shutil.rmtree(workroot, ignore_errors=True)


@pytest_asyncio.fixture
async def client(tus_app):
    app, *_ = tus_app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── Test 1: OPTIONS exposes capability headers ────────────────────────────


async def test_options_returns_capability_headers(client: AsyncClient) -> None:
    r = await client.options("/uploads")
    assert r.status_code == 204, r.text
    assert r.headers["Tus-Resumable"] == "1.0.0"
    assert r.headers["Tus-Version"] == "1.0.0"
    assert "creation" in r.headers["Tus-Extension"]
    assert "termination" in r.headers["Tus-Extension"]
    assert int(r.headers["Tus-Max-Size"]) == 5 * 1024 * 1024 * 1024


# ── Test 2: POST creates upload + meta.json ───────────────────────────────


async def test_post_creates_upload(client: AsyncClient, tus_app) -> None:
    _, _, uploads_dir, _ = tus_app
    r = await client.post(
        "/uploads",
        headers={
            "Upload-Length": "1000",
            "Tus-Resumable": "1.0.0",
            "Upload-Metadata": f"filename {_b64('demo.wav')}",
        },
    )
    assert r.status_code == 201, r.text
    assert r.headers["Tus-Resumable"] == "1.0.0"
    loc = r.headers["Location"]
    assert loc.startswith("/uploads/")
    upload_id = loc.rsplit("/", 1)[1]
    # uuid is well-formed
    uu.UUID(upload_id)
    # meta.json exists with length recorded
    meta = json.loads((uploads_dir / upload_id / "meta.json").read_text())
    assert meta["length"] == 1000
    assert meta["filename"] == "demo.wav"


# ── Test 3: POST > 5 GB returns 413 ────────────────────────────────────────


async def test_post_too_large_returns_413(client: AsyncClient) -> None:
    r = await client.post(
        "/uploads",
        headers={"Upload-Length": str(99_999_999_999), "Tus-Resumable": "1.0.0"},
    )
    assert r.status_code == 413


# ── Test 4: wrong Tus-Resumable returns 412 ────────────────────────────────


async def test_post_wrong_tus_version_returns_412(client: AsyncClient) -> None:
    r = await client.post(
        "/uploads", headers={"Upload-Length": "100", "Tus-Resumable": "0.9.0"}
    )
    assert r.status_code == 412


# ── Test 5: HEAD on fresh upload returns offset=0 + length ─────────────────


async def test_head_returns_offset_and_length(client: AsyncClient) -> None:
    r = await client.post(
        "/uploads", headers={"Upload-Length": "1000", "Tus-Resumable": "1.0.0"}
    )
    upload_id = r.headers["Location"].rsplit("/", 1)[1]
    r = await client.head(f"/uploads/{upload_id}")
    assert r.status_code == 200
    assert r.headers["Upload-Offset"] == "0"
    assert r.headers["Upload-Length"] == "1000"
    assert r.headers["Tus-Resumable"] == "1.0.0"
    assert r.headers["Cache-Control"] == "no-store"


# ── Test 6: Path traversal via non-uuid ID rejected ────────────────────────


async def test_head_path_traversal_rejected(client: AsyncClient) -> None:
    r = await client.head("/uploads/..%2F..%2Fetc%2Fpasswd")
    assert r.status_code == 404


# ── Test 7: HEAD on well-formed nonexistent UUID returns 404 ──────────────


async def test_head_unknown_uuid_returns_404(client: AsyncClient) -> None:
    r = await client.head("/uploads/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


# ── Test 8: PATCH happy path appends bytes ─────────────────────────────────


async def test_patch_appends_bytes(client: AsyncClient, tus_app) -> None:
    _, _, uploads_dir, _ = tus_app
    r = await client.post(
        "/uploads", headers={"Upload-Length": "200", "Tus-Resumable": "1.0.0"}
    )
    upload_id = r.headers["Location"].rsplit("/", 1)[1]
    r = await client.patch(
        f"/uploads/{upload_id}",
        content=b"a" * 100,
        headers={
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": "0",
            "Tus-Resumable": "1.0.0",
        },
    )
    assert r.status_code == 204, r.text
    assert r.headers["Upload-Offset"] == "100"
    assert r.headers["Tus-Resumable"] == "1.0.0"
    data = (uploads_dir / upload_id / "data").read_bytes()
    assert data == b"a" * 100


# ── Test 9: PATCH with wrong Content-Type returns 415 ──────────────────────


async def test_patch_wrong_content_type_returns_415(client: AsyncClient) -> None:
    r = await client.post(
        "/uploads", headers={"Upload-Length": "100", "Tus-Resumable": "1.0.0"}
    )
    upload_id = r.headers["Location"].rsplit("/", 1)[1]
    r = await client.patch(
        f"/uploads/{upload_id}",
        content=b"x" * 10,
        headers={
            "Content-Type": "text/plain",
            "Upload-Offset": "0",
            "Tus-Resumable": "1.0.0",
        },
    )
    assert r.status_code == 415


# ── Test 10: PATCH with wrong offset returns 409 ──────────────────────────


async def test_patch_offset_mismatch_returns_409(client: AsyncClient) -> None:
    r = await client.post(
        "/uploads", headers={"Upload-Length": "100", "Tus-Resumable": "1.0.0"}
    )
    upload_id = r.headers["Location"].rsplit("/", 1)[1]
    r = await client.patch(
        f"/uploads/{upload_id}",
        content=b"x" * 10,
        headers={
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": "999",
            "Tus-Resumable": "1.0.0",
        },
    )
    assert r.status_code == 409


# ── Test 11: PATCH chunk > 100 MB returns 413 ─────────────────────────────


async def test_patch_chunk_over_max_returns_413(client: AsyncClient) -> None:
    # Create an upload with very large declared length (5 GB - 1) so the chunk
    # cap (100 MB) is the only failure path under test.
    five_gb_minus_1 = 5 * 1024 * 1024 * 1024 - 1
    r = await client.post(
        "/uploads",
        headers={"Upload-Length": str(five_gb_minus_1), "Tus-Resumable": "1.0.0"},
    )
    upload_id = r.headers["Location"].rsplit("/", 1)[1]
    # 100 MB + 1 byte body — defensively rejected.
    body = b"a" * ((100 * 1024 * 1024) + 1)
    r = await client.patch(
        f"/uploads/{upload_id}",
        content=body,
        headers={
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": "0",
            "Tus-Resumable": "1.0.0",
        },
    )
    assert r.status_code == 413


# ── Test 12: PATCH reaching length finalizes (move + queue hand-off) ──────


async def test_patch_finalize_moves_and_submits(
    client: AsyncClient, tus_app
) -> None:
    _, submitted, uploads_dir, work_dir = tus_app
    # filename = demo.wav -> ext .wav
    r = await client.post(
        "/uploads",
        headers={
            "Upload-Length": "100",
            "Tus-Resumable": "1.0.0",
            "Upload-Metadata": f"filename {_b64('demo.wav')}",
        },
    )
    upload_id = r.headers["Location"].rsplit("/", 1)[1]
    # First half
    r = await client.patch(
        f"/uploads/{upload_id}",
        content=b"a" * 50,
        headers={
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": "0",
            "Tus-Resumable": "1.0.0",
        },
    )
    assert r.status_code == 204
    # Second half - triggers finalize
    r = await client.patch(
        f"/uploads/{upload_id}",
        content=b"b" * 50,
        headers={
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": "50",
            "Tus-Resumable": "1.0.0",
        },
    )
    assert r.status_code == 204
    assert r.headers["Upload-Offset"] == "100"
    # Wait briefly for any background tasks (none in our impl, but defensive)
    await asyncio.sleep(0)
    assert len(submitted) == 1, submitted
    assert submitted[0][0] == upload_id
    assert not (uploads_dir / upload_id).exists()
    assert (work_dir / f"{upload_id}.wav").exists()
    assert (work_dir / f"{upload_id}.wav").read_bytes() == b"a" * 50 + b"b" * 50


# ── Test 13: DELETE removes dir; second DELETE returns 404 ────────────────


async def test_delete_removes_then_404(client: AsyncClient) -> None:
    r = await client.post(
        "/uploads", headers={"Upload-Length": "100", "Tus-Resumable": "1.0.0"}
    )
    upload_id = r.headers["Location"].rsplit("/", 1)[1]
    r = await client.delete(f"/uploads/{upload_id}")
    assert r.status_code == 204
    assert r.headers["Tus-Resumable"] == "1.0.0"
    # Second delete: dir gone, _safe_upload_dir raises 404
    r = await client.delete(f"/uploads/{upload_id}")
    assert r.status_code == 404


# ── Test 14: every endpoint emits Tus-Resumable: 1.0.0 ────────────────────


async def test_all_endpoints_emit_tus_resumable(client: AsyncClient) -> None:
    # OPTIONS
    r = await client.options("/uploads")
    assert r.headers["Tus-Resumable"] == "1.0.0"
    # POST
    r = await client.post(
        "/uploads", headers={"Upload-Length": "20", "Tus-Resumable": "1.0.0"}
    )
    assert r.headers["Tus-Resumable"] == "1.0.0"
    upload_id = r.headers["Location"].rsplit("/", 1)[1]
    # HEAD
    r = await client.head(f"/uploads/{upload_id}")
    assert r.headers["Tus-Resumable"] == "1.0.0"
    # PATCH
    r = await client.patch(
        f"/uploads/{upload_id}",
        content=b"x" * 5,
        headers={
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": "0",
            "Tus-Resumable": "1.0.0",
        },
    )
    assert r.headers["Tus-Resumable"] == "1.0.0"
    # DELETE
    r = await client.delete(f"/uploads/{upload_id}")
    assert r.headers["Tus-Resumable"] == "1.0.0"


# ── Bonus: filename sanitisation against path traversal in metadata ───────


async def test_post_sanitizes_filename_metadata(
    client: AsyncClient, tus_app
) -> None:
    _, _, uploads_dir, _ = tus_app
    # The user is trying to escape via Upload-Metadata.filename
    r = await client.post(
        "/uploads",
        headers={
            "Upload-Length": "10",
            "Tus-Resumable": "1.0.0",
            "Upload-Metadata": f"filename {_b64('../../etc/passwd')}",
        },
    )
    assert r.status_code == 201
    upload_id = r.headers["Location"].rsplit("/", 1)[1]
    # The filesystem dir name is the uuid — never the user filename
    assert (uploads_dir / upload_id).is_dir()
    # meta.json filename is sanitised (no dots-only / slashes)
    meta = json.loads((uploads_dir / upload_id / "meta.json").read_text())
    assert "/" not in meta["filename"]
    assert ".." not in meta["filename"] or meta["filename"] == "passwd"


# Marker so pytest-asyncio in auto mode handles all coroutines
pytestmark = pytest.mark.asyncio
