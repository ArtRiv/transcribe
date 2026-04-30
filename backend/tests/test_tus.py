"""CORE-04 (large path) — TUS protocol conformance + finalize hook.

Exercises the full TUS lifecycle (OPTIONS → POST → HEAD → PATCH → HEAD →
PATCH → finalize) on the real lifespan-managed app. The PATCH that crosses
``Upload-Length`` triggers ``_finalize_upload`` which atomic-moves the
assembled file to ``work_dir`` and calls ``JobManager.submit_from_upload``;
that hand-off is what the ``CORE-07`` cleanup assertion below verifies (the
work-dir WAV is gone after the worker drains).

A separate file from ``test_tus_routes.py`` (which mounts the TUS router on
a stand-alone FastAPI() with a fake JobManager): this file exercises the
*real* lifespan-attached JobManager so the queue submit + worker drain +
cleanup chain is end-to-end.
"""

from __future__ import annotations

import asyncio
import os
import uuid as uu

import pytest
from fastapi import FastAPI
from httpx import AsyncClient


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch, tmp_path):
    """Per-test env: redirect dirs to ``tmp_path`` + force the slow gate off."""
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


# Phase 4: POST /uploads (TUS creation) now requires a JWT.
# Including Authorization in the shared headers dict covers all creation calls.
# PATCH/HEAD/DELETE routes do not require auth (only creation is gated).
TUS_HDR = {"Tus-Resumable": "1.0.0", "Authorization": "Bearer test"}


async def test_options_uploads_returns_capabilities(client: AsyncClient) -> None:
    r = await client.options("/uploads")
    assert r.status_code == 204
    assert r.headers["Tus-Resumable"] == "1.0.0"
    assert "creation" in r.headers["Tus-Extension"]
    assert "termination" in r.headers["Tus-Extension"]


async def test_full_tus_lifecycle_finalize_invokes_queue(
    client: AsyncClient, lifespan_app: FastAPI
) -> None:
    """POST → HEAD → PATCH → HEAD → PATCH → finalize → JobManager.submit_from_upload.

    The finalize step both moves the assembled file to ``work_dir`` AND
    invokes ``state.jobs.submit_from_upload`` (which enqueues into the
    real ``JobManager.queue``). After draining we verify CORE-07: the
    intermediate WAV is gone too.
    """
    # POST — Upload-Length=200, filename=demo.wav (b64'd)
    r = await client.post(
        "/uploads",
        headers={
            **TUS_HDR,
            "Upload-Length": "200",
            "Upload-Metadata": "filename ZGVtby53YXY=",
        },
    )
    assert r.status_code == 201
    loc = r.headers["Location"]
    uid = loc.rsplit("/", 1)[1]
    assert uu.UUID(uid)  # well-formed

    # HEAD initial
    r = await client.head(f"/uploads/{uid}")
    assert r.status_code == 200
    assert r.headers["Upload-Offset"] == "0"
    assert r.headers["Upload-Length"] == "200"

    # PATCH first 100 bytes
    r = await client.patch(
        f"/uploads/{uid}",
        content=b"a" * 100,
        headers={
            **TUS_HDR,
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": "0",
        },
    )
    assert r.status_code == 204
    assert r.headers["Upload-Offset"] == "100"

    # HEAD after partial — offset advanced
    r = await client.head(f"/uploads/{uid}")
    assert r.headers["Upload-Offset"] == "100"

    # PATCH final 100 bytes — triggers finalize → submit_from_upload
    r = await client.patch(
        f"/uploads/{uid}",
        content=b"b" * 100,
        headers={
            **TUS_HDR,
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": "100",
        },
    )
    assert r.status_code == 204
    assert r.headers["Upload-Offset"] == "200"

    # The upload dir is removed; the file moved to work_dir
    uploads_dir = lifespan_app.state.settings.uploads_dir
    work_dir = lifespan_app.state.settings.work_dir
    assert not (uploads_dir / uid).exists()

    # Wait briefly for the worker to drain (mock-engine each <100ms)
    async def _wait():
        jm = lifespan_app.state.jobs
        while jm.queue.qsize() > 0 or len(jm.jobs) > 0:
            await asyncio.sleep(0.05)

    await asyncio.wait_for(_wait(), timeout=5.0)
    # CORE-07: after worker drain, the intermediate WAV is also cleaned
    assert not (work_dir / f"{uid}.wav").exists()


async def test_head_unknown_uuid_returns_404(client: AsyncClient) -> None:
    r = await client.head("/uploads/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


async def test_head_path_traversal_returns_404(client: AsyncClient) -> None:
    """A non-UUID path is rejected by ``_safe_upload_dir`` before fs touches."""
    r = await client.head("/uploads/..%2F..%2Fetc%2Fpasswd")
    assert r.status_code == 404


async def test_patch_wrong_content_type_returns_415(client: AsyncClient) -> None:
    r = await client.post("/uploads", headers={**TUS_HDR, "Upload-Length": "100"})
    uid = r.headers["Location"].rsplit("/", 1)[1]
    r = await client.patch(
        f"/uploads/{uid}",
        content=b"x" * 50,
        headers={
            **TUS_HDR,
            "Content-Type": "text/plain",
            "Upload-Offset": "0",
        },
    )
    assert r.status_code == 415


async def test_patch_offset_mismatch_returns_409(client: AsyncClient) -> None:
    r = await client.post("/uploads", headers={**TUS_HDR, "Upload-Length": "100"})
    uid = r.headers["Location"].rsplit("/", 1)[1]
    r = await client.patch(
        f"/uploads/{uid}",
        content=b"x" * 50,
        headers={
            **TUS_HDR,
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": "999",
        },
    )
    assert r.status_code == 409


async def test_delete_removes_upload_dir(
    client: AsyncClient, lifespan_app: FastAPI
) -> None:
    r = await client.post("/uploads", headers={**TUS_HDR, "Upload-Length": "100"})
    uid = r.headers["Location"].rsplit("/", 1)[1]
    assert (lifespan_app.state.settings.uploads_dir / uid).exists()
    r = await client.delete(f"/uploads/{uid}")
    assert r.status_code == 204
    assert not (lifespan_app.state.settings.uploads_dir / uid).exists()
    # Subsequent HEAD now hits the 404 branch in _safe_upload_dir
    r = await client.head(f"/uploads/{uid}")
    assert r.status_code == 404
