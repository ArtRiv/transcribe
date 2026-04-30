#!/usr/bin/env bash
# backend/scripts/download_models.sh
#
# Idempotent fetcher for the GGML whisper.cpp model files used by Wave 2's
# transcribe.py. Downloads small / medium / large-v3-turbo (NOT large-v3 —
# the Slow preset is gated off on 8 GB Vulkan per OPTS-07) into
# ~/.transcribe/models/, then computes + records SHA-256 sums into
# docs/DEPENDENCIES.md so subsequent runs verify before reuse
# (T-02-01-ModelTamper).
#
# Pre-flight: build_whisper_cpp.sh must have run first (the upstream
# download-ggml-model.sh script lives inside the cloned tree).
#
# See:
#   .planning/phases/02-backend-pipeline/02-RESEARCH.md §178-184 (model list)
#   .planning/phases/02-backend-pipeline/02-PATTERNS.md §540-545 (idempotency)

set -euo pipefail

# ---------------------------------------------------------------------------
# 1. Resolve paths.
# ---------------------------------------------------------------------------
MODELS_DIR="${MODELS_DIR:-$HOME/.transcribe/models}"
BUILD_DIR="${WHISPER_CPP_BUILD_DIR:-$HOME/.transcribe/build/whisper.cpp}"
DOWNLOAD_HELPER="$BUILD_DIR/models/download-ggml-model.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPS_FILE="$REPO_ROOT/docs/DEPENDENCIES.md"

# ---------------------------------------------------------------------------
# 2. Pre-flight: refuse if whisper.cpp not yet cloned/built.
# ---------------------------------------------------------------------------
if [ ! -x "$DOWNLOAD_HELPER" ]; then
  echo "ERROR: whisper.cpp not built; run: bash backend/scripts/build_whisper_cpp.sh" >&2
  echo "       (expected helper at: $DOWNLOAD_HELPER)" >&2
  exit 1
fi

mkdir -p "$MODELS_DIR"

# ---------------------------------------------------------------------------
# 3. Resolve any pinned SHA-256s from .env / .env.example so re-runs verify
#    the existing file before re-downloading.
# ---------------------------------------------------------------------------
get_pinned_sha() {
  # $1 = env var name (MODEL_SMALL_SHA256, MODEL_MEDIUM_SHA256, MODEL_TURBO_SHA256)
  local name="$1"
  # Prefer live env, fall back to repo-root .env, fall back to .env.example.
  if [ -n "${!name:-}" ]; then
    echo "${!name}"
    return
  fi
  for f in "$REPO_ROOT/.env" "$REPO_ROOT/.env.example"; do
    if [ -f "$f" ]; then
      local val
      val="$(grep -E "^${name}=" "$f" | head -1 | cut -d= -f2- | tr -d '"' | xargs || true)"
      if [ -n "$val" ]; then
        echo "$val"
        return
      fi
    fi
  done
  echo ""
}

env_var_for() {
  case "$1" in
    small)            echo "MODEL_SMALL_SHA256" ;;
    medium)           echo "MODEL_MEDIUM_SHA256" ;;
    large-v3-turbo)   echo "MODEL_TURBO_SHA256" ;;
    silero-v5.1.2)    echo "MODEL_VAD_SILERO_SHA256" ;;
    *)                echo "" ;;
  esac
}

# whisper.cpp ships a separate helper for VAD models (Silero is not part of
# the GGML ASR catalog). Pitfall 5 mandates --vad on every job, and
# whisper.cpp 1.8+ requires --vad-model FNAME alongside it.
VAD_DOWNLOAD_HELPER="$BUILD_DIR/models/download-vad-model.sh"

