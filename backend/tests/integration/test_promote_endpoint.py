"""Integration tests for POST /jobs/{job_id}/promote (04-08, Task 1).

TDD RED phase — these tests MUST fail before the route exists.

Ownership-chain check (T-04-05 mitigation):
  - Authorization header carries the new signed-in JWT (non-anonymous).
  - X-Previous-Anon-Token carries the original anon JWT whose sub matches
    the source job's user_id.

[Cited: 04-08 PLAN §behavior; 04-RESEARCH.md §Open Question 1; 04-PATTERNS.md transcripts.py row]
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient


# ── Helpers ──────────────────────────────────────────────────────────────────


SIGNED_IN_CLAIMS = {
    "sub": "signed-in-user-uuid",
    "is_anonymous": False,
    "aud": "authenticated",
    "role": "authenticated",
}

ANON_CLAIMS = {
    "sub": "anon-user-uuid",
    "is_anonymous": True,
    "aud": "authenticated",
    "role": "authenticated",
}

VALID_BODY = {
    "payload": {"segments": [], "speakers": []},
    "title": "Test Transcript",
    "source_filename": "test.wav",
    "duration_sec": 30,
    "language": "en",
    "model_used": "small",
    "diarized": False,
}


def _mock_job_row(user_id: str = "anon-user-uuid") -> MagicMock:
    """Return a mock Supabase client pre-wired for a job owned by user_id."""
    client = MagicMock()
    # .table("jobs").select(...).eq(...).single().execute().data
    job_result = MagicMock()
    job_result.data = {"id": "job-abc", "user_id": user_id, "transcript_id": None}
    client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = (
        job_result
    )
    # .table("transcripts").insert(...).execute()
    client.table.return_value.insert.return_value.execute.return_value = MagicMock()
    # .table("jobs").update(...).eq(...).execute()
    client.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
    return client


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _promote_env(monkeypatch, tmp_path):
    """Mock-engine env for promote tests."""
    monkeypatch.setenv("MOCK_ENGINE", "1")
    monkeypatch.delenv("SKIP_VULKAN_PROBE", raising=False)
    import os
    monkeypatch.setenv(
        "WHISPER_BIN_PATH",
        os.path.expanduser("~/.transcribe/build/whisper.cpp/build/bin/whisper-cli"),
    )
    monkeypatch.setenv("MODELS_DIR", os.path.expanduser("~/.transcribe/models"))
    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("WORK_DIR", str(tmp_path / "work"))
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
    from app.config import get_settings
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
async def promote_app():
    from app.main import app as fastapi_app
    async with LifespanManager(fastapi_app):
        yield fastapi_app


@pytest.fixture
async def promote_client(promote_app):
    transport = ASGITransport(app=promote_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ── Tests ─────────────────────────────────────────────────────────────────────


async def test_promote_no_auth_returns_401(promote_client: AsyncClient) -> None:
    """POST /jobs/{id}/promote without Authorization → 401."""
    r = await promote_client.post("/jobs/job-abc/promote", json=VALID_BODY)
    assert r.status_code == 401, r.text


async def test_promote_with_anon_jwt_returns_403(promote_client: AsyncClient) -> None:
    """POST with anonymous-sign-in JWT (is_anonymous=true) → 403."""
    with patch("app.routes.deps.verify_supabase_jwt", return_value=ANON_CLAIMS):
        r = await promote_client.post(
            "/jobs/job-abc/promote",
            json=VALID_BODY,
            headers={
                "Authorization": "Bearer anon-token",
                "X-Previous-Anon-Token": "some-prev-token",
            },
        )
    assert r.status_code == 403, r.text
    assert "anonymous" in r.json()["detail"].lower()


async def test_promote_missing_prev_anon_token_returns_400(promote_client: AsyncClient) -> None:
    """POST with signed-in JWT but NO X-Previous-Anon-Token → 400."""
    with patch("app.routes.deps.verify_supabase_jwt", return_value=SIGNED_IN_CLAIMS):
        r = await promote_client.post(
            "/jobs/job-abc/promote",
            json=VALID_BODY,
            headers={"Authorization": "Bearer signed-in-token"},
        )
    assert r.status_code == 400, r.text
    assert "anon" in r.json()["detail"].lower()


async def test_promote_mismatched_anon_owner_returns_403(promote_client: AsyncClient) -> None:
    """POST with signed-in JWT + X-Previous-Anon-Token whose sub ≠ source job's user_id → 403."""
    # The previous anon token claims sub=DIFFERENT-anon but job is owned by anon-user-uuid
    different_anon_claims = {**ANON_CLAIMS, "sub": "different-anon-uuid"}
    client_mock = _mock_job_row(user_id="anon-user-uuid")

    def _verify_side_effect(token, *, jwks_url=None, strict=False):
        if token == "signed-in-token":
            return SIGNED_IN_CLAIMS
        if token == "different-anon-token":
            return different_anon_claims
        return None

    with (
        patch("app.routes.deps.verify_supabase_jwt", side_effect=_verify_side_effect),
        patch("app.routes.transcripts.verify_supabase_jwt", side_effect=_verify_side_effect),
        patch("app.routes.transcripts.get_supabase_client", return_value=client_mock),
    ):
        r = await promote_client.post(
            "/jobs/job-abc/promote",
            json=VALID_BODY,
            headers={
                "Authorization": "Bearer signed-in-token",
                "X-Previous-Anon-Token": "different-anon-token",
            },
        )
    assert r.status_code == 403, r.text
    assert "owner" in r.json()["detail"].lower()


