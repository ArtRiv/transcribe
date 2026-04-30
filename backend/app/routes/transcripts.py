"""Phase 4 D-08: anon → signed-in promotion endpoint.

POST /jobs/{job_id}/promote — atomically (best-effort) creates a
transcripts row owned by the signed-in user and rewrites the source
job to point at the new identity.

T-04-05 mitigation: the request must include X-Previous-Anon-Token
carrying the anon JWT used to create the original job. We verify both:
  - The Authorization JWT is non-anonymous (the new identity).
  - The X-Previous-Anon-Token is anonymous and its sub matches
    jobs.user_id of the source row.
This makes hijacking another user's anon job impossible without that
user's anon-session JWT.

[Cited: 04-RESEARCH.md §Open Question 1; 04-PATTERNS.md transcripts.py row]
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.platform.jwks import verify_supabase_jwt
from app.queue.progress import get_supabase_client
from app.routes.deps import get_user_required

router = APIRouter()


class PromoteBody(BaseModel):
    payload: dict[str, Any]
    title: str
    source_filename: str
    duration_sec: int | None = None
    language: str | None = None
    model_used: str | None = None
    diarized: bool | None = None


@router.post("/jobs/{job_id}/promote", status_code=status.HTTP_201_CREATED)
async def promote_job(
    job_id: str,
    body: PromoteBody,
    request: Request,
    claims: dict[str, Any] = Depends(get_user_required),
) -> dict[str, Any]:
    """Promote an anonymous job to a signed-in user's permanent transcript.

    Gate 1: requester must NOT be anonymous (Authorization JWT).
    Gate 2: X-Previous-Anon-Token must be present, valid, and its sub must
            match the source job's user_id (T-04-05 ownership-chain check).

    T-04-PROMO-AUDIT: only job_id + transcript_id are logged; payload is NOT.
    """
    # Gate 1: requester must NOT be anonymous.
    if bool(claims.get("is_anonymous", False)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot promote with anonymous JWT",
        )
    new_user_id = claims["sub"]

    # Gate 2: the previous anon JWT must be presented and validated.
    prev_token = request.headers.get("X-Previous-Anon-Token", "")
    if not prev_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing X-Previous-Anon-Token header",
        )
    settings = request.app.state.settings
    jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    try:
        prev_claims = verify_supabase_jwt(prev_token, jwks_url=jwks_url, strict=True)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid previous-anon token",
        ) from None
    if not prev_claims or not bool(prev_claims.get("is_anonymous", False)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="X-Previous-Anon-Token must be anonymous",
        )
    prev_user_id = prev_claims["sub"]

    # Service-role lookup: source job exists + owned by prev_user_id.
    client = get_supabase_client(settings)
    if client is None:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    src = (
        client.table("jobs")
        .select("id, user_id, transcript_id")
        .eq("id", job_id)
        .single()
        .execute()
    )
    job_row = getattr(src, "data", None)
    if not job_row:
        raise HTTPException(status_code=404, detail="Job not found")
    if job_row.get("user_id") != prev_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not the original anonymous owner of this job",
        )

    # Insert transcripts row with the (edited) payload from the request.
    # D-08: payload is the in-memory edited body, NOT jobs.transcript_payload.
    # T-04-PROMO-AUDIT: log only IDs, not payload contents.
    transcript_id = str(uuid.uuid4())
    ins_fields: dict[str, Any] = {
        "id": transcript_id,
        "user_id": new_user_id,
        "payload": body.payload,
        "title": body.title,
        "source_filename": body.source_filename,
    }
    for k in ("duration_sec", "language", "model_used", "diarized"):
        v = getattr(body, k)
        if v is not None:
            ins_fields[k] = v
    client.table("transcripts").insert(ins_fields).execute()

    # Re-own the job and stitch transcript_id.
    client.table("jobs").update({
        "user_id": new_user_id,
        "transcript_id": transcript_id,
    }).eq("id", job_id).execute()

    return {"transcript_id": transcript_id, "job_id": job_id}