# ---------------------------------------------------------------------------
# 4. Loop: small, medium, large-v3-turbo (large-v3 INTENTIONALLY OMITTED —
#    OPTS-07 gates Slow preset off on 8 GB host).
# ---------------------------------------------------------------------------
DOWNLOADED=()
for MODEL in small medium large-v3-turbo silero-v5.1.2; do
  TARGET="$MODELS_DIR/ggml-${MODEL}.bin"
  PINNED_SHA="$(get_pinned_sha "$(env_var_for "$MODEL")")"

  if [ -f "$TARGET" ]; then
    if [ -n "$PINNED_SHA" ]; then
      ACTUAL_SHA="$(sha256sum "$TARGET" | cut -d' ' -f1)"
      if [ "$ACTUAL_SHA" = "$PINNED_SHA" ]; then
        echo "[download_models.sh] $MODEL already present and verified; skipping"
        continue
      else
        echo "WARN: $TARGET sha256 ($ACTUAL_SHA) does not match pin ($PINNED_SHA)" >&2
        echo "      Removing and re-downloading." >&2
        rm -f "$TARGET"
      fi
    else
      echo "[download_models.sh] $MODEL already present (no pin yet); skipping"
      continue
    fi
  fi

  echo "[download_models.sh] downloading $MODEL into $MODELS_DIR"
  case "$MODEL" in
    silero-*)
      if [ ! -x "$VAD_DOWNLOAD_HELPER" ]; then
        echo "ERROR: VAD download helper missing: $VAD_DOWNLOAD_HELPER" >&2
        echo "       (re-run build_whisper_cpp.sh against whisper.cpp >= 1.8.4)" >&2
        exit 1
      fi
      bash "$VAD_DOWNLOAD_HELPER" "$MODEL" "$MODELS_DIR"
      ;;
    *)
      bash "$DOWNLOAD_HELPER" "$MODEL" "$MODELS_DIR"
      ;;
  esac

  if [ ! -f "$TARGET" ]; then
    echo "ERROR: download helper did not produce $TARGET" >&2
    exit 1
  fi
  DOWNLOADED+=("$MODEL")
done

# ---------------------------------------------------------------------------
# 5. Compute SHAs for everything in $MODELS_DIR and append any new pins to
#    docs/DEPENDENCIES.md (only entries not already present).
# ---------------------------------------------------------------------------
append_pin_line() {
  # $1 = filename (e.g. ggml-small.bin), $2 = sha
  local fname="$1" sha="$2"
  if grep -qE "\`$fname\`:[[:space:]]*\`$sha\`" "$DEPS_FILE" 2>/dev/null; then
    return
  fi
  # Strip any earlier line for this filename (in case it was a placeholder)
  if [ -f "$DEPS_FILE" ]; then
    sed -i.bak -E "/^- \`$fname\`:/d" "$DEPS_FILE" && rm -f "${DEPS_FILE}.bak"
  fi
  # Append under the "GGML model SHA-256 pins" section if it exists; otherwise
  # append at end of file (build_whisper_cpp.sh creates that section).
  if grep -q '^### GGML model SHA-256 pins' "$DEPS_FILE"; then
    awk -v line="- \`$fname\`: \`$sha\`" '
      /^### GGML model SHA-256 pins/ { print; print line; next }
      { print }
    ' "$DEPS_FILE" > "${DEPS_FILE}.tmp"
    mv "${DEPS_FILE}.tmp" "$DEPS_FILE"
  else
    echo "- \`$fname\`: \`$sha\`" >> "$DEPS_FILE"
  fi
}

for MODEL in small medium large-v3-turbo silero-v5.1.2; do
  TARGET="$MODELS_DIR/ggml-${MODEL}.bin"
  if [ ! -f "$TARGET" ]; then continue; fi
  SHA="$(sha256sum "$TARGET" | cut -d' ' -f1)"
  echo "[download_models.sh] sha256(ggml-${MODEL}.bin) = $SHA"
  append_pin_line "ggml-${MODEL}.bin" "$SHA"
done

# Note the deliberate large-v3 omission in the deps file (idempotent).
if [ -f "$DEPS_FILE" ] && ! grep -q 'ggml-large-v3.bin.*NOT downloaded' "$DEPS_FILE"; then
  if grep -q '^### GGML model SHA-256 pins' "$DEPS_FILE"; then
    echo "- \`ggml-large-v3.bin\`: NOT downloaded — Slow preset gated off on 8 GB host (OPTS-07)" >> "$DEPS_FILE"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Summary.
# ---------------------------------------------------------------------------
PRESENT=()
for m in small medium large-v3-turbo silero-v5.1.2; do
  if [ -f "$MODELS_DIR/ggml-${m}.bin" ]; then PRESENT+=("$m"); fi
done
echo "[download_models.sh] models present: ${PRESENT[*]} in $MODELS_DIR"
