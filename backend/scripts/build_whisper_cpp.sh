#!/usr/bin/env bash
# backend/scripts/build_whisper_cpp.sh
#
# Idempotent builder for whisper.cpp v1.8.4 with the Vulkan backend enabled.
# Produces ~/.transcribe/build/whisper.cpp/build/bin/whisper-cli — the binary
# the FastAPI worker shells out to in Wave 2.
#
# Re-runs are no-ops once the binary exists at the pinned tag.
#
# See:
#   .planning/phases/02-backend-pipeline/02-RESEARCH.md §162-184 (build commands)
#   .planning/phases/02-backend-pipeline/02-PATTERNS.md §493-535 (idempotency)
#   docs/DEPENDENCIES.md "whisper.cpp build" section
#
# Locks supply-chain integrity (T-02-01-SupplyChain): the resolved git SHA is
# appended to docs/DEPENDENCIES.md on first build.

set -euo pipefail

# ---------------------------------------------------------------------------
# 0. Pre-flight: required tools must be on $PATH. If any missing, point the
#    operator at install_phase2_prereqs.sh — do NOT silently continue.
# ---------------------------------------------------------------------------
for cmd in cmake git glslc; do
  if ! command -v "$cmd" >/dev/null; then
    echo "ERROR: $cmd not installed. Run: bash backend/scripts/install_phase2_prereqs.sh" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 1. Resolve paths + pin tag.
# ---------------------------------------------------------------------------
BUILD_DIR="${WHISPER_CPP_BUILD_DIR:-$HOME/.transcribe/build/whisper.cpp}"
PIN_TAG="v1.8.4"
WHISPER_CLI="$BUILD_DIR/build/bin/whisper-cli"

# Resolve the repo-root docs path (this script lives at backend/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPS_FILE="$REPO_ROOT/docs/DEPENDENCIES.md"

# ---------------------------------------------------------------------------
# 2. Idempotency: if the binary exists AND HEAD is already at the pinned tag,
#    short-circuit. This makes re-runs (and CI smoke checks) cheap.
# ---------------------------------------------------------------------------
if [ -x "$WHISPER_CLI" ] && [ -d "$BUILD_DIR/.git" ]; then
  HEAD_SHA="$(git -C "$BUILD_DIR" rev-parse HEAD 2>/dev/null || echo none)"
  TAG_SHA="$(git -C "$BUILD_DIR" rev-parse "$PIN_TAG" 2>/dev/null || echo missing)"
  if [ "$HEAD_SHA" = "$TAG_SHA" ] && [ "$HEAD_SHA" != "none" ]; then
    echo "[build_whisper_cpp.sh] already built at $PIN_TAG ($HEAD_SHA); skipping"
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# 3. Clone (if absent) + checkout the pinned tag.
# ---------------------------------------------------------------------------
mkdir -p "$(dirname "$BUILD_DIR")"
if [ ! -d "$BUILD_DIR/.git" ]; then
  echo "[build_whisper_cpp.sh] cloning whisper.cpp into $BUILD_DIR"
  git clone https://github.com/ggml-org/whisper.cpp.git "$BUILD_DIR"
fi
git -C "$BUILD_DIR" fetch --tags --quiet
git -C "$BUILD_DIR" checkout "$PIN_TAG"

# ---------------------------------------------------------------------------
# 4. Configure + build with the Vulkan backend (-DGGML_VULKAN=1).
# ---------------------------------------------------------------------------
echo "[build_whisper_cpp.sh] configuring cmake (-DGGML_VULKAN=1)"
cmake -S "$BUILD_DIR" -B "$BUILD_DIR/build" \
  -DGGML_VULKAN=1 \
  -DCMAKE_BUILD_TYPE=Release

echo "[build_whisper_cpp.sh] building (this can take 5-10 min on first run)"
cmake --build "$BUILD_DIR/build" --config Release -j

# ---------------------------------------------------------------------------
# 5. Post-build verification.
# ---------------------------------------------------------------------------
if [ ! -x "$WHISPER_CLI" ]; then
  echo "ERROR: build completed but $WHISPER_CLI not found or not executable" >&2
  exit 1
fi

"$WHISPER_CLI" --help >/dev/null 2>&1 || {
  echo "ERROR: $WHISPER_CLI --help failed" >&2
  exit 1
}

# whisper-cli emits its device list on stdout/stderr when invoked with a
# (possibly bogus) model path; --help does NOT enumerate Vulkan. We probe
# device enumeration via a special invocation. Older whisper.cpp builds
# expose `--list-devices`; if not present, fall back to grepping the build
# log for the GGML Vulkan capture line.
DEVICE_OUT="$("$WHISPER_CLI" --help 2>&1 | grep -i vulkan || true)"
# A more reliable probe: run the binary with --version-equivalent flags and
# capture its startup banner; ggml-vulkan logs "ggml_vulkan: <device>" on init.
# We trigger that by passing --print-progress=0 and a fake input — but the
# zero-cost probe is just confirming the GGML Vulkan symbol is in the binary.
if ! grep -q "ggml_vulkan" "$WHISPER_CLI" 2>/dev/null; then
  # strings() may not be present; the grep above is a binary-content probe.
  echo "WARN: 'ggml_vulkan' symbol not visible via grep; deferring Vulkan check to runtime probe (tools/probe_whisper_json.sh)" >&2
fi

echo "[build_whisper_cpp.sh] whisper-cli built: $WHISPER_CLI"

# ---------------------------------------------------------------------------
# 6. Append build pin to docs/DEPENDENCIES.md (idempotent — only on first
#    successful build, detected by the "Phase 2 build pins" section header
#    being absent).
# ---------------------------------------------------------------------------
BUILD_SHA="$(git -C "$BUILD_DIR" rev-parse HEAD)"
if [ -f "$DEPS_FILE" ] && ! grep -q '^## Phase 2 build pins' "$DEPS_FILE"; then
  cat >> "$DEPS_FILE" <<EOF

## Phase 2 build pins (locked 2026-04-27)

### whisper.cpp
- Tag: \`$PIN_TAG\`
- Commit SHA: \`$BUILD_SHA\`
- Built with: \`cmake -B build -DGGML_VULKAN=1 -DCMAKE_BUILD_TYPE=Release\`
- Build path on this host: \`~/.transcribe/build/whisper.cpp/build/bin/whisper-cli\`

### GGML model SHA-256 pins
EOF
  echo "[build_whisper_cpp.sh] appended Phase 2 build pin section to $DEPS_FILE"
fi

echo "[build_whisper_cpp.sh] DONE — $PIN_TAG @ $BUILD_SHA"
