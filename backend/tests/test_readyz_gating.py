"""OPTS-07 + OPS-08: /readyz exposes presets_available from JobManager.

Three default-host tests (slow gated off on 8 GB; readyz=ready post-lifespan;
vulkan_device non-null) + one slow-unlocked test that requires:
  - ENABLE_SLOW_PRESET=true
  - a present (real-or-fake) ggml-large-v3.bin in MODELS_DIR

The slow-unlocked test must reload ``app.main`` because the lifespan reads
settings + computes the preset gate at startup; the conftest's lifespan_app
fixture would re-use a cached app whose JobManager's _presets dict was
already locked under the default env.
"""

from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient


@pytest.fixture(autouse=True)
def _mock_env(monkeypatch, tmp_path):
    monkeypatch.setenv("MOCK_ENGINE", "1")
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
    yield
    get_settings.cache_clear()


async def test_readyz_returns_status_ready(client: AsyncClient) -> None:
    r = await client.get("/readyz")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ready"


async def test_readyz_vulkan_device_non_null(client: AsyncClient) -> None:
    """SKIP_VULKAN_PROBE=1 advertises a sentinel device (mock-vulkan-probe)
    that is non-null but distinguishable from a real probe result."""
    r = await client.get("/readyz")
    assert r.json()["vulkan_device"] is not None


async def test_readyz_slow_gated_off_on_8gb(client: AsyncClient) -> None:
    """OPTS-07: with ENABLE_SLOW_PRESET=false, ``slow`` MUST NOT appear in
    presets_available even though large-v3.bin would otherwise blow the
    8 GB VRAM budget anyway."""
    r = await client.get("/readyz")
    presets = r.json()["presets_available"]
    assert "slow" not in presets, presets
    # Fast must be available (small.bin is the smallest model)
    assert "fast" in presets, presets


async def test_readyz_slow_unlocked_with_flag(monkeypatch, tmp_path) -> None:
    """Touch a fake large-v3.bin in MODELS_DIR + set ENABLE_SLOW_PRESET=true;
    expect 'slow' to appear in presets_available.

    Symlinks the existing real models so the gate's ``model_path.exists()``
    check passes for fast/average/turbo too — we don't want this test to
    accidentally REMOVE presets that should be available, only ADD slow.
    """
    # Mirror real models dir but also drop a fake large-v3.bin
    models_dir = tmp_path / "models"
    models_dir.mkdir()
    real_models = Path.home() / ".transcribe" / "models"
    for fname in ("ggml-small.bin", "ggml-medium.bin", "ggml-large-v3-turbo.bin"):
        src = real_models / fname
        if src.exists():
            # Symlink to avoid copying GB of data
            (models_dir / fname).symlink_to(src)
    # presence check passes; the worker won't actually be invoked for slow
    # so a 1-byte file is fine
    (models_dir / "ggml-large-v3.bin").write_bytes(b"x")

    monkeypatch.setenv("MOCK_ENGINE", "1")
    monkeypatch.setenv("SKIP_VULKAN_PROBE", "1")
    monkeypatch.setenv(
        "WHISPER_BIN_PATH",
        os.path.expanduser("~/.transcribe/build/whisper.cpp/build/bin/whisper-cli"),
    )
    monkeypatch.setenv("MODELS_DIR", str(models_dir))
    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("WORK_DIR", str(tmp_path / "work"))
    monkeypatch.setenv("ENABLE_SLOW_PRESET", "true")

    from app.config import get_settings

    get_settings.cache_clear()
    from app.queue import progress as progress_mod

    progress_mod.reset_client_for_tests()

    # Force ``app.main`` reload so the lifespan re-runs against the new env;
    # otherwise its JobManager's _presets dict is already locked from the
    # session-cached app instance.
    if "app.main" in sys.modules:
        import app.main as main_mod

        importlib.reload(main_mod)
    from app.main import app

    async with LifespanManager(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/readyz")
            assert "slow" in r.json()["presets_available"], r.json()
