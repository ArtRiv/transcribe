from __future__ import annotations
from unittest.mock import MagicMock, patch

import pytest


class _FakeSettings:
    supabase_url = "https://t.supabase.co"
    supabase_service_role_key = "service-role-test"


def _fake_client():
    c = MagicMock()
    c.table.return_value.insert.return_value.execute.return_value.data = []
    c.table.return_value.update.return_value.eq.return_value.execute.return_value.data = []
    return c


@pytest.mark.asyncio
async def test_signed_in_completion_inserts_transcripts() -> None:
    from app.queue import progress as p
    client = _fake_client()
    with patch.object(p, "get_supabase_client", return_value=client):
        await p.update_job(
            _FakeSettings(), "job-1",
            transcript_payload={"segments": []},
            user_id="signed-in-uuid",
            is_anonymous=False,
            title="My file", source_filename="x.wav", duration_sec=30,
            status="succeeded",
        )
    # Asserted: transcripts.insert called once
    insert_calls = [c for c in client.table.call_args_list if c.args == ("transcripts",)]
    assert len(insert_calls) == 1


@pytest.mark.asyncio
async def test_anon_completion_does_NOT_insert_transcripts() -> None:
    from app.queue import progress as p
    client = _fake_client()
    with patch.object(p, "get_supabase_client", return_value=client):
        await p.update_job(
            _FakeSettings(), "job-2",
            transcript_payload={"segments": []},
            user_id="anon-uuid",
            is_anonymous=True,    # <— CORE-08 boundary
            status="succeeded",
        )
    insert_calls = [c for c in client.table.call_args_list if c.args == ("transcripts",)]
    assert len(insert_calls) == 0


@pytest.mark.asyncio
async def test_no_user_id_does_NOT_insert_transcripts() -> None:
    from app.queue import progress as p
    client = _fake_client()
    with patch.object(p, "get_supabase_client", return_value=client):
        await p.update_job(
            _FakeSettings(), "job-3",
            transcript_payload={"segments": []},
            # user_id missing entirely
            status="succeeded",
        )
    insert_calls = [c for c in client.table.call_args_list if c.args == ("transcripts",)]
    assert len(insert_calls) == 0


@pytest.mark.asyncio
async def test_progress_only_update_does_not_insert() -> None:
    from app.queue import progress as p
    client = _fake_client()
    with patch.object(p, "get_supabase_client", return_value=client):
        await p.update_job(
            _FakeSettings(), "job-4",
            stage="transcribing", progress=42,   # no payload
        )
    insert_calls = [c for c in client.table.call_args_list if c.args == ("transcripts",)]
    assert len(insert_calls) == 0
    # Asserted: jobs update called
    update_calls = [c for c in client.table.call_args_list if c.args == ("jobs",)]
    assert len(update_calls) == 1
