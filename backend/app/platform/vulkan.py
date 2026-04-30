"""Vulkan device probe + whisper.cpp sanity check (OPS-05).

Two checks run at lifespan startup, executed sequentially:

  1. ``vulkaninfo --summary`` exits 0 AND mentions a deviceName line
     (proves the loader+driver stack is healthy at the system level).
  2. ``whisper-cli`` is invoked with the smallest available GGML model on
     a tiny silent WAV; stderr MUST contain ``ggml_vulkan: Found`` plus a
     deviceName line (proves whisper.cpp itself was built with
     ``-DGGML_VULKAN=1`` and can enumerate the device through GGML).

Both must pass; failure raises ``RuntimeError`` whose message contains the
exact apt-install hint (mirroring the refusal idiom in
``backend/scripts/check_tunnel_preflight.sh``) AND the
``backend/scripts/build_whisper_cpp.sh`` reminder.

Note (deviation from PLAN §02-05 Task 1): Upstream whisper.cpp v1.8.4 does
NOT expose a ``--list-devices`` flag (verified locally — exit 2 with usage
banner). The functionally equivalent probe is to actually load a model on
a tiny silent WAV and parse the GGML startup banner from stderr; this
takes <1s on this host with the small.bin model and exercises the real
GGML→Vulkan loader path (a stronger guarantee than a parse-only flag).
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import re
import struct
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import TypedDict


class VulkanDevice(TypedDict):
    name: str
    driver_version: str
    api_version: str


_APT_HINT = "sudo apt install -y vulkan-tools mesa-vulkan-drivers libvulkan1"
_BUILD_HINT = "Run: bash backend/scripts/build_whisper_cpp.sh"


def _make_silence_wav(path: Path, *, seconds: float = 0.3, sample_rate: int = 16000) -> None:
    """Write a tiny mono 16-bit silent WAV file used solely to drive the probe.

    Uses the stdlib ``wave`` module so we do not depend on ffmpeg here. The
    file is small (~9.6 kB at 16 kHz / 0.3 s) and is removed after the probe.
    """
    n_frames = int(sample_rate * seconds)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(struct.pack(f"<{n_frames}h", *([0] * n_frames)))


def _smallest_available_model(settings) -> str | None:
    """Pick the smallest GGML model file on disk so the probe is fast.

    Preference order: small → medium → turbo → large → settings.whisper_model_path.
    Returns ``None`` if none of the candidates exist (probe will fail with a
    clear hint pointing at ``download_models.sh``).
    """
    models_dir = Path(getattr(settings, "models_dir", Path.home() / ".transcribe" / "models"))
    candidates = (
        "ggml-small.bin",
        "ggml-medium.bin",
        "ggml-large-v3-turbo.bin",
        "ggml-large-v3.bin",
    )
    for name in candidates:
        candidate = models_dir / name
        if candidate.exists():
            return str(candidate)
    cfg = getattr(settings, "whisper_model_path", "")
    if cfg and os.path.exists(cfg):
        return cfg
    return None


async def probe_vulkan_or_die(settings) -> VulkanDevice:
    """Run both probes concurrently-ish; raise on any failure (OPS-05)."""
    # ── Check 1: vulkaninfo says the driver+loader stack is healthy ──────
    proc = await asyncio.create_subprocess_exec(
        "vulkaninfo",
        "--summary",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    stdout_b, stderr_b = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"vulkaninfo failed (exit {proc.returncode}): "
            f"{stderr_b.decode(errors='replace')[:500]}\n"
            f"Install: {_APT_HINT}"
        )
    stdout = stdout_b.decode(errors="replace")
    match = re.search(r"deviceName\s*=\s*(.+)", stdout)
    if not match:
        raise RuntimeError(f"vulkaninfo --summary found no deviceName lines.\nInstall: {_APT_HINT}")
    device_name = match.group(1).strip()
    driver_match = re.search(r"driverVersion\s*=\s*([\w.\-()]+)", stdout)
    api_match = re.search(r"apiVersion\s*=\s*([\w.\-()]+)", stdout)
    driver_version = driver_match.group(1).strip() if driver_match else "unknown"
    api_version = api_match.group(1).strip() if api_match else "unknown"

    # ── Check 2: whisper.cpp's Vulkan backend can enumerate the device ───
    bin_path = getattr(settings, "whisper_bin_path", "") or ""
    if not bin_path:
        raise RuntimeError(
            "settings.whisper_bin_path is empty — set WHISPER_BIN_PATH in backend/.env\n"
            f"{_BUILD_HINT}"
        )
    if not os.path.exists(bin_path):
        raise RuntimeError(
            f"whisper-cli binary not found at {bin_path!r}.\n"
            "Was whisper.cpp built with -DGGML_VULKAN=1?\n"
            f"{_BUILD_HINT}"
        )
    if not os.access(bin_path, os.X_OK):
        raise RuntimeError(
            f"whisper-cli at {bin_path!r} is not executable.\n"
            "Was whisper.cpp built with -DGGML_VULKAN=1?\n"
            f"{_BUILD_HINT}"
        )

    model_path = _smallest_available_model(settings)
    if not model_path:
        raise RuntimeError(
            "No GGML whisper model found on disk to drive the probe.\n"
            "Run: bash backend/scripts/download_models.sh\n"
            f"{_BUILD_HINT}"
        )

    # Drive whisper-cli with a tiny silence WAV; capture stderr for the
    # ggml_vulkan startup banner. Runs in <1s with the small model.
    with tempfile.TemporaryDirectory(prefix="whisper-probe-") as td:
        silence = Path(td) / "silence.wav"
        _make_silence_wav(silence)
        # NOTE: deliberately NOT using ``--no-prints`` here; the GGML/Vulkan
        # startup banner ("ggml_vulkan: Found N Vulkan devices: ...") is
        # written to stderr only when verbose model-load logging is enabled.
        # ``--no-prints`` suppresses both the result-printing AND the GGML
        # init banner, which would defeat the probe.
        proc = await asyncio.create_subprocess_exec(
            bin_path,
            "--no-timestamps",
            "-l",
            "en",
            "-m",
            model_path,
            "-f",
            str(silence),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=30)
        except TimeoutError:
            with contextlib.suppress(Exception):
                proc.kill()
            raise RuntimeError(
                "whisper-cli probe timed out after 30s.\n"
                "Was whisper.cpp built with -DGGML_VULKAN=1?\n"
                f"{_BUILD_HINT}"
            ) from None

    combined = (stdout_b + stderr_b).decode(errors="replace")
    if "ggml_vulkan" not in combined or "Found" not in combined:
        raise RuntimeError(
            "whisper-cli ran but did not emit the expected GGML/Vulkan banner.\n"
            "Was whisper.cpp built with -DGGML_VULKAN=1?\n"
            f"Output (last 500 chars): {combined[-500:]}\n"
            f"{_BUILD_HINT}"
        )

    return VulkanDevice(
        name=device_name,
        driver_version=driver_version,
        api_version=api_version,
    )
