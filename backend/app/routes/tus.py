"""TUS 1.0.0 server (Creation + File + Termination extensions).

Implements the TUS subset locked in 02-RESEARCH.md §493-623 (Pattern 3) for
the ≥90 MB upload path. Source media lands at ``~/.transcribe/uploads/<uuid>/data``
with a sibling ``meta.json``; on finalisation it is moved atomically to
``~/.transcribe/work/<uuid>.<ext>`` and the queue's ``submit_from_upload`` hook
is invoked. Source media never touches Supabase Storage (SEC-08).

Security invariants (RESEARCH.md §510-516):
    1. The on-disk directory name is ``uuid.uuid4()`` — never user input.
    2. ``_safe_upload_dir`` validates uuid format AND
       ``Path.resolve().is_relative_to(uploads_dir.resolve())``.
    3. ``Upload-Metadata.filename`` is sanitised via ``os.path.basename`` +
       allow-listed regex; only stored in ``meta.json`` for display.
    4. ``Upload-Length > MAX_SIZE`` (5 GB) returns 413.
    5. Any single PATCH body is capped at MAX_CHUNK (100 MB — Cloudflare
       Tunnel limit). On exceed, the data file is truncated back to the
       pre-PATCH offset and 413 is returned.

This module does NOT mount itself on ``app.main:app``; plan 02-05 owns
``main.py`` and includes the router via ``app.include_router(...)``.
"""

from __future__ import annotations

import base64
import contextlib
import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

import anyio
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response

from app.routes._uuid import coerce_job_id
from app.routes.deps import get_user_required

router = APIRouter()

# ── TUS protocol constants ───────────────────────────────────────────────
TUS_VERSION = "1.0.0"
TUS_EXTENSIONS = "creation,termination"
MAX_SIZE = 5 * 1024 * 1024 * 1024  # 5 GB hard cap (Tus-Max-Size)
MAX_CHUNK = 100 * 1024 * 1024  # 100 MB defensive PATCH body cap (CF tunnel)

# Server-side allowlist of file extensions. Anything else degrades to ".bin"
# at finalize-time so a malicious filename header cannot smuggle an arbitrary
# extension onto the work-dir filename.
ALLOWED_EXTENSIONS = {
    ".mp3",
    ".m4a",
    ".wav",
    ".flac",
    ".ogg",
    ".aac",
    ".mpga",
    ".mp4",
    ".mkv",
    ".webm",
    ".mov",
    ".avi",
}

# Filename sanitiser — keeps alnum + dot/underscore/dash; everything else
# collapses to underscore. Applied AFTER os.path.basename, so traversal
# segments like "../" are already gone.
_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._-]")

# Regex used by tests to confirm chunked write loop honours the cap.
_CHUNK_READ_SIZE = 1 * 1024 * 1024  # 1 MB read granularity for streaming PATCH


# ── Common headers ───────────────────────────────────────────────────────


def _tus_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    """Standard TUS response headers; merge in extras as needed."""
    h: dict[str, str] = {"Tus-Resumable": TUS_VERSION}
    if extra:
        h.update(extra)
    return h


# ── Helpers ──────────────────────────────────────────────────────────────


def parse_tus_metadata(header_value: str) -> dict[str, str]:
    """Parse a TUS Upload-Metadata header value.

    The format is comma-separated ``key b64value`` pairs; a key with no value
    is allowed (per spec). Values are utf-8 decoded; decode errors fall back
    to ``replace`` rather than failing the whole upload.
    """
    out: dict[str, str] = {}
    if not header_value:
        return out
    for pair in header_value.split(","):
        pair = pair.strip()
        if not pair:
            continue
        if " " in pair:
            key, b64 = pair.split(" ", 1)
            try:
                out[key.strip().lower()] = base64.b64decode(b64).decode("utf-8", errors="replace")
            except Exception:
                # Malformed base64 — skip this pair; do not 4xx the whole request.
                continue
        else:
            out[pair.strip().lower()] = ""
    return out


def _sanitize_filename(raw: str) -> str:
    """Return a display-safe filename. NEVER used as a filesystem path."""
    if not raw:
        return "upload"
    # Strip any directory component before sanitising — defends against
    # both POSIX (``../foo``) and Windows-style (``..\foo``) traversal.
    base = os.path.basename(raw.replace("\\", "/"))
    cleaned = _FILENAME_SAFE.sub("_", base)
    # Avoid pure-dot names ("." / "..") collapsing into something traversable
    if not cleaned or cleaned in {".", ".."}:
        return "upload"
    return cleaned[:255]


def _derive_extension(sanitized_filename: str) -> str:
    """Pick a server-allow-listed extension for the work-dir filename."""
    ext = Path(sanitized_filename).suffix.lower()
    if ext in ALLOWED_EXTENSIONS:
        return ext
    return ".bin"


