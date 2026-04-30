"""Pytest fixtures: ASGI lifespan + httpx AsyncClient.

Pattern source: 01-RESEARCH.md "Validation Architecture".

These fixtures make it trivial for Phase 2 onward to add tests like:

    async def test_jobs_post_enqueues(client):
        r = await client.post("/jobs", json={...})
        assert r.status_code == 202

without each test having to wire up its own lifespan + transport.
"""

import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.main import app as fastapi_app


@pytest.fixture(autouse=True)
def _default_mock_engine(monkeypatch):
    """Default every test to ``MOCK_ENGINE=1`` + ``SKIP_VULKAN_PROBE=1`` unless
    the test explicitly opts in to the real probe.

    Phase 2 (plan 02-05) made the lifespan run a real Vulkan probe via
    ``probe_vulkan_or_die``. Without ``WHISPER_BIN_PATH`` + a GGML model on
    disk the probe raises (correct production behaviour) which would break
    the Phase-1 health tests that just want to confirm /healthz still
    returns 200.

    The two flags do orthogonal things:
      * ``MOCK_ENGINE=1`` — replaces ``transcribe`` + ``diarize`` with stubs
        (matches the existing ``mock_engine`` autouse fixture below).
      * ``SKIP_VULKAN_PROBE=1`` — bypasses the GGML/Vulkan probe in the
        lifespan and advertises a sentinel device name on /readyz.

    Tests that NEED a real probe (e.g., ``test_routes_smoke.py``) explicitly
    monkeypatch ``WHISPER_BIN_PATH`` + ``MODELS_DIR`` and clear
    ``SKIP_VULKAN_PROBE`` so the lifespan exercises the host GPU.
    """
    if os.environ.get("MOCK_ENGINE") is None:
        monkeypatch.setenv("MOCK_ENGINE", "1")
    if os.environ.get("SKIP_VULKAN_PROBE") is None:
        monkeypatch.setenv("SKIP_VULKAN_PROBE", "1")
    yield


@pytest.fixture
async def lifespan_app() -> AsyncIterator[FastAPI]:
    """Yield a FastAPI app with its lifespan started; teardown shuts it down.

    NOTE: asgi-lifespan ≥2 wraps the app via `state_middleware`, so `manager.app`
    is a callable (not a FastAPI). We yield the original `fastapi_app` because
    its `.state` is the same object the lifespan startup populates, and tests
    that need to introspect state want the FastAPI instance, not the wrapper.
    """
    async with LifespanManager(fastapi_app):
        yield fastapi_app


