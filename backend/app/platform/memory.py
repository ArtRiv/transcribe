"""Memory introspection for TEST-04 soak.

VRAM is read from /sys/class/drm/card[0-9]/device/mem_info_vram_*  (Linux
amdgpu sysfs nodes). whisper.cpp's own ggml_backend_vk_get_device_memory
callback is broken (issue #3254) — sysfs is the only reliable AMD path.

Host RAM is read via psutil.Process().memory_full_info().uss
(Unique Set Size) — the canonical leak metric. RSS double-counts shared
memory; USS does not (psutil 7.2.2 docs).

Live-verified on this host (2026-04-27):
  - card index: 1 (NOT 0 — card0 is iGPU/none)
  - vendor 0x1002 (AMD), device 0x73ff (Navi 23 / RX 6600)
  - mem_info_vram_total = 8573157376 bytes
"""

from __future__ import annotations

import os
from pathlib import Path

import psutil

_SYSFS_DRM = Path("/sys/class/drm")


def find_amd_card_dir(env_override: str | None = None) -> Path:
    """Locate the amdgpu card device dir.

    Priority:
      1. AMDGPU_CARD_DIR env var (or `env_override` arg) — explicit path to
         /sys/class/drm/cardN/device
      2. Walk card[0-9] entries and pick the one with DRIVER=amdgpu AND
         PCI_ID=1002:* (AMD vendor)

    Raises RuntimeError with a structured message if no match is found.
    """
    override = env_override or os.environ.get("AMDGPU_CARD_DIR")
    if override:
        p = Path(override)
        if not (p / "mem_info_vram_used").exists():
            raise RuntimeError(
                f"AMDGPU_CARD_DIR={override} does not contain mem_info_vram_used; "
                "expected a path like /sys/class/drm/card1/device"
            )
        return p

    for card in sorted(_SYSFS_DRM.glob("card[0-9]")):
        uevent_path = card / "device" / "uevent"
        if not uevent_path.exists():
            continue
        uevent = uevent_path.read_text(errors="ignore")
        if "DRIVER=amdgpu" in uevent and "PCI_ID=1002:" in uevent:
            return card / "device"
    raise RuntimeError(
        "No AMD amdgpu card found in /sys/class/drm/. "
        "Override with AMDGPU_CARD_DIR=/sys/class/drm/cardN/device"
    )


def vram_used_bytes(card_dir: Path | None = None) -> int:
    """Current VRAM usage in bytes (whole-GPU, all processes)."""
    card_dir = card_dir or find_amd_card_dir()
    return int((card_dir / "mem_info_vram_used").read_text().strip())


def vram_total_bytes(card_dir: Path | None = None) -> int:
    """Total VRAM in bytes (constant for a given GPU)."""
    card_dir = card_dir or find_amd_card_dir()
    return int((card_dir / "mem_info_vram_total").read_text().strip())


def vram_total_mb(card_dir: Path | None = None) -> int:
    """Total VRAM in MB — convenience wrapper for sizing presets."""
    return vram_total_bytes(card_dir) // (1024 * 1024)


def host_rss_mb() -> int:
    """USS in MB — the canonical leak metric. Falls back to RSS on AccessDenied
    (Pitfall 6: memory_full_info needs CAP_SYS_PTRACE on some kernels)."""
    proc = psutil.Process()
    try:
        return proc.memory_full_info().uss // (1024 * 1024)
    except psutil.AccessDenied:
        return proc.memory_info().rss // (1024 * 1024)
