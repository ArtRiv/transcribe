#!/usr/bin/env bash
# backend/scripts/install_phase2_prereqs.sh
#
# Idempotent installer for the Phase 2 system-level dependencies.
# Consumes the Phase 1 carry-over todo "Install postgresql-client on the dev host"
# and adds the rest of the apt deps that whisper.cpp (Vulkan), ffmpeg
# normalization, and the verify_phase2.sh SQL probes need.
#
# Once installed, post-install verifications confirm each tool is on $PATH and
# vulkaninfo enumerates an AMD device (the locked hardware: Radeon RX 6600).
#
# Re-run safe: apt-get install is a no-op when packages are already present.
#
# See:
#   .planning/phases/02-backend-pipeline/02-RESEARCH.md §144-200 (apt block)
#   .planning/phases/02-backend-pipeline/02-PATTERNS.md §547-552 (analog)
#   docs/DEPENDENCIES.md — System Packages table

set -euo pipefail

# ---------------------------------------------------------------------------
# 0. Pre-flight: sudo must be available (apt requires it on a normal dev host).
# ---------------------------------------------------------------------------
command -v sudo >/dev/null || {
  echo "ERROR: sudo required but not found on PATH" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# 1. Idempotency short-circuit: if every required tool is already on $PATH,
#    skip `sudo apt-get` entirely. This makes re-runs (and CI smoke checks)
#    succeed without prompting for a password when nothing needs to change.
# ---------------------------------------------------------------------------
NEED_INSTALL=0
for cmd in ffmpeg ffprobe vulkaninfo cmake psql glslc; do
  if ! command -v "$cmd" >/dev/null; then
    NEED_INSTALL=1
    break
  fi
done
# build-essential, spirv-tools, libvulkan-dev are libraries/headers, not
# single binaries — probe via dpkg. libvulkan-dev is required to build
# whisper.cpp with -DGGML_VULKAN=1 (cmake's FindVulkan needs Vulkan_INCLUDE_DIR
# and Vulkan_LIBRARY which only ship in -dev).
if [ "$NEED_INSTALL" = "0" ]; then
  if ! dpkg -s build-essential >/dev/null 2>&1; then NEED_INSTALL=1; fi
fi
if [ "$NEED_INSTALL" = "0" ]; then
  if ! dpkg -s spirv-tools >/dev/null 2>&1; then NEED_INSTALL=1; fi
fi
if [ "$NEED_INSTALL" = "0" ]; then
  if ! dpkg -s libvulkan-dev >/dev/null 2>&1; then NEED_INSTALL=1; fi
fi

# ---------------------------------------------------------------------------
# 2. apt-get install — exact block lifted from 02-RESEARCH.md §1147-1155.
#    Only runs when at least one required dep is missing.
# ---------------------------------------------------------------------------
if [ "$NEED_INSTALL" = "1" ]; then
  sudo apt-get update
  sudo apt-get install -y \
    ffmpeg \
    vulkan-tools \
    libvulkan-dev \
    cmake \
    build-essential \
    postgresql-client \
    glslc \
    spirv-tools
else
  echo "[install_phase2_prereqs.sh] all required apt packages already present; skipping apt-get"
fi

# Defensive post-condition: libvulkan-dev MUST be present for the
# whisper.cpp build (cmake FindVulkan resolves Vulkan_INCLUDE_DIR from it).
if ! dpkg -s libvulkan-dev >/dev/null 2>&1; then
  echo "ERROR: libvulkan-dev missing — whisper.cpp build will fail at cmake configure" >&2
  echo "       Install with: sudo apt-get install -y libvulkan-dev" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Post-install verification — every tool must resolve on $PATH AND identify
#    an expected version family. Any failure is a hard `exit 1`.
# ---------------------------------------------------------------------------

# ffmpeg / ffprobe — expect 6.x or newer (Ubuntu 26.04 ships ffmpeg 8;
# CLAUDE.md only requires "ffmpeg ≥6"). Lower bound is 6.x; no upper cap.
FFMPEG_LINE="$(ffmpeg -version 2>/dev/null | head -1 || true)"
if ! echo "$FFMPEG_LINE" | grep -qE '^ffmpeg version (6|7|8|9|[1-9][0-9]+)\.'; then
  echo "ERROR: ffmpeg version 6.x or newer expected; got: $FFMPEG_LINE" >&2
  exit 1
fi

FFPROBE_LINE="$(ffprobe -version 2>/dev/null | head -1 || true)"
if ! echo "$FFPROBE_LINE" | grep -qE '^ffprobe version (6|7|8|9|[1-9][0-9]+)\.'; then
  echo "ERROR: ffprobe version 6.x or newer expected; got: $FFPROBE_LINE" >&2
  exit 1
fi

# vulkaninfo — must list an AMD device (locked hardware: RX 6600).
if ! vulkaninfo --summary 2>/dev/null | grep -qi 'amd'; then
  echo "ERROR: vulkaninfo --summary did not enumerate an AMD device" >&2
  echo "       The locked hardware for this project is the AMD Radeon RX 6600." >&2
  echo "       Confirm the Mesa Vulkan driver (mesa-vulkan-drivers) is installed" >&2
  echo "       and that the kernel sees the GPU (lspci | grep -i vga)." >&2
  exit 1
fi

# cmake / psql / glslc — exist + print a version line.
cmake --version | head -1 >/dev/null || { echo "ERROR: cmake missing" >&2; exit 1; }
psql --version | head -1 >/dev/null || { echo "ERROR: psql missing" >&2; exit 1; }
glslc --version | head -1 >/dev/null || { echo "ERROR: glslc missing" >&2; exit 1; }

# Final pass: every required command resolves on $PATH (defensive).
for cmd in ffmpeg ffprobe vulkaninfo cmake psql glslc; do
  command -v "$cmd" >/dev/null || {
    echo "ERROR: $cmd not on \$PATH after install" >&2
    exit 1
  }
done

echo "[install_phase2_prereqs.sh] all Phase 2 system deps present"