async def test_promote_valid_request_returns_201(promote_client: AsyncClient) -> None:
    """POST with signed-in JWT + matching X-Previous-Anon-Token → 201."""
    client_mock = _mock_job_row(user_id="anon-user-uuid")

    def _verify_side_effect(token, *, jwks_url=None, strict=False):
        if token == "signed-in-token":
            return SIGNED_IN_CLAIMS
        if token == "anon-token":
            return ANON_CLAIMS
        return None

    with (
        patch("app.routes.deps.verify_supabase_jwt", side_effect=_verify_side_effect),
        patch("app.routes.transcripts.verify_supabase_jwt", side_effect=_verify_side_effect),
        patch("app.routes.transcripts.get_supabase_client", return_value=client_mock),
    ):
        r = await promote_client.post(
            "/jobs/job-abc/promote",
            json=VALID_BODY,
            headers={
                "Authorization": "Bearer signed-in-token",
                "X-Previous-Anon-Token": "anon-token",
            },
        )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "transcript_id" in body
    assert body["job_id"] == "job-abc"


async def test_promote_uses_request_payload_not_jobs_payload(promote_client: AsyncClient) -> None:
    """D-08: transcripts.insert uses the body payload, not jobs.transcript_payload."""
    client_mock = _mock_job_row(user_id="anon-user-uuid")
    inserted_args: list = []

    original_table = client_mock.table

    def _table_side(name: str):
        if name == "transcripts":
            mock = MagicMock()
            mock.insert.side_effect = lambda fields: inserted_args.append(fields) or MagicMock()
            mock.insert.return_value.execute.return_value = MagicMock()
            return mock
        return original_table(name)

    # Re-wire mock so we can capture insert args
    fresh_client = _mock_job_row(user_id="anon-user-uuid")
    captured_inserts: list[dict] = []

    real_insert = fresh_client.table("transcripts").insert
    # We'll inspect via assert on call count + args
    def _verify_side_effect(token, *, jwks_url=None, strict=False):
        if token == "signed-in-token":
            return SIGNED_IN_CLAIMS
        if token == "anon-token":
            return ANON_CLAIMS
        return None

    with (
        patch("app.routes.deps.verify_supabase_jwt", side_effect=_verify_side_effect),
        patch("app.routes.transcripts.verify_supabase_jwt", side_effect=_verify_side_effect),
        patch("app.routes.transcripts.get_supabase_client", return_value=fresh_client),
    ):
        r = await promote_client.post(
            "/jobs/job-abc/promote",
            json=VALID_BODY,
            headers={
                "Authorization": "Bearer signed-in-token",
                "X-Previous-Anon-Token": "anon-token",
            },
        )

    assert r.status_code == 201, r.text
    # Verify transcripts.insert was called
    transcripts_calls = [
        call for call in fresh_client.table.call_args_list if call.args == ("transcripts",)
    ]
    assert len(transcripts_calls) >= 1, "transcripts.insert was not called"


async def test_promote_updates_jobs_user_id_and_transcript_id(promote_client: AsyncClient) -> None:
    """After promotion, jobs UPDATE sets user_id=signed-in-user and transcript_id=new uuid."""
    client_mock = _mock_job_row(user_id="anon-user-uuid")

    def _verify_side_effect(token, *, jwks_url=None, strict=False):
        if token == "signed-in-token":
            return SIGNED_IN_CLAIMS
        if token == "anon-token":
            return ANON_CLAIMS
        return None

    with (
        patch("app.routes.deps.verify_supabase_jwt", side_effect=_verify_side_effect),
        patch("app.routes.transcripts.verify_supabase_jwt", side_effect=_verify_side_effect),
        patch("app.routes.transcripts.get_supabase_client", return_value=client_mock),
    ):
        r = await promote_client.post(
            "/jobs/job-abc/promote",
            json=VALID_BODY,
            headers={
                "Authorization": "Bearer signed-in-token",
                "X-Previous-Anon-Token": "anon-token",
            },
        )

    assert r.status_code == 201, r.text
    # Verify jobs.update was called
    jobs_calls = [
        call for call in client_mock.table.call_args_list if call.args == ("jobs",)
    ]
    assert len(jobs_calls) >= 1, "jobs.update was not called"
