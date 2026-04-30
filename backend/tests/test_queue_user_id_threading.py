"""Quick task 260430-lr0 (gap A) — user_id/is_anonymous flow into Job.

JobManager.submit_from_upload constructs the Job dataclass from the
route's meta dict. Before this fix, user_id and is_anonymous never landed
on the Job, so the worker's update_job(...) carried None/False to
progress.py and the CORE-08/AUTH-09 transcripts-INSERT gate
short-circuited for every signed-in completion.

Direct contract test: drive submit_from_upload with a meta dict, assert
the resulting Job has the expected identity. Doesn't run the worker —
that's covered by the existing test_queue.py end-to-end suite.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest

from app.queue import manager as manager_mod
from app.queue import progress as progress_mod


@pytest.fixture(autouse=True)
def _isolate_supabase(monkeypatch):
    """No Supabase calls during this contract test — insert_job_row + update_job
    both must be no-ops. Patching the helpers directly keeps the focus on the
    Job-construction contract.
    """

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr("app.queue.manager.insert_job_row", _noop)
    monkeypatch.setattr("app.queue.manager.update_job", _noop)
    monkeypatch.setenv("MOCK_ENGINE", "1")
    monkeypatch.setenv(
        "WHISPER_BIN_PATH",
        os.path.expanduser("~/.transcribe/build/whisper.cpp/build/bin/whisper-cli"),
    )
    monkeypatch.setenv("MODELS_DIR", os.path.expanduser("~/.transcribe/models"))
    monkeypatch.setenv("ENABLE_SLOW_PRESET", "false")
    from app.config import get_settings

    get_settings.cache_clear()
    progress_mod.reset_client_for_tests()
    yield
    get_settings.cache_clear()


def _build_manager() -> manager_mod.JobManager:
    """Construct a JobManager with a duck-typed app_state.

    Mirrors the lifespan's call shape; ``settings`` is the only attr the
    construction touches (via ``available_presets`` reading the slow flag).
    """
    from app.config import get_settings

    state = type(
        "S",
        (),
        {"settings": get_settings()},
    )()
    return manager_mod.JobManager(state)


async def _submit(mgr: manager_mod.JobManager, job_id: str, meta: dict) -> str:
    return await mgr.submit_from_upload(
        job_id=job_id,
        work_path=Path("/tmp/does-not-exist.mp3"),
        meta=meta,
    )


def test_signed_in_user_id_threaded_onto_job() -> None:
    mgr = _build_manager()
    job_id = "00000000-0000-0000-0000-000000000001"
    meta = {
        "filename": "demo.mp3",
        "options": {"preset": "fast"},
        "user_id": "user-uuid-signed-in",
        "is_anonymous": False,
    }
    asyncio.run(_submit(mgr, job_id, meta))
    job = mgr.jobs[job_id]
    assert job.user_id == "user-uuid-signed-in"
    assert job.is_anonymous is False


def test_anon_user_id_threaded_onto_job() -> None:
    """Anonymous-sign-in still has a sub claim — it just rides
    is_anonymous=True so the transcripts INSERT stays gated off.
    """
    mgr = _build_manager()
    job_id = "00000000-0000-0000-0000-000000000002"
    meta = {
        "filename": "demo.mp3",
        "options": {"preset": "fast"},
        "user_id": "user-uuid-anon",
        "is_anonymous": True,
    }
    asyncio.run(_submit(mgr, job_id, meta))
    job = mgr.jobs[job_id]
    assert job.user_id == "user-uuid-anon"
    assert job.is_anonymous is True


def test_missing_identity_falls_back_to_defaults() -> None:
    """Internal callers (no auth context) still work — defaults match the
    pre-fix behaviour so existing tests + smoke paths don't regress.
    """
    mgr = _build_manager()
    job_id = "00000000-0000-0000-0000-000000000003"
    meta = {"filename": "demo.mp3", "options": {"preset": "fast"}}
    asyncio.run(_submit(mgr, job_id, meta))
    job = mgr.jobs[job_id]
    assert job.user_id is None
    assert job.is_anonymous is False
