"""Unit tests for app.queue.progress.insert_job_row.

Companion to test_queue_progress.py. Covers the seed-INSERT path added to
fix the Phase 2↔4 boundary bug where update_job calls were silently no-ops
because the row didn't exist (quick task 260430-kxc).
"""

from __future__ import annotations

import io
import logging
from types import SimpleNamespace
from typing import Any

import pytest

import app.queue.progress as progress_mod
from app.queue.progress import insert_job_row, reset_client_for_tests


@pytest.fixture
def progress_log_capture():
    """Attach a stream handler directly to the `app.queue.progress` logger.

    Required because app.main configures `app` loggers with `propagate=False`
    + a stderr StreamHandler whose stream is bound at module-load time, so
    neither caplog nor capsys/capfd reliably observe records from this
    namespace under pytest's capture machinery.
    """
    buf = io.StringIO()
    handler = logging.StreamHandler(buf)
    handler.setLevel(logging.DEBUG)
    logger = logging.getLogger("app.queue.progress")
    prior_level = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    try:
        yield buf
    finally:
        logger.removeHandler(handler)
        logger.setLevel(prior_level)


class _FakeAPIError(Exception):
    """Mimics supabase-py's APIError-with-code shape."""

    def __init__(self, code: str) -> None:
        super().__init__({"code": code})
        self.code = code


class _FakeExecute:
    def __init__(self, raise_with: Exception | None = None) -> None:
        self._raise_with = raise_with
        self.called_with: dict[str, Any] | None = None

    def execute(self) -> Any:
        if self._raise_with is not None:
            raise self._raise_with
        return SimpleNamespace(data=[{"id": "ok"}])


class _FakeTable:
    def __init__(self, raise_with: Exception | None = None) -> None:
        self.last_insert: dict[str, Any] | None = None
        self._raise_with = raise_with

    def insert(self, row: dict[str, Any]) -> _FakeExecute:
        self.last_insert = row
        return _FakeExecute(raise_with=self._raise_with)


class _FakeClient:
    def __init__(self, raise_with: Exception | None = None) -> None:
        self._table = _FakeTable(raise_with=raise_with)

    def table(self, name: str) -> _FakeTable:
        assert name == "jobs", f"insert_job_row should only touch jobs (got {name!r})"
        return self._table


def _install_fake_client(monkeypatch, fake: _FakeClient) -> None:
    reset_client_for_tests()
    # Stamp the module-level lazy singleton directly so get_supabase_client
    # returns our fake without needing real Supabase env.
    monkeypatch.setattr(progress_mod, "_client", fake, raising=False)


# ── Happy path ──────────────────────────────────────────────────────────────


async def test_insert_job_row_writes_required_fields(monkeypatch) -> None:
    fake = _FakeClient()
    _install_fake_client(monkeypatch, fake)

    settings = SimpleNamespace(supabase_url="x", supabase_service_role_key="y")
    await insert_job_row(
        settings,
        "00000000-0000-0000-0000-000000000001",
        source_filename="meeting.mp3",
        user_id="user-uuid",
        options={"preset": "average", "diarize": True},
        anon_token="tok-abc",
    )

    row = fake._table.last_insert
    assert row is not None
    assert row["id"] == "00000000-0000-0000-0000-000000000001"
    assert row["source_filename"] == "meeting.mp3"
    assert row["user_id"] == "user-uuid"
    assert row["options"] == {"preset": "average", "diarize": True}
    assert row["anon_token"] == "tok-abc"
    assert row["status"] == "queued"
    assert row["stage"] == "queued"
    assert row["progress"] == 0


async def test_insert_job_row_omits_optional_keys_when_none(monkeypatch) -> None:
    """user_id and anon_token are nullable — leave them out so Supabase uses
    the column defaults rather than receiving an explicit null we set."""
    fake = _FakeClient()
    _install_fake_client(monkeypatch, fake)

    settings = SimpleNamespace(supabase_url="x", supabase_service_role_key="y")
    await insert_job_row(
        settings,
        "00000000-0000-0000-0000-000000000002",
        source_filename="upload",
    )

    row = fake._table.last_insert
    assert row is not None
    assert "user_id" not in row
    assert "anon_token" not in row
    assert row["options"] == {}


# ── No-Supabase no-op path ──────────────────────────────────────────────────


async def test_insert_job_row_noop_when_unconfigured(monkeypatch) -> None:
    reset_client_for_tests()
    settings = SimpleNamespace(supabase_url="", supabase_service_role_key="")
    # Should not raise even with no client configured (mock-engine path).
    await insert_job_row(
        settings,
        "00000000-0000-0000-0000-000000000003",
        source_filename="upload",
    )


# ── Error tolerance ─────────────────────────────────────────────────────────


async def test_insert_job_row_treats_23505_as_noop(
    monkeypatch,
    progress_log_capture,
) -> None:
    """unique_violation = legitimate retry; must not raise and must not log ERROR."""
    fake = _FakeClient(raise_with=_FakeAPIError(code="23505"))
    _install_fake_client(monkeypatch, fake)

    settings = SimpleNamespace(supabase_url="x", supabase_service_role_key="y")
    await insert_job_row(
        settings,
        "00000000-0000-0000-0000-000000000004",
        source_filename="upload",
    )

    out = progress_log_capture.getvalue()
    assert "jobs insert failed" not in out


async def test_insert_job_row_logs_other_exceptions_without_raising(
    monkeypatch,
    progress_log_capture,
) -> None:
    """Network / schema / RLS errors must be logged but never crash the worker."""
    fake = _FakeClient(raise_with=_FakeAPIError(code="42P01"))  # undefined_table
    _install_fake_client(monkeypatch, fake)

    settings = SimpleNamespace(supabase_url="x", supabase_service_role_key="y")
    await insert_job_row(
        settings,
        "00000000-0000-0000-0000-000000000005",
        source_filename="upload",
    )

    out = progress_log_capture.getvalue()
    assert "jobs insert failed" in out
    assert "_FakeAPIError" in out
