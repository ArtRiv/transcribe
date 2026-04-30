#!/usr/bin/env bash
# tools/probe_whisper_json.sh
#
# Wave 0 dry-run: invoke whisper-cli --output-json-full against a tiny test
# clip (samples/jfk.wav shipped with whisper.cpp) and print/save the actual
# emitted JSON so the Wave 2 parser in backend/app/pipeline/transcribe.py can
# be implemented against the REAL schema (locks RESEARCH.md A1 + the open
# question on token-level field names).
#
# This is a developer probe — NOT a backend module. It writes the JSON into a
# fresh mktemp dir (no user-controlled paths; T-02-01-PathTrav mitigation) and
# prints the schema keys to stdout. Re-running is deterministic against the
# same model file.
#
# See:
#   .planning/phases/02-backend-pipeline/02-RESEARCH.md §1514 (Wave 0 must dry-run)
#   .planning/phases/02-backend-pipeline/02-RESEARCH.md §1521 (assumption A1)
#   .planning/phases/02-backend-pipeline/02-CONTEXT.md (D1 — subprocess wrapper)

set -euo pipefail

WHISPER_BIN="${WHISPER_BIN_PATH:-$HOME/.transcribe/build/whisper.cpp/build/bin/whisper-cli}"
MODELS_DIR="${MODELS_DIR:-$HOME/.transcribe/models}"
MODEL="${MODELS_DIR}/ggml-small.bin"

if [ ! -x "$WHISPER_BIN" ]; then
  echo "ERROR: whisper-cli not found at $WHISPER_BIN. Run: bash backend/scripts/build_whisper_cpp.sh" >&2
  exit 1
fi
if [ ! -f "$MODEL" ]; then
  echo "ERROR: ggml-small.bin not found at $MODEL. Run: bash backend/scripts/download_models.sh" >&2
  exit 1
fi

# Use the JFK sample shipped with whisper.cpp (always present after build).
SAMPLE="$HOME/.transcribe/build/whisper.cpp/samples/jfk.wav"
if [ ! -f "$SAMPLE" ]; then
  echo "ERROR: $SAMPLE not present; whisper.cpp source tree is incomplete" >&2
  exit 1
fi

OUT_DIR="$(mktemp -d)"
OUT_BASE="$OUT_DIR/probe"

echo "[probe_whisper_json.sh] running: $WHISPER_BIN --model $MODEL --file $SAMPLE --output-json-full --output-file $OUT_BASE"
# whisper-cli silences progress output via --no-prints; --output-json-full
# emits both segment-level AND token-level data into <output-file>.json.
"$WHISPER_BIN" \
  --model "$MODEL" \
  --file  "$SAMPLE" \
  --output-json-full \
  --output-file "$OUT_BASE" \
  --no-prints \
  >/dev/null 2>&1 || {
    # Re-run without silencing so the operator sees the real failure.
    echo "ERROR: silent run failed; re-running with stderr visible" >&2
    "$WHISPER_BIN" \
      --model "$MODEL" \
      --file  "$SAMPLE" \
      --output-json-full \
      --output-file "$OUT_BASE" >&2
    exit 1
  }

JSON_FILE="${OUT_BASE}.json"
if [ ! -f "$JSON_FILE" ]; then
  echo "ERROR: expected JSON at $JSON_FILE but none produced" >&2
  exit 1
fi

echo "----- raw JSON keys (top level) -----"
if command -v jq >/dev/null; then
  jq 'keys' "$JSON_FILE"
  echo "----- transcription[0] keys -----"
  jq '.transcription[0] | keys' "$JSON_FILE" 2>/dev/null \
    || jq '.segments[0]    | keys' "$JSON_FILE" 2>/dev/null \
    || echo "(neither .transcription nor .segments at top level)"
  echo "----- transcription[0].tokens[0] keys (if present) -----"
  jq '.transcription[0].tokens[0] | keys' "$JSON_FILE" 2>/dev/null \
    || echo "(no tokens key found at expected path)"
  echo "----- result.language / model fields -----"
  jq '{result: .result, params_keys: (.params|keys)?, model_keys: (.model|keys)?}' "$JSON_FILE" 2>/dev/null \
    || true
else
  python3 -c "import json,sys; d=json.load(open('$JSON_FILE')); print(list(d.keys()))"
fi

echo
echo "[probe_whisper_json.sh] full JSON file kept at: $JSON_FILE"
echo "[probe_whisper_json.sh] copy this output into docs/DEPENDENCIES.md under the"
echo "                       'whisper.cpp --output-json-full schema (locked Wave 0)'"
echo "                       section so Wave 2 transcribe.py can be implemented"
echo "                       against the real shape."
