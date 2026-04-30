#!/usr/bin/env bash
set -uo pipefail
# NOTE: deliberately NOT `-e` — we want every probe to run; we count failures.
#
# backend/scripts/verify_phase2.sh
#
# One-command Phase 2 verification harness.
#
# Aggregates every probe declared in .planning/phases/02-backend-pipeline/02-VALIDATION.md
# across Wave 0 (system prereqs + python deps + fixtures + locked schema) through
# Wave 4 (golden fixtures + soak + tus interop).
#
# This file ships during Wave 0 (plan 02-03) with the Wave 0 sections wired up to
# the artifacts produced by 02-01 and 02-02. Sections for Waves 1-4 are present as
# `skip` placeholders so the script exits 0 today AND becomes truthful as later
# plans (02-04, 02-05, 02-06, 02-08, 02-09) extend each placeholder into a real
# probe. Plan 02-09 closes the loop by replacing the final placeholders with the
# soak/golden/tunnel probes.
#
# Usage:
#   bash backend/scripts/verify_phase2.sh           # full suite
#   bash backend/scripts/verify_phase2.sh --quick   # fast subset (skips golden/soak/tus)
#
# Exit 0 = phase verifies; non-zero = number of probe failures.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

QUICK=0
if [ "${1:-}" = "--quick" ]; then
  QUICK=1
fi

FAIL_COUNT=0
PASS_COUNT=0

# ── Color output ──────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_GREEN=$(printf '\033[32m'); C_RED=$(printf '\033[31m'); C_YELLOW=$(printf '\033[33m'); C_OFF=$(printf '\033[0m')
else
  C_GREEN=""; C_RED=""; C_YELLOW=""; C_OFF=""
fi

