"""Shared client-id helper for routes that accept an optional client-supplied
job_id (POST /jobs and POST /uploads).

The frontend generates UUID v7 (`frontend/lib/job/id.ts`) and uses it as both
the row's primary key in `public.jobs` AND the filter for its Realtime
subscription. Without honouring the client value the backend creates the row
under a fresh server-side UUID and the frontend's subscription waits forever
on an id that nothing ever updates.

[Cited: .planning/phases/03-frontend-skeleton/03-RESEARCH.md:960 — Phase 4
 wiring contract; quick task 260430-lfu]
"""

from __future__ import annotations

import uuid

from fastapi import HTTPException


def coerce_job_id(value: str | None) -> str:
    """Return a canonical UUID string for ``value`` or generate a fresh one.

    Behaviour:
      * ``None`` or empty string → ``str(uuid.uuid4())`` (server fallback).
      * Anything that parses as ``uuid.UUID`` → its canonical string form
        (lowercase, dash-separated). UUID v7 is accepted unchanged.
      * Anything else → HTTP 400 — refuses path-traversal-shaped strings or
        accidental client serialisation bugs from leaking into work_dir
        filenames or Supabase primary keys.
    """
    if value is None or value == "":
        return str(uuid.uuid4())
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError) as e:
        # ValueError: malformed string. AttributeError/TypeError: caller passed
        # a non-string (e.g., int, dict) — possible at framework boundaries
        # where Form() coercion could be sidestepped.
        raise HTTPException(
            status_code=400,
            detail="invalid job_id; expected UUID",
        ) from e
