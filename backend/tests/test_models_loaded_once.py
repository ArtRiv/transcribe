"""OPS-06 instrumentation: pyannote loads exactly once across N jobs.

Isolated from test_queue.py because we must monkeypatch
``app.pipeline.diarize.load_pyannote`` BEFORE ``app.main`` is imported (the
lifespan does a lazy ``from app.pipeline.diarize import load_pyannote`` —
if main is already imported in another test, the patch races the import
and silently misses).

Note this test deliberately bypasses MOCK_ENGINE for the lifespan's pyannote
load gate: with ``MOCK_ENGINE=1`` the lifespan's pyannote-load branch is
skipped entirely (advertises ``pyannote_pipeline=None``), so ``load_pyannote``
would never be called and the assertion would be a tautology. We unset
``MOCK_ENGINE`` before importing main, install our counting fake at the
diarize-module level, and let the lifespan exercise the real load path.
The fake's ``__call__`` returns an empty diarization so the worker can drain
N=5 mock jobs without exercising the real pipeline.
"""

from __future__ import annotations

import asyncio
import importlib
import io
import os
import sys

from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient


async def _drain(jm, timeout: float = 10.0) -> None:
    async def _wait():
        while jm.queue.qsize() > 0 or len(jm.jobs) > 0:
            await asyncio.sleep(0.02)

    await asyncio.wait_for(_wait(), timeout=timeout)


async def test_ops_06_pyannote_loaded_once(monkeypatch, tmp_path) -> None:
    load_count = {"n": 0}

    async def fake_load_pyannote(_settings):
        load_count["n"] += 1

        class FakePipe:
            # Mirror pyannote.audio 3.x Pipeline's public surface: `.device` is
            # set inside `Pipeline.to()` and read by load_pyannote's CPU-pin
            # assertion + main.py's lifespan log line. pyannote 3.x Pipeline is
            # NOT a torch.nn.Module — `.parameters()` is a dict of hyperparams,
            # not an iterator of torch tensors.
            class _FakeDev:
                type = "cpu"

            device = _FakeDev()

            def to(self, _):
                return self

            def __call__(self, _wav, **_kw):
                class Diar:
                    def itertracks(self, yield_label=True):
                        return iter([])

                return Diar()

        return FakePipe()

    # Step 1: env BEFORE settings + before app import. We bypass the Vulkan
    # probe (no GPU dependency in this test) but turn OFF MOCK_ENGINE so the
    # lifespan exercises the real pyannote-load branch (which we will redirect
    # to fake_load_pyannote in step 2).
    monkeypatch.setenv("MOCK_ENGINE", "0")
    monkeypatch.setenv("SKIP_VULKAN_PROBE", "1")
    monkeypatch.setenv(
        "WHISPER_BIN_PATH",
        os.path.expanduser("~/.transcribe/build/whisper.cpp/build/bin/whisper-cli"),
    )
    monkeypatch.setenv("MODELS_DIR", os.path.expanduser("~/.transcribe/models"))
    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("WORK_DIR", str(tmp_path / "work"))
    monkeypatch.setenv("ENABLE_SLOW_PRESET", "false")

    from app.config import get_settings

    get_settings.cache_clear()
    from app.queue import progress as progress_mod

    progress_mod.reset_client_for_tests()

    # Step 2: patch load_pyannote at the module the lifespan imports from,
    # BEFORE we import ``app.main``. The lifespan does a lazy
    # ``from app.pipeline.diarize import load_pyannote`` so the symbol resolved
    # at call-time is whatever this module attribute holds.
    monkeypatch.setattr("app.pipeline.diarize.load_pyannote", fake_load_pyannote)
    # Also stub ``diarize`` itself so the worker's diarization stage doesn't
    # exercise the real PyTorch path during the N=5 drain.
    async def fake_diarize(_pipe, _wav, num_speakers=None):
        return []

    monkeypatch.setattr("app.pipeline.diarize.diarize", fake_diarize)
    # Worker does ``from app.pipeline.diarize import diarize as pyannote_diarize``;
    # rebind that bind site too so the fake actually gets used.
    if "app.queue.worker" in sys.modules:
        monkeypatch.setattr("app.queue.worker.pyannote_diarize", fake_diarize)
    # Stub the transcribe step so we don't shell out to whisper-cli.
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

    monkeypatch.setattr("app.pipeline.transcribe.transcribe_subprocess", fake_transcribe)
    if "app.queue.worker" in sys.modules:
        monkeypatch.setattr("app.queue.worker.transcribe_subprocess", fake_transcribe)
    # Stub normalize so we don't shell out to ffmpeg.
    async def fake_normalize(src, dst):
        # Touch the destination WAV so cleanup_job_files has something to remove.
        dst.write_bytes(b"")

    monkeypatch.setattr("app.pipeline.normalize.normalize_to_wav", fake_normalize)
    if "app.queue.worker" in sys.modules:
        monkeypatch.setattr("app.queue.worker.normalize_to_wav", fake_normalize)

    # Step 3: import app.main only AFTER the monkeypatches are installed.
    # If app.main was previously imported by another test, force a reload so
    # the lifespan body re-runs against the patched symbol.
    if "app.main" in sys.modules:
        import app.main as _main_mod

        importlib.reload(_main_mod)
    from app.main import app  # ordered import is the point — must follow patches above

    # Phase 4: MOCK_ENGINE=0 here (we're testing the real pyannote-load path),
    # so the _mock_jwt_verify conftest fixture is inactive. Override the auth
    # dependency directly so the N=5 POST /jobs calls don't need a live JWKS.
    from app.routes.deps import get_user_required

    app.dependency_overrides[get_user_required] = lambda: {
        "sub": "test-user-uuid",
        "aud": "authenticated",
        "is_anonymous": False,
    }

    # After reload the worker module may have re-imported transcribe/diarize
    # symbols; rebind once more for safety now that the chain is settled.
    monkeypatch.setattr("app.queue.worker.transcribe_subprocess", fake_transcribe)
    monkeypatch.setattr("app.queue.worker.pyannote_diarize", fake_diarize)
    monkeypatch.setattr("app.queue.worker.normalize_to_wav", fake_normalize)

    async with LifespanManager(app):
        # The lifespan's pyannote-load branch should have called load_pyannote
        # exactly once by now.
        assert load_count["n"] == 1, (
            f"OPS-06 violated: load_pyannote called {load_count['n']} times during lifespan"
        )

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            for _ in range(5):
                files = {"file": ("a.wav", io.BytesIO(b"\x00" * 50), "audio/wav")}
                # Phase 4: POST /jobs requires JWT. MOCK_ENGINE=0 here so we need
                # to patch deps.verify_supabase_jwt directly. The _mock_jwt_verify
                # conftest fixture is only active when MOCK_ENGINE=1, so we use
                # app.dependency_overrides on the local app instance.
                r = await c.post(
                    "/jobs",
                    files=files,
                    data={"preset": "fast"},
                    headers={"Authorization": "Bearer test"},
                )
                assert r.status_code == 202, r.text
        await _drain(app.state.jobs)

    # OPS-06 final assertion: no job re-loaded the pipeline mid-run.
    assert load_count["n"] == 1, (
        f"OPS-06 violated: load_pyannote called {load_count['n']} after 5 jobs"
    )