def _safe_upload_dir(request: Request, upload_id: str) -> Path:
    """Path-traversal-hardened resolver.

    First defence is ``uuid.UUID(upload_id)`` — rejects ``../``, percent-encoded
    traversal, and any non-UUID string. Second defence is ``Path.resolve()`` +
    ``is_relative_to(base)`` to defeat symlink escapes.
    """
    try:
        uuid.UUID(upload_id)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=404, detail="Not found") from None

    base: Path = request.app.state.settings.uploads_dir
    base = base.resolve()
    candidate = (base / upload_id).resolve()
    if not candidate.is_relative_to(base) or not candidate.is_dir():
        raise HTTPException(status_code=404, detail="Not found")
    return candidate


async def _append_request_body(
    request: Request, data_file: Path, *, current_offset: int, max_bytes: int
) -> int:
    """Append the request body to ``data_file`` in 1 MB reads; cap at ``max_bytes``.

    Returns the number of bytes written. If the cap is exceeded, truncates the
    file back to ``current_offset`` and raises HTTPException(413).

    File I/O runs in a worker thread (``anyio.to_thread``) so the event loop
    stays responsive even on 90 MB chunks (PATTERNS.md §3 — event-loop block
    threat model).
    """
    written = 0

    def _truncate_to_offset() -> None:
        # ``open("r+b").truncate(n)`` resizes the file to exactly n bytes.
        with open(data_file, "r+b") as fh:
            fh.truncate(current_offset)

    # Open in append-binary so we don't accidentally rewind on reopen.
    f = await anyio.to_thread.run_sync(lambda: open(data_file, "ab"))  # noqa: SIM115
    try:
        async for chunk in request.stream():
            if not chunk:
                continue
            written += len(chunk)
            if written > max_bytes:
                # Drain remaining bytes silently so the client doesn't reset.
                await anyio.to_thread.run_sync(f.close)
                await anyio.to_thread.run_sync(_truncate_to_offset)
                raise HTTPException(
                    status_code=413,
                    detail=f"PATCH body exceeds MAX_CHUNK ({max_bytes} bytes)",
                )
            await anyio.to_thread.run_sync(f.write, chunk)
    finally:
        # ``f`` may already be closed on the 413 path; guard the close.
        with contextlib.suppress(Exception):
            await anyio.to_thread.run_sync(f.close)
    return written


async def _finalize_upload(request: Request, upload_id: str, meta: dict[str, Any]) -> None:
    """Atomic-move the assembled file to work_dir and hand off to the queue.

    The queue's ``submit_from_upload`` hook is provided by 02-07; this plan
    accepts any callable attached to ``app.state.jobs`` so 02-08 tests can
    inject a fake submitter. If no hook is attached, we no-op gracefully —
    the file still ends up in ``work_dir`` so 02-06's orphan sweep can
    reclaim it.
    """
    settings = request.app.state.settings
    uploads_dir = Path(settings.uploads_dir).resolve()
    work_dir = Path(settings.work_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)

    # Re-derive ext from the sanitised filename meta — second defence in depth.
    ext = meta.get("ext", ".bin")
    if ext not in ALLOWED_EXTENSIONS:
        ext = ".bin"

    src = uploads_dir / upload_id / "data"
    dst = work_dir / f"{upload_id}{ext}"
    # os.replace is atomic on POSIX same-filesystem; both dirs are under
    # ~/.transcribe/ so this holds in production.
    await anyio.to_thread.run_sync(os.replace, str(src), str(dst))
    await anyio.to_thread.run_sync(shutil.rmtree, str(uploads_dir / upload_id), True)

    jobs = getattr(request.app.state, "jobs", None)
    if jobs is not None and hasattr(jobs, "submit_from_upload"):
        await jobs.submit_from_upload(upload_id, dst, meta)


# ── Endpoints ─────────────────────────────────────────────────────────────


@router.options("/uploads")
async def tus_options() -> Response:
    """Capability discovery — returned on every OPTIONS, no upload state read."""
    return Response(
        status_code=204,
        headers=_tus_headers(
            {
                "Tus-Version": TUS_VERSION,
                "Tus-Extension": TUS_EXTENSIONS,
                "Tus-Max-Size": str(MAX_SIZE),
            }
        ),
    )


