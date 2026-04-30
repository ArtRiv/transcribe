"""POST /jobs — multipart upload route for files <90 MB (CORE-04 small path).

Files >=90 MB MUST use the TUS endpoint at ``/uploads`` (CORE-04 large path).
Both paths converge at ``app.state.jobs.submit_from_upload(...)`` which is
provided by ``app/queue/manager.py`` (Wave 3 plan 02-07). Until 02-07 lands
this route returns ``status: "queued (no manager wired)"`` so operators can
exercise the endpoint without the queue being live.
"""

from __future__ import annotations

import time
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from pydantic import ValidationError

from app.routes._uuid import coerce_job_id
from app.routes.deps import get_user_required
from app.schemas import JobCreateRequest, JobResponse

router = APIRouter()

# 90 MB; ≥ that goes to TUS.
SMALL_PATH_LIMIT = 90 * 1024 * 1024

# Aligned with the TUS server allowlist (backend/app/routes/tus.py).
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


@router.post(
    "/jobs",
    response_model=JobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_job(
    request: Request,
    file: UploadFile = File(...),
    preset: str = Form(...),
    language: str | None = Form(None),
    num_speakers: int | None = Form(None),
    diarize: bool = Form(True),
    job_id: str | None = Form(None),
    claims: dict = Depends(get_user_required),
) -> JobResponse:
    # ── Validate options via the Pydantic model (Literal-restricted preset) ──
    try:
        opts = JobCreateRequest(
            preset=preset,
            language=language,
            num_speakers=num_speakers,
            diarize=diarize,
        )
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=f"invalid options: {e.errors()}") from None

    # ── Pre-cap by Content-Length so a 100 MB body doesn't even start hitting disk ──
    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            if int(content_length) > SMALL_PATH_LIMIT:
                raise HTTPException(
                    status_code=413,
                    detail="payload too large for /jobs; use TUS at /uploads for files >= 90 MB",
                )
        except ValueError:
            # Malformed header — fall through to streaming-cap below.
            pass

    # ── Validate preset is actually available on this host (OPTS-07 gate) ────
    jobs_mgr = getattr(request.app.state, "jobs", None)
    if jobs_mgr is not None and hasattr(jobs_mgr, "presets_available"):
        try:
            avail = set(jobs_mgr.presets_available())
        except Exception:
            avail = set()
        if avail and opts.preset not in avail:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"preset {opts.preset!r} not available on this host; available: {sorted(avail)}"
                ),
            )

    # ── Resolve a safe destination path under work_dir ───────────────────────
    # Honor a client-supplied job_id (UUID v7 from frontend/lib/job/id.ts) so
    # the row in public.jobs lands at the same id the frontend uses for its
    # Realtime subscription. Falls back to a server uuid.uuid4() when the
    # client doesn't supply one (operator curl smoke, internal tests).
    # coerce_job_id raises HTTPException(400) on malformed input — defends
    # the work_dir filename + Supabase primary key from path-traversal-shaped
    # strings or accidental serialisation bugs.
    settings = request.app.state.settings
    work_dir = Path(settings.work_dir).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    job_id = coerce_job_id(job_id)
    raw_name = file.filename or "upload"
    ext = Path(raw_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        ext = ".bin"
    dst = work_dir / f"{job_id}{ext}"

    # ── Stream upload to disk (chunked; defensive cap re-asserts SMALL_PATH_LIMIT) ──
    bytes_written = 0
    try:
        with open(dst, "wb") as f_out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                bytes_written += len(chunk)
                if bytes_written > SMALL_PATH_LIMIT:
                    f_out.close()
                    dst.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail="payload exceeded 90 MB while streaming; use TUS at /uploads",
                    )
                f_out.write(chunk)
    except HTTPException:
        raise
    except Exception:
        # Anything unexpected during the write — clean up the partial file
        # so we never leave an orphan in work_dir.
        dst.unlink(missing_ok=True)
        raise

    # Extract owner identity from the verified JWT claims (Phase 4).
    # Both signed-in and anonymous-sign-in tokens provide a sub claim.
    # Plan 04-06 reads user_id + is_anonymous from the manifest to decide
    # whether to write to public.transcripts (signed-in) or jobs.transcript_payload (anon).
    user_id: str = claims["sub"]
    is_anonymous: bool = bool(claims.get("is_anonymous", False))

    meta = {
        "length": bytes_written,
        "filename": raw_name,
        "content_type": (file.content_type or "application/octet-stream"),
        "ext": ext,
        "created_at": time.time(),
        "options": opts.model_dump(),
        "user_id": user_id,
        "is_anonymous": is_anonymous,
    }

    if jobs_mgr is None or not hasattr(jobs_mgr, "submit_from_upload"):
        # Wave 2 ships before 02-07's JobManager; the route is still
        # exercisable so mock-engine integration tests can inject a fake
        # manager. Production lifespan always sets state.jobs.
        return JobResponse(job_id=job_id, status="queued (no manager wired)")

    await jobs_mgr.submit_from_upload(job_id, dst, meta)
    return JobResponse(job_id=job_id, status="queued")