pass()    { printf "  ${C_GREEN}\xE2\x9C\x93${C_OFF} %s\n" "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail()    { printf "  ${C_RED}\xE2\x9C\x97${C_OFF} %s\n" "$1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
skip()    { printf "  ${C_YELLOW}-${C_OFF} %s (skipped: %s)\n" "$1" "$2"; }
section() { printf "\n${C_GREEN}==${C_OFF} %s\n" "$1"; }

# ══════════════════════════════════════════════════════════════════════════
# Section 1 — Wave 0: System prereqs (PASS today)
# ══════════════════════════════════════════════════════════════════════════
section "Wave 0 — System prereqs (ffmpeg, Vulkan, cmake, psql, glslc, whisper-cli, models)"

if command -v ffmpeg >/dev/null 2>&1; then
  pass "ffmpeg installed"
else
  fail "ffmpeg not installed (run: bash backend/scripts/install_phase2_prereqs.sh)"
fi

if command -v ffprobe >/dev/null 2>&1; then
  pass "ffprobe installed"
else
  fail "ffprobe not installed (ships with ffmpeg)"
fi

if command -v vulkaninfo >/dev/null 2>&1; then
  pass "vulkaninfo installed"
else
  fail "vulkaninfo not installed (apt install vulkan-tools)"
fi

if command -v cmake >/dev/null 2>&1; then
  pass "cmake installed"
else
  fail "cmake not installed (apt install cmake)"
fi

if command -v psql >/dev/null 2>&1; then
  pass "psql installed"
else
  fail "psql not installed (apt install postgresql-client)"
fi

if command -v glslc >/dev/null 2>&1; then
  pass "glslc installed"
else
  fail "glslc not installed (apt install glslc — needed by whisper.cpp Vulkan build)"
fi

if command -v vulkaninfo >/dev/null 2>&1 && vulkaninfo --summary 2>&1 | grep -qi amd; then
  pass "vulkaninfo enumerates an AMD device"
else
  fail "vulkaninfo does not enumerate an AMD device (check mesa-vulkan-drivers / RX 6600 connected)"
fi

WHISPER_CLI="$HOME/.transcribe/build/whisper.cpp/build/bin/whisper-cli"
if [ -x "$WHISPER_CLI" ]; then
  pass "whisper-cli built and executable at \$HOME/.transcribe/build/whisper.cpp/build/bin/whisper-cli"
else
  fail "whisper-cli not built (run: bash backend/scripts/build_whisper_cpp.sh)"
fi

if [ -x "$WHISPER_CLI" ] && (ldd "$WHISPER_CLI" 2>/dev/null | grep -qi libvulkan || strings "$WHISPER_CLI" 2>/dev/null | grep -qi ggml_vulkan); then
  pass "whisper-cli built with Vulkan backend"
else
  fail "whisper-cli not built with Vulkan backend (rebuild with -DGGML_VULKAN=1)"
fi

for m in small medium large-v3-turbo; do
  if [ -f "$HOME/.transcribe/models/ggml-${m}.bin" ]; then
    pass "ggml-${m}.bin present"
  else
    fail "ggml-${m}.bin missing (run: bash backend/scripts/download_models.sh)"
  fi
done

# OPTS-07: Slow preset gated off — large-v3 (non-turbo) must NOT be downloaded
if [ ! -f "$HOME/.transcribe/models/ggml-large-v3.bin" ]; then
  pass "Slow preset gated off (large-v3 NOT downloaded)"
else
  fail "Slow preset NOT gated off — ggml-large-v3.bin is present (OPTS-07 requires it stay absent on 8GB host)"
fi

# ══════════════════════════════════════════════════════════════════════════
# Section 2 — Wave 0: Python deps + config + sysfs (PASS today)
# ══════════════════════════════════════════════════════════════════════════
section "Wave 0 — Python deps + config + sysfs probe + audio fixtures"

if [ -f backend/pyproject.toml ]; then
  for pkg in "pyannote.audio>=3.3.2" "torch>=2.4" "torchaudio>=2.4" "supabase>=2.5" "pyjwt\\[crypto\\]>=2.9" "jiwer>=4" "psutil>=6"; do
    # Strip backslash-escapes for the printable label
    label="${pkg//\\\[/[}"
    label="${label//\\\]/]}"
    if grep -qE "${pkg}" backend/pyproject.toml; then
      pass "pyproject.toml has ${label}"
    else
      fail "pyproject.toml missing ${label}"
    fi
  done

  if ! grep -qE '^[[:space:]]*#.*Phase 2 will add' backend/pyproject.toml; then
    pass "TODO 'Phase 2 will add' comment removed from pyproject.toml"
  else
    fail "pyproject.toml still contains '# Phase 2 will add' placeholder comment"
  fi
else
  fail "backend/pyproject.toml missing"
fi

if [ -f backend/uv.lock ]; then
  if ! grep -qE '^version = "[0-9.]+\+cu' backend/uv.lock; then
    pass "uv.lock has no CUDA torch wheel (no +cuXXX version pins)"
  else
    fail "uv.lock contains a CUDA torch wheel (+cuXXX) — should be CPU-only torch on this host"
  fi
else
  fail "backend/uv.lock missing"
fi

if [ -f .env.example ]; then
  for k in WHISPER_BIN_PATH MODELS_DIR UPLOADS_DIR WORK_DIR \
           MODEL_SMALL_SHA256 MODEL_MEDIUM_SHA256 MODEL_TURBO_SHA256 \
           ENABLE_SLOW_PRESET; do
    if grep -q "^${k}=" .env.example; then
      pass ".env.example has ${k}="
    else
      fail ".env.example missing ${k}="
    fi
  done

  # Memory feedback_secret_hygiene: .env.example must contain no real key material.
  # Real keys have ≥20 alphanumeric/_-/. chars after the prefix; format-description
  # placeholders like `sb_secret_<base64ish>` or `hf_<34+ alphanumeric chars>` are
  # explicitly allowlisted because they contain literal `<`/`+` punctuation.
  if ! grep -qE '(sb_secret_[A-Za-z0-9._-]{20,}|hf_[A-Za-z0-9]{30,})' .env.example; then
    pass ".env.example contains no real key material"
  else
    fail ".env.example appears to contain a real Supabase service key or HF token (CHECK + ROTATE)"
  fi
else
  fail ".env.example missing"
fi

if [ -f backend/app/platform/memory.py ] && [ -f backend/app/platform/__init__.py ]; then
  pass "backend/app/platform/{memory.py,__init__.py} present"
else
  fail "backend/app/platform/memory.py or __init__.py missing (Wave 0 plan 02-02)"
fi

# Inline sysfs import probe — only if uv is available and the module exists
if [ -f backend/app/platform/memory.py ] && command -v uv >/dev/null 2>&1; then
  if (cd backend && uv run python -c "from app.platform.memory import find_amd_card_dir, vram_used_bytes, vram_total_bytes, host_rss_mb; c=find_amd_card_dir(); assert vram_used_bytes(c) < vram_total_bytes(c)" >/dev/null 2>&1); then
    pass "memory.py sysfs probe works on this host (vram_used < vram_total)"
  else
    fail "memory.py sysfs probe failed — check find_amd_card_dir() and /sys/class/drm/cardN/device/mem_info_vram_*"
  fi
else
  skip "memory.py sysfs import probe" "uv not available or backend/app/platform/memory.py missing"
fi

if [ -f backend/tests/conftest.py ] \
   && grep -q 'def mock_engine' backend/tests/conftest.py \
   && grep -q 'def real_pipeline' backend/tests/conftest.py; then
  pass "conftest.py extended with mock_engine + real_pipeline fixtures"
else
  fail "backend/tests/conftest.py missing mock_engine or real_pipeline fixture (Wave 0 plan 02-02)"
fi

for name in clean_english_30s two_speakers_45s noisy_english_30s non_english_es_30s one_word_silence_15s; do
  base="backend/tests/fixtures/audio/${name}"
  if [ -f "${base}.wav" ] && [ -f "${base}.ref.txt" ] && [ -f "${base}.ref.json" ]; then
    pass "fixture set ${name} present (.wav + .ref.txt + .ref.json)"
  else
    fail "fixture set ${name} incomplete or missing under backend/tests/fixtures/audio/"
  fi
done

# Each .wav must be 16 kHz mono PCM s16le (canonical input shape for whisper.cpp).
# ffprobe orders stream-fields by stream-attribute order (codec, then sample_rate,
# then channels), not by `-show_entries` order, so probe each field individually.
if command -v ffprobe >/dev/null 2>&1 && ls backend/tests/fixtures/audio/*.wav >/dev/null 2>&1; then
  for f in backend/tests/fixtures/audio/*.wav; do
    codec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$f" 2>/dev/null)
    rate=$(ffprobe  -v error -select_streams a:0 -show_entries stream=sample_rate -of csv=p=0 "$f" 2>/dev/null)
    chans=$(ffprobe -v error -select_streams a:0 -show_entries stream=channels    -of csv=p=0 "$f" 2>/dev/null)
    if [ "$codec" = "pcm_s16le" ] && [ "$rate" = "16000" ] && [ "$chans" = "1" ]; then
      pass "$(basename "$f"): 16 kHz mono PCM s16le"
    else
      fail "$(basename "$f"): wrong format (got codec=${codec} rate=${rate} chans=${chans}, expected pcm_s16le/16000/1)"
    fi
  done
else
  skip "WAV format probe (16 kHz mono pcm_s16le)" "ffprobe missing or no fixtures present"
fi

# ══════════════════════════════════════════════════════════════════════════
# Section 3 — Wave 0: Locked schema + JSON probe (PASS today)
# ══════════════════════════════════════════════════════════════════════════
section "Wave 0 — Locked transcript JSON schema + probe tool"

if [ -f docs/DEPENDENCIES.md ] && grep -q 'output-json-full schema' docs/DEPENDENCIES.md; then
  pass "JSON schema locked in docs/DEPENDENCIES.md ('output-json-full schema' marker present)"
else
  fail "docs/DEPENDENCIES.md missing the 'output-json-full schema' lock marker"
fi

if [ -f docs/DEPENDENCIES.md ] && grep -q 'v1.8.4' docs/DEPENDENCIES.md; then
  pass "whisper.cpp v1.8.4 pin recorded in docs/DEPENDENCIES.md"
else
  fail "docs/DEPENDENCIES.md missing whisper.cpp v1.8.4 pin"
fi

if [ -x tools/probe_whisper_json.sh ]; then
  pass "tools/probe_whisper_json.sh exists and is executable"
else
  fail "tools/probe_whisper_json.sh missing or not executable (Wave 0 deliverable)"
fi

# ══════════════════════════════════════════════════════════════════════════
# Section 4 — Wave 1: Routes + TUS server
# ══════════════════════════════════════════════════════════════════════════
section "Wave 1 — Routes + TUS server"

if cd backend && MOCK_ENGINE=1 \
   WHISPER_BIN_PATH="$HOME/.transcribe/build/whisper.cpp/build/bin/whisper-cli" \
   MODELS_DIR="$HOME/.transcribe/models" \
   uv run pytest tests/test_jobs.py -x --tb=line -q >/tmp/vp2_jobs.log 2>&1; then
  pass "POST /jobs route + cleanup (mock-engine)"
else
  fail "POST /jobs tests failed (see /tmp/vp2_jobs.log)"
fi
cd "$REPO_ROOT"

if cd backend && MOCK_ENGINE=1 \
   WHISPER_BIN_PATH="$HOME/.transcribe/build/whisper.cpp/build/bin/whisper-cli" \
   MODELS_DIR="$HOME/.transcribe/models" \
   uv run pytest tests/test_tus.py -x --tb=line -q >/tmp/vp2_tus.log 2>&1; then
  pass "TUS protocol conformance (mock-engine)"
else
  fail "TUS tests failed (see /tmp/vp2_tus.log)"
fi
cd "$REPO_ROOT"

if cd backend && MOCK_ENGINE=1 \
   WHISPER_BIN_PATH="$HOME/.transcribe/build/whisper.cpp/build/bin/whisper-cli" \
   MODELS_DIR="$HOME/.transcribe/models" \
   uv run pytest tests/test_readyz_gating.py -x --tb=line -q >/tmp/vp2_readyz.log 2>&1; then
  pass "/readyz exposes vulkan_device + presets_available (OPTS-07 slow gated off)"
else
  fail "/readyz tests failed (see /tmp/vp2_readyz.log)"
fi
cd "$REPO_ROOT"

# ══════════════════════════════════════════════════════════════════════════
# Section 5 — Wave 2: Pipeline modules
# ══════════════════════════════════════════════════════════════════════════
section "Wave 2 — Pipeline modules"

if cd backend && uv run pytest \
     tests/test_pipeline_normalize.py \
     tests/test_pipeline_merge.py \
     tests/test_presets.py \
     tests/test_lifecycle.py \
     tests/test_pipeline_transcribe_helpers.py \
     tests/test_pipeline_diarize_imports.py \
     -x --tb=line -q >/tmp/vp2_pipeline.log 2>&1; then
  pass "Pipeline unit tests (normalize / merge / presets / lifecycle / transcribe-helpers / diarize-imports)"
else
  fail "Pipeline unit tests failed (see /tmp/vp2_pipeline.log)"
fi
cd "$REPO_ROOT"

# ══════════════════════════════════════════════════════════════════════════
# Section 6 — Wave 3 + 4: Queue + integration + golden + soak + tunnel
# ══════════════════════════════════════════════════════════════════════════
section "Wave 3 — Queue + integration"

if cd backend && MOCK_ENGINE=1 \
   WHISPER_BIN_PATH="$HOME/.transcribe/build/whisper.cpp/build/bin/whisper-cli" \
   MODELS_DIR="$HOME/.transcribe/models" \
   uv run pytest tests/test_queue.py tests/test_no_storage_uploads.py \
   -x --tb=line -q >/tmp/vp2_queue.log 2>&1; then
  pass "Queue + worker (gpu_lock + OPS-06 + SEC-08 sentinel)"
else
  fail "Queue tests failed (see /tmp/vp2_queue.log)"
fi
cd "$REPO_ROOT"

if [ "$QUICK" = "1" ]; then
  skip "Golden-fixture WER thresholds (TEST-01, gpu)" "--quick mode"
  skip "20-job memory soak (TEST-04, gpu+slow)" "--quick mode"
  skip "tus-js-client interop through Cloudflare tunnel (manual)" "--quick mode"
else
  section "Wave 4 — Acceptance (gpu)"
  # Detect collectible gpu/slow tests FIRST. If none collected, this is a skip
  # (HF_TOKEN missing or whisper-cli unbuilt), not a failure. The
  # collection-first idiom is robust: pytest exit 5 = "no tests collected"
  # has a single deterministic meaning, unlike substring-grepping the log.
  if ! ( cd backend && uv run pytest --co -q -m "gpu or slow" \
         tests/test_pipeline_transcribe.py 2>&1 | grep -q "test_" ); then
    skip "Golden-fixture WER + real pyannote diarize" "no gpu tests collected (HF_TOKEN missing or whisper-cli unbuilt)"
  else
    cd backend && uv run pytest \
      tests/test_pipeline_transcribe.py tests/test_pipeline_diarize.py \
      -m "gpu or slow" -x --tb=short >/tmp/vp2_gpu.log 2>&1
    case $? in
      0)  pass "Golden-fixture WER + real pyannote diarize (gpu/slow)" ;;
      5)  skip "Golden-fixture WER + real pyannote diarize" "no tests matched the gpu/slow markers (see /tmp/vp2_gpu.log)" ;;
      *)  fail "Golden-fixture WER tests failed (see /tmp/vp2_gpu.log)" ;;
    esac
    cd "$REPO_ROOT"
  fi

  skip "20-job memory soak (TEST-04)" "operator-driven; run: cd backend && uv run pytest tests/test_soak.py -m 'gpu and slow' -x -s"
  skip "tus-js-client interop through Cloudflare tunnel" "operator-driven; open tools/tus_interop_test.html?endpoint=\$(cat ~/.transcribe/tunnel-url)/uploads"
fi

# ══════════════════════════════════════════════════════════════════════════
# Manual reminders for Phase 2
# ══════════════════════════════════════════════════════════════════════════
section "Manual reminders for Phase 2"
printf "  ${C_YELLOW}-${C_OFF} If verify_phase2.sh fails after Wave 0, re-run:\n"
printf "      bash backend/scripts/install_phase2_prereqs.sh\n"
printf "      bash backend/scripts/build_whisper_cpp.sh\n"
printf "      bash backend/scripts/download_models.sh\n"
printf "      cd backend && uv sync\n"
printf "  ${C_YELLOW}-${C_OFF} HuggingFace pyannote license accepted in Phase 1; if Wave 2 diarize 401s, re-accept at huggingface.co/pyannote/{segmentation-3.0,speaker-diarization-3.1}\n"
printf "  ${C_YELLOW}-${C_OFF} Soak (TEST-04) and TUS-tunnel interop (CORE-04 manual) are operator-driven; run them per the README 'Backend (Phase 2)' section\n"

# ══════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════
section "Summary"
printf "  Passed: ${C_GREEN}%d${C_OFF}\n" "$PASS_COUNT"
printf "  Failed: ${C_RED}%d${C_OFF}\n" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -eq 0 ]; then
  printf "\n${C_GREEN}verify_phase2.sh: PASS${C_OFF}\n"
else
  printf "\n${C_RED}verify_phase2.sh: FAIL${C_OFF} (%d failures)\n" "$FAIL_COUNT"
fi
exit "$FAIL_COUNT"
