"""OPTS-07: Slow preset gated off on 8 GB; missing model file drops preset."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from app.pipeline.presets import PRESETS, available_presets


def _settings(models_dir: Path, enable_slow: bool = False) -> SimpleNamespace:
    return SimpleNamespace(models_dir=models_dir, enable_slow_preset=enable_slow)


def test_slow_gated_off_8gb(tmp_path: Path) -> None:
    """All 4 model files present, but Slow gated off without ENABLE_SLOW_PRESET."""
    for p in PRESETS.values():
        (tmp_path / p["model_filename"]).write_bytes(b"x")
    out = available_presets(_settings(tmp_path), vram_total_mb=8192)
    assert "slow" not in out
    assert {"fast", "average", "average_turbo"} <= set(out.keys())


def test_slow_unlocked_with_flag_and_vram(tmp_path: Path) -> None:
    """With ENABLE_SLOW_PRESET=true and 8 GB VRAM, slow fits (6144 < 8192-1024)."""
    for p in PRESETS.values():
        (tmp_path / p["model_filename"]).write_bytes(b"x")
    out = available_presets(_settings(tmp_path, enable_slow=True), vram_total_mb=8192)
    assert "slow" in out


def test_slow_dropped_when_vram_insufficient(tmp_path: Path) -> None:
    """6 GB VRAM with slow flag still drops slow (6144 > 5120 budget)."""
    for p in PRESETS.values():
        (tmp_path / p["model_filename"]).write_bytes(b"x")
    out = available_presets(_settings(tmp_path, enable_slow=True), vram_total_mb=6144)
    assert "slow" not in out


def test_missing_model_file_drops_preset(tmp_path: Path) -> None:
    """Only the fast model file is present → only fast survives."""
    (tmp_path / "ggml-small.bin").write_bytes(b"x")
    out = available_presets(_settings(tmp_path), vram_total_mb=8192)
    assert set(out.keys()) == {"fast"}


def test_2gb_vram_only_fast_survives(tmp_path: Path) -> None:
    """budget = 2048 - 1024 = 1024 MB → only fast (estimated 1024) survives."""
    for p in PRESETS.values():
        (tmp_path / p["model_filename"]).write_bytes(b"x")
    out = available_presets(_settings(tmp_path), vram_total_mb=2048)
    assert set(out.keys()) == {"fast"}
