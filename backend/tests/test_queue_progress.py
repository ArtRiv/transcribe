"""Unit tests for app.queue.progress (L5 + L8 invariants).

Covers the no-op-when-not-configured contract that lets mock-engine tests
drive the queue without Supabase, and asserts the SEC perimeter sentinel
that the service-role key is never echoed via logging or formatting.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace

import app.queue.progress as progress_mod
from app.queue.progress import (
    get_supabase_client,
    reset_client_for_tests,
    update_job,
)


async def test_get_supabase_client_returns_none_when_url_empty() -> None:
    reset_client_for_tests()
    settings = SimpleNamespace(supabase_url="", supabase_service_role_key="key")
    assert get_supabase_client(settings) is None


async def test_get_supabase_client_returns_none_when_key_empty() -> None:
    reset_client_for_tests()
    settings = SimpleNamespace(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="",
    )
    assert get_supabase_client(settings) is None


async def test_update_job_is_noop_when_unconfigured() -> None:
    reset_client_for_tests()
    settings = SimpleNamespace(supabase_url="", supabase_service_role_key="")
    # Should not raise — the no-op return is what makes mock-engine tests work.
    await update_job(settings, "job-id-noop", status="running", stage="extracting")


async def test_update_job_is_noop_with_payload_when_unconfigured() -> None:
    """Even with a transcript_payload, no-op when Supabase is unset."""
    reset_client_for_tests()
    settings = SimpleNamespace(supabase_url="", supabase_service_role_key="")
    await update_job(
        settings,
        "job-id-noop-payload",
        status="succeeded",
        stage="done",
        transcript_payload={"version": 1, "segments": []},
    )


def test_sec_perimeter_no_settings_logging() -> None:
    """L8 sentinel: progress.py source must NEVER format/log the settings object
    in a way that could leak the service-role key.
    """
    src = inspect.getsource(progress_mod)
    forbidden = [
        "log.info(settings",
        "log.debug(settings",
        "log.error(settings)",
        "log.warning(settings",
        "print(settings",
        "repr(settings)",
        'f"{settings.supabase',
    ]
    for f in forbidden:
        assert f not in src, f"SEC perimeter violation: {f!r} in progress.py"


def test_update_job_is_async() -> None:
    """update_job must be a coroutine function — worker awaits it."""
    import asyncio

    assert asyncio.iscoroutinefunction(update_job)


def test_lazy_client_pattern_present() -> None:
    """The module must use a global lazy singleton — re-imports must not re-init."""
    src = inspect.getsource(progress_mod)
    assert "global _client" in src
    assert "if _client is not None" in src
