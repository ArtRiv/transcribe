"""Supabase-py wrapper for jobs row UPDATEs (L5 + L8).

The service-role key NEVER leaves this module. It is read from settings inside
the lazy client constructor and never logged, never returned, never echoed.

Per L7: transcripts persist as a single jsonb payload column.
Per L5: Supabase Realtime listens to Postgres Changes on jobs and transcripts;
this module's UPDATE is what triggers the WebSocket fan-out to subscribed
browsers. cloudflared is NOT in the data path.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

log = logging.getLogger(__name__)

_client: Any = None  # lazy singleton; constructed on first call


def get_supabase_client(settings: Any) -> Any:
    """Construct (and cache) the supabase-py client.

    Returns ``None`` if URL or service-role key is empty (allows mock-engine
    tests to drive the queue without Supabase).
    """
    global _client
    if _client is not None:
        return _client
    url = getattr(settings, "supabase_url", "") or ""
    key = getattr(settings, "supabase_service_role_key", "") or ""
    if not url or not key:
        return None
    try:
        from supabase import create_client

        _client = create_client(url, key)
    except Exception as e:
        # Log only the exception class name — never the settings object or key.
        log.error("supabase client init failed: %s", type(e).__name__)
        return None
    return _client


async def update_job(settings: Any, job_id: str, **fields: Any) -> None:
    """Write progress + completion fields to public.jobs (and on completion,
    to public.transcripts for SIGNED-IN users only — CORE-08/AUTH-09).

    Special keys consumed (popped from fields before the jobs UPDATE):
      - transcript_payload (jsonb)
      - user_id (str | None)         — claims["sub"] from the auth-required dep
      - is_anonymous (bool)          — claims["is_anonymous"]
      - title, source_filename, duration_sec, language, model_used, diarized
        — used as transcripts row fields when inserting

    CORE-08 boundary: anonymous transcripts NEVER write to public.transcripts;
    only jobs.transcript_payload. Signed-in completions write to both.

    [Cited: 04-PATTERNS.md progress.py update; CORE-08 boundary;
     04-RESEARCH.md "CORE-08/AUTH-09 Enforcement"]
    """
    client = get_supabase_client(settings)
    if client is None:
        log.debug("update_job: no Supabase client; skipping (job_id=%s)", job_id)
        return

    payload = fields.pop("transcript_payload", None)
    user_id = fields.pop("user_id", None)
    is_anonymous = bool(fields.pop("is_anonymous", False))
    # Pop transcripts-only fields so they don't accidentally land on jobs.
    transcripts_meta = {
        k: fields.pop(k, None)
        for k in (
            "title",
            "source_filename",
            "duration_sec",
            "language",
            "model_used",
            "diarized",
        )
    }

    # CORE-08 / AUTH-09: only signed-in (non-anonymous) jobs persist a
    # row to public.transcripts. Anonymous jobs keep payload in
    # jobs.transcript_payload only (already handled by Phase 2).
    if payload is not None and user_id and not is_anonymous:
        try:
            transcript_id = str(uuid.uuid4())
            client.table("transcripts").insert(
                {
                    "id": transcript_id,
                    "user_id": user_id,
                    "payload": payload,
                    **{k: v for k, v in transcripts_meta.items() if v is not None},
                }
            ).execute()
            fields["transcript_id"] = transcript_id
        except Exception as e:
            # supabase-py wraps PostgREST errors in APIError with `code` and
            # `message` attrs. The original log line printed only the class
            # name, which is why the user reported "APIError" without any
            # actionable detail (item line 28 of Things-to-change.txt).
            #
            # We now:
            #   1. Treat 23505 (unique_violation) as a benign retry no-op,
            #      mirroring insert_job_row — without it, a single replay of
            #      submit_from_upload spams the log on every retry.
            #   2. Log the PostgREST `code` and a sanitized `message` so the
            #      next failure mode is diagnosable. `message` is truncated
            #      to 120 chars because it can echo a partial row payload
            #      (no PII expected in our schema, but the truncation keeps
            #      logs bounded if that ever changes).
            code = getattr(e, "code", None)
            if code is None:
                # Some supabase-py error variants stash code inside args[0].
                first = getattr(e, "args", [None])[0]
                if hasattr(first, "get"):
                    code = first.get("code")
            if code == "23505":
                log.debug(
                    "transcripts insert: duplicate for job %s; skipping",
                    job_id,
                )
            else:
                msg = getattr(e, "message", None) or str(e)
                if isinstance(msg, str) and len(msg) > 120:
                    msg = msg[:117] + "..."
                log.error(
                    "transcripts insert failed for job %s: %s (code=%s, msg=%s)",
                    job_id,
                    type(e).__name__,
                    code,
                    msg,
                )

    # Always write the payload to jobs.transcript_payload (anon retention
    # window + Realtime broadcast both depend on it being present).
    if payload is not None:
        fields["transcript_payload"] = payload

    if fields:
        try:
            client.table("jobs").update(fields).eq("id", job_id).execute()
        except Exception as e:
            log.error("jobs update failed for %s: %s", job_id, type(e).__name__)


async def insert_job_row(
    settings: Any,
    job_id: str,
    *,
    source_filename: str,
    user_id: str | None = None,
    options: dict[str, Any] | None = None,
    anon_token: str | None = None,
) -> None:
    """INSERT the seed row in public.jobs at submit time.

    Without this, every subsequent ``update_job(...)`` is an UPDATE on a row
    that does not exist — supabase-py reports 0 rows affected and raises
    nothing, so the entire pipeline runs and the transcript_payload is
    silently discarded. (Phase 2↔4 boundary bug found 2026-04-30.)

    Tolerates 23505 (unique_violation) as a no-op so that legitimate retries
    of ``submit_from_upload`` don't crash the queue. All other exceptions are
    logged but never raised — matching the ``update_job`` non-fatal contract.
    """
    client = get_supabase_client(settings)
    if client is None:
        log.debug("insert_job_row: no Supabase client; skipping (job_id=%s)", job_id)
        return

    row: dict[str, Any] = {
        "id": job_id,
        "source_filename": source_filename or "upload",
        "options": options or {},
        "status": "queued",
        "stage": "queued",
        "progress": 0,
    }
    if user_id is not None:
        row["user_id"] = user_id
    if anon_token is not None:
        row["anon_token"] = anon_token

    try:
        client.table("jobs").insert(row).execute()
    except Exception as e:
        # supabase-py wraps PostgREST errors in APIError with a `code` attr.
        # 23505 = unique_violation (job_id already inserted by an earlier
        # retry / replay). That's a benign no-op; everything else is logged.
        code = getattr(e, "code", None) or getattr(
            getattr(e, "args", [None])[0], "get", lambda *_: None
        )("code")
        if code == "23505":
            log.debug("insert_job_row: row already exists for %s (no-op)", job_id)
            return
        log.error("jobs insert failed for %s: %s", job_id, type(e).__name__)


def reset_client_for_tests() -> None:
    """Test hook — clear the lazy singleton between tests so monkeypatch works."""
    global _client
    _client = None