@pytest.fixture
async def client(lifespan_app: FastAPI) -> AsyncIterator[AsyncClient]:
    """In-process httpx AsyncClient against the lifespan-managed app."""
    transport = ASGITransport(app=lifespan_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ── Phase 4 additions ─────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _mock_jwt_verify(monkeypatch):
    """Phase 4: bypass JWKS verification in MOCK_ENGINE tests by returning fixed claims.

    When MOCK_ENGINE=1 (the default for all non-GPU tests), patching
    ``verify_supabase_jwt`` means routes with ``Depends(get_user_required)``
    don't need a live Supabase JWKS endpoint and tests don't have to mint
    real JWTs. The returned claims look like a real signed-in user so that
    ``claims["sub"]`` and ``claims.get("is_anonymous")`` are exercisable.

    Tests that want to exercise the real JWT path (e.g., tests/auth/) are
    NOT affected because they monkeypatch at a lower level (directly on the
    dep function or on ``verify_supabase_jwt``) and run without a lifespan.
    """
    if os.environ.get("MOCK_ENGINE") == "1":
        monkeypatch.setattr(
            "app.routes.deps.verify_supabase_jwt",
            lambda token, jwks_url, *, strict=False: {  # noqa: ARG005
                "sub": "test-user-uuid",
                "aud": "authenticated",
                "is_anonymous": False,
            },
        )


# ── Phase 2 additions ─────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def mock_engine(monkeypatch):
    """When MOCK_ENGINE=1 is set, replace the real ASR + diarization engines
    with deterministic stubs so route/queue/lifecycle tests run with no GPU
    and no model weights (TEST-02). Pattern 13 in 02-RESEARCH.md.

    The fixture is autouse but a no-op unless MOCK_ENGINE=1 — Phase 1 tests
    and Wave 0 itself remain unaffected.

    We use pytest.importorskip on the pipeline modules so that this fixture
    is safe to load before Wave 2 ships the real modules.
    """
    if os.environ.get("MOCK_ENGINE") != "1":
        return

    # Use plain importlib so a missing pipeline module is a no-op (Wave 0
    # safety) rather than a pytest.skip — the fixture is autouse, so a skip
    # here would skip every test in the suite. importorskip is reserved for
    # test bodies (Wave 2+ will use it directly when the modules are real).
    try:
        import importlib

        transcribe = importlib.import_module("app.pipeline.transcribe")
        diarize = importlib.import_module("app.pipeline.diarize")
    except (ImportError, ModuleNotFoundError):
        # Wave 2 hasn't shipped these yet — silently no-op so Wave 0 tests pass.
        return

    async def fake_transcribe(*_args, **_kwargs):
        return {
            "language": "en",
            "segments": [
                {
                    "start": 0.0,
                    "end": 1.0,
                    "text": "test",
                    "words": [{"w": "test", "s": 0.0, "e": 1.0, "p": 0.99}],
                }
            ],
        }

    async def fake_diarize(*_args, **_kwargs):
        return [{"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00"}]

    if hasattr(transcribe, "transcribe_subprocess"):
        monkeypatch.setattr(transcribe, "transcribe_subprocess", fake_transcribe)
    if hasattr(diarize, "diarize"):
        monkeypatch.setattr(diarize, "diarize", fake_diarize)


@pytest.fixture(scope="session")
def event_loop():
    """Session-scoped event loop so the session-scoped `real_pipeline`
    pytest_asyncio fixture below can run inside the same loop pytest-asyncio
    drives all async tests with — pytest-asyncio scope-mismatch otherwise.

    This is the standard pytest-asyncio session-scope incantation; it does
    NOT introduce a sub-loop (it IS the loop pytest-asyncio uses).
    """
    import asyncio

    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def real_pipeline():
    """Session-scoped: pyannote loads ONCE across the full gpu/slow test suite.

    Awaits ``load_pyannote(settings)`` directly inside the active asyncio loop —
    no ``asyncio.new_event_loop()``, no function-attribute cache. Per-session
    caching is delegated to pytest itself via ``scope="session"``, mirroring
    production OPS-06 (pyannote loaded once per process lifetime).

    Skipped (during fixture setup) if torch+pyannote unavailable or HF_TOKEN
    empty or whisper-cli is unbuilt. Consumed only by gpu/slow-marked tests,
    which never run with MOCK_ENGINE=1 (incompatible markers + mock_engine
    fixture is autouse-gated by the env var, leaving real_pipeline untouched).
    """
    if os.environ.get("MOCK_ENGINE") == "1":
        pytest.skip(
            "MOCK_ENGINE=1 set; real_pipeline (pyannote+whisper.cpp) intentionally bypassed"
        )

    pytest.importorskip("torch")
    pytest.importorskip("pyannote.audio")

    from pathlib import Path as _Path

    from app.config import get_settings
    from app.pipeline.diarize import load_pyannote

    get_settings.cache_clear()
    settings = get_settings()
    if not settings.hf_token:
        pytest.skip("HF_TOKEN not set; real_pipeline cannot load pyannote")
    if not settings.whisper_bin_path or not _Path(settings.whisper_bin_path).exists():
        pytest.skip(f"WHISPER_BIN_PATH not built/present: {settings.whisper_bin_path}")

    from app.pipeline.diarize import diarize as pyannote_diarize
    from app.pipeline.merge import merge_to_payload
    from app.pipeline.normalize import normalize_to_wav
    from app.pipeline.presets import PRESETS
    from app.pipeline.transcribe import transcribe_subprocess

    # Direct await — pytest-asyncio session scope means this runs ONCE.
    pyannote_pipe = await load_pyannote(settings)

    class RealPipeline:
        settings = None
        pipeline = None

        async def run(self, audio_path, *, preset_name: str = "fast", language: str | None = None) -> dict:  # noqa: E501
            import asyncio as _asyncio
            from pathlib import Path

            audio_path = Path(audio_path)
            wav = (
                audio_path.with_suffix(".wav")
                if audio_path.suffix.lower() != ".wav"
                else audio_path
            )
            if wav != audio_path:
                await normalize_to_wav(audio_path, wav)
            preset = PRESETS[preset_name]
            model_path = str(Path(self.settings.models_dir) / preset["model_filename"])
            vad_model_path = (
                self.settings.whisper_vad_model_path
                or str(Path(self.settings.models_dir) / "ggml-silero-v5.1.2.bin")
            )
            cancel = _asyncio.Event()
            asr = await transcribe_subprocess(
                self.settings.whisper_bin_path,
                model_path,
                wav,
                language=language,
                on_progress=None,
                cancel_event=cancel,
                vad_model_path=vad_model_path,
            )
            diar = await pyannote_diarize(self.pipeline, str(wav), num_speakers=None)
            return merge_to_payload(asr, diar)

    rp = RealPipeline()
    rp.settings = settings
    rp.pipeline = pyannote_pipe
    return rp
