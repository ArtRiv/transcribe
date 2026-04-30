"""Phase 4 D-05: 24-hour TTL cleanup for anonymous jobs.

Started as a lifespan-managed background task in main.py.
Calls the SECURITY DEFINER RPC public.cleanup_anon_jobs(24) every hour.

[Cited: 04-RESEARCH.md §Pattern 8; 04-PATTERNS.md cleanup.py row;
 Assumption A4 — anon-sign-in pivot makes user_id IS NULL incorrect]
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.queue.progress import get_supabase_client

log = logging.getLogger(__name__)

CLEANUP_INTERVAL_SEC = 60 * 60  # 1 hour
ANON_TTL_HOURS = 24


async def cleanup_anon_jobs_loop(settings: Any) -> None:
    """Periodic cleanup. Runs forever until cancelled by lifespan shutdown.

    Catches all exceptions per iteration so a transient Supabase outage
    doesn't crash the task; the next iteration retries.
    """
    log.info(
        "anon cleanup loop starting (interval=%ds, ttl=%dh)",
        CLEANUP_INTERVAL_SEC, ANON_TTL_HOURS,
    )
    try:
        while True:
            await _run_once(settings)
            await asyncio.sleep(CLEANUP_INTERVAL_SEC)
    except asyncio.CancelledError:
        log.info("anon cleanup loop cancelled by lifespan shutdown")
        raise


async def _run_once(settings: Any) -> int:
    """One iteration. Returns rows deleted (0 if client unavailable)."""
    client = get_supabase_client(settings)
    if client is None:
        log.debug("anon cleanup: no Supabase client; skipping")
        return 0
    try:
        # supabase-py rpc returns a Response object; we run it in a thread
        # to avoid blocking the event loop for I/O-bound httpx calls.
        result = await asyncio.to_thread(
            lambda: client.rpc(
                "cleanup_anon_jobs", {"ttl_hours": ANON_TTL_HOURS}
            ).execute()
        )
        deleted = int(getattr(result, "data", 0) or 0)
        if deleted:
            log.info("anon cleanup deleted %d row(s)", deleted)
        return deleted
    except Exception as e:  # defensive — any supabase or network error
        log.warning("anon cleanup iteration failed: %s", type(e).__name__)
        return 0
