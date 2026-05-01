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


# ─── Quick task 260501-1e4 Task 10 — transcripts insert error handling ────────


def _fake_supabase_with_transcript_error(error: Exception) -> object:
    """Build a stand-in supabase client whose .table('transcripts').insert(...).execute()
    raises the supplied error. .table('jobs') is also mocked so the second update
    in update_job() doesn't blow up."""

    class _FakeReq:
        def insert(self, *_a, **_k):
            return self

        def update(self, *_a, **_k):
            return self

        def eq(self, *_a, **_k):
            return self

        def execute(self):
            raise AssertionError(  # pragma: no cover — unreachable
                "test should not reach a generic execute()"
            )

    class _Transcripts(_FakeReq):
        def execute(self):
            raise error

    class _Jobs(_FakeReq):
        def execute(self):
            return None  # success — exercises the post-error jobs UPDATE path

    class _Client:
        def table(self, name: str):
            return _Transcripts() if name == "transcripts" else _Jobs()

    return _Client()


class _ListHandler:
    """Minimal logging.Handler stand-in that just appends emitted records.
    pytest-asyncio + caplog don't always agree about logger propagation in
    this codebase's pyproject (uvicorn config swaps the root handlers); the
    direct attach here is a more reliable contract."""

    def __init__(self) -> None:
        import logging as _logging

        self.level = _logging.DEBUG
        self.records: list = []

    def handle(self, record):
        self.records.append(record)

    def createLock(self):  # noqa: N802 — interface match for logging.Handler
        return None

    def acquire(self):
        pass

    def release(self):
        pass


async def test_transcripts_insert_unique_violation_is_silent_no_op(
    monkeypatch,
) -> None:
    """Item line 28 of Things-to-change.txt — transcripts insert errors used
    to log "APIError" with no detail on every retry. After the fix, 23505
    (unique_violation) is treated as a benign duplicate and logs at DEBUG."""
    reset_client_for_tests()

    class _APIError(Exception):
        code = "23505"
        message = "duplicate key value violates unique constraint"

    settings = SimpleNamespace(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="key",
    )
    monkeypatch.setattr(
        progress_mod,
        "get_supabase_client",
        lambda _settings: _fake_supabase_with_transcript_error(_APIError()),
    )
    handler = _ListHandler()
    progress_mod.log.addHandler(handler)
    try:
        await update_job(
            settings,
            "job-dup",
            status="succeeded",
            stage="done",
            user_id="user-1",
            is_anonymous=False,
            transcript_payload={"version": 1, "segments": []},
        )
    finally:
        progress_mod.log.removeHandler(handler)
    # No ERROR-level record about transcripts insert; the duplicate fires
    # a DEBUG record only.
    err_records = [r for r in handler.records if r.levelname == "ERROR"]
    assert all("transcripts insert failed" not in r.getMessage() for r in err_records)


async def test_transcripts_insert_other_error_logs_code_and_truncated_message(
    monkeypatch,
) -> None:
    """When PostgREST returns a code the worker does not handle silently, the
    log line MUST expose `code` + a truncated `message` so the next failure is
    diagnosable (item line 28 — the original log only printed the class name)."""
    reset_client_for_tests()

    class _APIError(Exception):
        code = "42501"  # insufficient_privilege
        message = "x" * 200  # long message to exercise truncation

    settings = SimpleNamespace(
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="key",
    )
    monkeypatch.setattr(
        progress_mod,
        "get_supabase_client",
        lambda _settings: _fake_supabase_with_transcript_error(_APIError()),
    )
    handler = _ListHandler()
    progress_mod.log.addHandler(handler)
    try:
        await update_job(
            settings,
            "job-perm",
            status="succeeded",
            stage="done",
            user_id="user-1",
            is_anonymous=False,
            transcript_payload={"version": 1, "segments": []},
        )
    finally:
        progress_mod.log.removeHandler(handler)
    matches = [r for r in handler.records if "transcripts insert failed" in r.getMessage()]
    assert matches, "expected an ERROR log from transcripts insert path"
    msg = matches[0].getMessage()
    assert "code=42501" in msg
    # Truncated to 117 chars + "...":
    assert "..." in msg
    # And not the full 200-char message:
    assert "x" * 200 not in msg