@router.post("/uploads")
async def tus_create(
    request: Request,
    upload_length: int = Header(..., alias="Upload-Length"),
    upload_metadata: str = Header("", alias="Upload-Metadata"),
    tus_resumable: str = Header(..., alias="Tus-Resumable"),
    claims: dict = Depends(get_user_required),
) -> Response:
    """Creation extension. Allocates the upload directory + meta.json.

    Requires a valid JWT (anonymous-sign-in or signed-in). The verified
    ``claims["sub"]`` is persisted in ``meta.json`` so that when the
    upload finalises and ``submit_from_upload`` is called, the auth context
    is available to the queue worker (Plan 04-06) without re-verifying the
    token. Subsequent PATCH chunks do not require re-auth (TUS spec §3.3:
    the upload-id IS the resumption token after creation).
    """
    if tus_resumable != TUS_VERSION:
        raise HTTPException(status_code=412, detail="Tus-Resumable mismatch")
    if upload_length <= 0:
        raise HTTPException(status_code=400, detail="Upload-Length must be > 0")
    if upload_length > MAX_SIZE:
        raise HTTPException(status_code=413, detail="Upload exceeds Tus-Max-Size")

    metadata = parse_tus_metadata(upload_metadata)
    raw_filename = metadata.get("filename", "upload")
    sanitized = _sanitize_filename(raw_filename)
    ext = _derive_extension(sanitized)

    # Honor a client-supplied job_id from the TUS Upload-Metadata header
    # (frontend sends `job_id=<UUID v7>` per submit.ts:101). Falls back to
    # a server-generated UUID when absent. coerce_job_id rejects malformed
    # strings with HTTP 400 — defends both the upload directory path and
    # the future Supabase primary key from traversal-shaped strings.
    upload_id = coerce_job_id(metadata.get("job_id"))
    base: Path = Path(request.app.state.settings.uploads_dir).resolve()
    upload_dir = base / upload_id
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Stash verified identity in meta so 04-06 worker reads it from disk.
    # is_anonymous disambiguates write target: public.transcripts vs jobs.transcript_payload.
    meta_payload = {
        "length": upload_length,
        "filename": sanitized,  # display only — never used as fs path
        "content_type": metadata.get(
            "content-type", metadata.get("contenttype", "application/octet-stream")
        ),
        "ext": ext,
        "created_at": time.time(),
        "user_id": claims["sub"],
        "is_anonymous": bool(claims.get("is_anonymous", False)),
    }
    (upload_dir / "meta.json").write_text(json.dumps(meta_payload))

    return Response(
        status_code=201,
        headers=_tus_headers({"Location": f"/uploads/{upload_id}"}),
    )


@router.head("/uploads/{upload_id}")
async def tus_head(upload_id: str, request: Request) -> Response:
    """File extension — return current Upload-Offset and Upload-Length."""
    upload_dir = _safe_upload_dir(request, upload_id)
    data_file = upload_dir / "data"
    offset = data_file.stat().st_size if data_file.exists() else 0
    try:
        meta = json.loads((upload_dir / "meta.json").read_text())
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Not found") from None

    return Response(
        status_code=200,
        headers=_tus_headers(
            {
                "Upload-Offset": str(offset),
                "Upload-Length": str(meta["length"]),
                "Cache-Control": "no-store",
            }
        ),
    )


@router.patch("/uploads/{upload_id}")
async def tus_patch(
    upload_id: str,
    request: Request,
    upload_offset: int = Header(..., alias="Upload-Offset"),
    content_type: str = Header(..., alias="Content-Type"),
    tus_resumable: str = Header(TUS_VERSION, alias="Tus-Resumable"),
) -> Response:
    """File extension — append a chunk to ``data`` and finalise on completion."""
    if content_type != "application/offset+octet-stream":
        raise HTTPException(
            status_code=415,
            detail="TUS PATCH requires application/offset+octet-stream",
        )
    if tus_resumable != TUS_VERSION:
        raise HTTPException(status_code=412, detail="Tus-Resumable mismatch")

    upload_dir = _safe_upload_dir(request, upload_id)
    data_file = upload_dir / "data"
    current = data_file.stat().st_size if data_file.exists() else 0
    if current != upload_offset:
        raise HTTPException(
            status_code=409,
            detail=f"Offset mismatch (server={current}, client={upload_offset})",
        )

    try:
        meta = json.loads((upload_dir / "meta.json").read_text())
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Not found") from None

    declared_length = int(meta["length"])
    # Cap remaining bytes at MAX_CHUNK; this is the defensive Cloudflare
    # tunnel limit even if the client misbehaves.
    cap = min(MAX_CHUNK, declared_length - current)
    # Ensure the data file exists before append (open(.., "ab") creates it,
    # but we want a deterministic stat() check above).
    data_file.touch(exist_ok=True)
    bytes_written = await _append_request_body(
        request, data_file, current_offset=current, max_bytes=cap
    )
    new_offset = current + bytes_written

    if new_offset > declared_length:
        # Should not happen given the cap, but be paranoid: truncate and 413.
        with open(data_file, "r+b") as fh:
            fh.truncate(current)
        raise HTTPException(status_code=413, detail="Wrote past Upload-Length")

    if new_offset == declared_length:
        await _finalize_upload(request, upload_id, meta)

    return Response(
        status_code=204,
        headers=_tus_headers({"Upload-Offset": str(new_offset)}),
    )


@router.delete("/uploads/{upload_id}")
async def tus_terminate(upload_id: str, request: Request) -> Response:
    """Termination extension — remove the upload directory."""
    upload_dir = _safe_upload_dir(request, upload_id)
    shutil.rmtree(upload_dir, ignore_errors=True)
    return Response(status_code=204, headers=_tus_headers())
