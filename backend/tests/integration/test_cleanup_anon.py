"""Phase 4 D-05 anon cleanup tests (no GPU required)."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock, patch

import pytest


class _FakeSettings:
    supabase_url = "https://t.supabase.co"
    supabase_service_role_key = "service-role-test"


@pytest.mark.asyncio
async def test_run_once_calls_rpc_with_ttl_24() -> None:
    from app.queue import cleanup as cleanup_mod

    fake_client = MagicMock()
    fake_client.rpc.return_value.execute.return_value.data = 7
    with patch.object(cleanup_mod, "get_supabase_client", return_value=fake_client):
        deleted = await cleanup_mod._run_once(_FakeSettings())
    assert deleted == 7
    fake_client.rpc.assert_called_once_with(
        "cleanup_anon_jobs", {"ttl_hours": 24}
    )


@pytest.mark.asyncio
async def test_run_once_returns_0_on_no_client() -> None:
    from app.queue import cleanup as cleanup_mod
    with patch.object(cleanup_mod, "get_supabase_client", return_value=None):
        deleted = await cleanup_mod._run_once(_FakeSettings())
    assert deleted == 0


@pytest.mark.asyncio
async def test_run_once_swallows_rpc_failure() -> None:
    from app.queue import cleanup as cleanup_mod
    fake_client = MagicMock()
    fake_client.rpc.return_value.execute.side_effect = RuntimeError("boom")
    with patch.object(cleanup_mod, "get_supabase_client", return_value=fake_client):
        deleted = await cleanup_mod._run_once(_FakeSettings())
    assert deleted == 0   # warning logged, no exception


@pytest.mark.asyncio
async def test_loop_cancellable() -> None:
    from app.queue import cleanup as cleanup_mod

    # Patch sleep so the test runs fast.
    with patch.object(cleanup_mod, "CLEANUP_INTERVAL_SEC", 0.01):
        with patch.object(cleanup_mod, "_run_once", return_value=0):
            task = asyncio.create_task(
                cleanup_mod.cleanup_anon_jobs_loop(_FakeSettings())
            )
            await asyncio.sleep(0.05)   # let it run a few iterations
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
