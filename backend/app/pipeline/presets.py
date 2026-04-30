"""Quality preset gating (OPTS-07 + L9).

PRESETS is the static map; available_presets(settings, vram_total_mb) is the
runtime filter that subtracts 1 GB headroom for diarization+OS+activations
and drops Slow unless ENABLE_SLOW_PRESET=true.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

PRESETS: dict[str, dict[str, Any]] = {
    "fast": {"model_filename": "ggml-small.bin", "estimated_vram_mb": 1024},
    "average": {"model_filename": "ggml-medium.bin", "estimated_vram_mb": 2048},
    "average_turbo": {
        "model_filename": "ggml-large-v3-turbo.bin",
        "estimated_vram_mb": 3072,
    },
    "slow": {"model_filename": "ggml-large-v3.bin", "estimated_vram_mb": 6144},
}


HEADROOM_MB = 1024  # leave 1 GB for diarization+OS+activations


def available_presets(settings: Any, vram_total_mb: int) -> dict[str, dict[str, Any]]:
    """Return the subset of PRESETS that are runtime-eligible on this host.

    A preset is included only if (a) it is not 'slow' or `enable_slow_preset` is
    set, (b) its estimated VRAM fits under (vram_total_mb - HEADROOM_MB), AND
    (c) the model file exists at `settings.models_dir / model_filename`.
    """
    out: dict[str, dict[str, Any]] = {}
    budget = vram_total_mb - HEADROOM_MB
    for name, spec in PRESETS.items():
        if name == "slow" and not settings.enable_slow_preset:
            continue
        if spec["estimated_vram_mb"] > budget:
            continue
        model_path = Path(settings.models_dir) / spec["model_filename"]
        if not model_path.exists():
            continue
        out[name] = {**spec, "model_path": str(model_path)}
    return out
