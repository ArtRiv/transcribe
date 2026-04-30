# Pinned Dependency Matrix

Phase 1 only documents these. Phase 2 builds whisper.cpp and installs the Python deps.

## Note on the Engine Pivot

The post-pivot reality (locked 2026-04-27) is: hardware = AMD Radeon RX 6600 (8 GB VRAM, RDNA2) on Ubuntu 26.04 LTS; engine = `whisper.cpp` with the Vulkan backend (ASR) + `pyannote.audio` 3.x on CPU (diarization). This stack **supersedes** the CUDA stack referenced in REQUIREMENTS.md REPO-05 (cuDNN, torch+cu124, ctranslate2, WhisperX) per the 2026-04-27 engine pivot in [`.planning/research/SUMMARY.md`](../.planning/research/SUMMARY.md) "Amendment 2026-04-27 — Engine Pivot". Treat the bracket-CUDA list in REPO-05 as REPLACED, not extended.

## System Packages (Ubuntu 26.04 apt)

| Package | Version pin | Purpose |
|---|---|---|
| `mesa-vulkan-drivers` | apt-distributed (Ubuntu 26.04 default) | RADV Vulkan driver for AMD RDNA2 |
| `libvulkan1` | apt-distributed | Vulkan runtime loader |
| `libvulkan-dev` | 1.4.341.0-1 | Vulkan headers (build-time) |
| `vulkan-tools` | 1.4.341.0+dfsg1-1 | `vulkaninfo` CLI |
| `glslang-tools` | apt-distributed | GLSL shader compiler |
| `libshaderc-dev` | apt-distributed | Shaderc runtime shader compilation |
| `build-essential` | apt-distributed | gcc/g++/make for whisper.cpp build |
| `cmake` | >= 3.20 (apt) | whisper.cpp build system |
| `git` | apt-distributed | Source clone |
| `ffmpeg` | >= 6.0 (apt) | Audio normalization (Phase 2) |
| `cloudflared` | 2026.3.0 (Cloudflare apt repo) | Quick Tunnel client (OPS-03) |
| `gitleaks` | 8.30.1 (binary from GitHub releases) | Pre-commit secret scanner (SEC-05) |
| `supabase` (CLI) | 2.90.0 (.deb from GitHub releases) | Migrations + db push |
| ~~`amdgpu-pro`~~ | **DO NOT INSTALL** | Mesa RADV outperforms AMDVLK on RDNA2 [CITED: SUMMARY.md amendment] |

## whisper.cpp build (Phase 2 deliverable; documented here for REPO-05)

```bash
git clone --branch v1.8.4 --depth 1 https://github.com/ggml-org/whisper.cpp ~/Code/whisper.cpp
cd ~/Code/whisper.cpp
cmake -B build -DGGML_VULKAN=ON -DGGML_HIPBLAS=OFF -DGGML_HIP=OFF -DGGML_CUDA=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build build -j --config Release
```

Pinned tag `v1.8.4` (NOT `master`) — Phase 2 reproducibility.

## Python (uv-managed) — Phase 2 will pin in pyproject.toml

| Package | Pin | Purpose |
|---|---|---|
| Python | `>=3.11,<3.12` (3.11.x) | Runtime (whisper.cpp Python bindings + pyannote 3.x tested on 3.11) |
| `fastapi[standard]` | `>=0.136.0` | HTTP framework |
| `uvicorn` | `>=0.46.0` | ASGI server |
| `pydantic-settings` | `>=2.14.0` | Env-var loading |
| `supabase` (supabase-py) | `>=2.0` | Service-role-key DB writes |
| `pyannote.audio` | `>=3.3.2,<4.0` | Diarization (CPU); 4.x INCOMPATIBLE with the rest of the stack |
| `slowapi` | `>=0.1.9` | Rate limiting (Phase 5) |
| `tus-server` (or chosen TUS lib) | TBD Phase 2 | Chunked upload |
| `sse-starlette` | `>=2.0` | Dev/fallback progress channel |
| `pyjwt[crypto]` | `>=2.9,<3.0` | JWT verification (Phase 4) |
| `ruff` | `>=0.15.12` | Linter + formatter |
| `pytest` + `pytest-asyncio` + `asgi-lifespan` + `httpx` | Latest stable | Backend tests |
| `jiwer` | `>=4.0` | WER thresholds (Phase 2) |

## Node (pnpm-managed) — frontend/package.json

| Package | Pin | Purpose |
|---|---|---|
| Node.js | 22.x LTS (host: 22.22.1) | Runtime |
| pnpm | 10.33.2 | Package manager |
| Next.js | 16.x (current stable) | Framework — supersedes the "Next.js 15" mention in older docs (OQ-1 resolved per planning context) |
| React | 19.x | (Comes with Next.js 16) |
| TypeScript | 5.6+ | Type system |
| Tailwind CSS | 4.x | Styling |
| shadcn/ui | latest (vendored) | UI primitives |
| `@supabase/ssr` | 0.7.x or 0.10.x (latest 0.x) | Auth (Phase 4) — replaces dead `@supabase/auth-helpers-nextjs` |
| `tus-js-client` | 4.x | Chunked upload (Phase 3) |
| Zustand | 5.x | Editor state |
| `@tanstack/react-query` | 5.x | Data fetching |
| Vitest | 2.x | Unit tests (Phase 3) |
| Playwright | 1.5x | E2E (Phase 4) |

## Model files (Phase 2 downloads; documented here)

`ggml-medium.bin` (~1.5 GB) and optionally `ggml-large-v3-turbo.bin` (~1.6 GB) come from <https://huggingface.co/ggerganov/whisper.cpp>. Phase 2 wires the binary path via `WHISPER_MODEL_PATH` in `.env.example`; SHA-256 will be pinned there once a specific build is chosen during the Phase 2 model-download spike. Diarization uses pyannote checkpoints gated by `HF_TOKEN` (also placeholdered in `.env.example`); the user must accept the license on `pyannote/segmentation-3.0` and `pyannote/speaker-diarization-3.1` model pages before first run.

## Verification

```bash
vulkaninfo --summary | grep -i "AMD Radeon"   # Phase 2 verifies; Phase 1 just documents
cloudflared --version
supabase --version
gitleaks version
```

## Phase 2 build pins (locked 2026-04-27)

### whisper.cpp
- Tag: `v1.8.4`
- Commit SHA: `9386f239401074690479731c1e41683fbbeac557`
- Built with: `cmake -B build -DGGML_VULKAN=1 -DCMAKE_BUILD_TYPE=Release`
- Build path on this host: `~/.transcribe/build/whisper.cpp/build/bin/whisper-cli`

### GGML model SHA-256 pins
- `ggml-large-v3-turbo.bin`: `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69`
- `ggml-medium.bin`: `6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208`
- `ggml-small.bin`: `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`
- `ggml-large-v3.bin`: NOT downloaded — Slow preset gated off on 8 GB host (OPTS-07)

### Vulkan runtime probe (2026-04-28)

`whisper-cli` v1.8.4 in this repo does NOT expose a `--list-devices` flag. The
ggml Vulkan backend logs the enumerated devices to stderr on init. Probed by
running `whisper-cli -m ggml-small.bin -f samples/jfk.wav` and observing:

```
ggml_vulkan: Found 1 Vulkan devices:
ggml_vulkan: 0 = AMD Radeon RX 6600 (RADV NAVI23) (radv) | uma: 0 | fp16: 1 | bf16: 0 | warp size: 32 | shared memory: 65536 | int dot: 1 | matrix cores: none
whisper_backend_init_gpu: using Vulkan0 backend
```

So Vulkan is correctly compiled in and the Mesa RADV driver enumerates the
RX 6600 as `Vulkan0`. The Wave 0 verifier (`backend/scripts/verify_phase2.sh`)
should grep for `ggml_vulkan: Found .* Vulkan devices` rather than
`--list-devices` output.

## whisper.cpp --output-json-full schema (locked Wave 0)

Probe run on **2026-04-28** against `ggml-small.bin` + `samples/jfk.wav`,
using whisper.cpp `v1.8.4` (commit `9386f239401074690479731c1e41683fbbeac557`).
Reproduce with `bash tools/probe_whisper_json.sh`.

### Top-level keys

```
[
  "model",         // model metadata (audio dims, ftype, mels, multilingual, text, type, vocab)
  "params",        // invocation params (language, model, translate)
  "result",        // result-level metadata: { "language": "en" }
  "systeminfo",    // build/runtime banner string
  "transcription"  // array of segment objects — the load-bearing field for Wave 2
]
```

### `transcription[i]` (segment) keys

```
[
  "offsets",       // { "from": <ms_int>, "to": <ms_int> }   — milliseconds since clip start
  "text",          // string — the segment text (with leading space)
  "timestamps",    // { "from": "HH:MM:SS,mmm", "to": "HH:MM:SS,mmm" } — SRT-style HMS strings
  "tokens"         // array of token objects (see below)
]
```

### `transcription[i].tokens[j]` (token) keys

```
[
  "id",            // int — vocab token id
  "offsets",       // { "from": <ms_int>, "to": <ms_int> } — token-level millisecond span
  "p",             // float in [0, 1] — token probability
  "t_dtw",         // int — DTW timestamp; -1 when DTW disabled (the default)
  "text",          // string — token text (special tokens shown as e.g. "[_BEG_]")
  "timestamps"     // { "from": "HH:MM:SS,mmm", "to": "HH:MM:SS,mmm" }
]
```

### Wave 2 parser implications (locks A1)

- The segment array lives at top-level key **`transcription`** (NOT `segments`).
  RESEARCH.md §641-668 had this as MEDIUM-confidence — now LOCKED.
- Use **`offsets.from` / `offsets.to`** (integer milliseconds) for numeric math,
  not the `timestamps` HMS strings (which are formatting-only).
- Tokens carry per-token confidence as **`p`** (NOT `confidence` / `prob`).
- `t_dtw == -1` is the normal "DTW disabled" sentinel — Wave 2 should treat it
  as "no token-time-distortion data available," not as a missing field.
- Special-token markers (`[_BEG_]`, `[_TT_<n>_]`, `[_EOT_]`) appear in the
  `text` field of token entries with `id >= 50257`. Wave 2's `_normalize_payload`
  in `backend/app/pipeline/transcribe.py` MUST filter these out of `segments[i].words`
  before persisting (otherwise they leak into the editor UI).
- The `result.language` field is the auto-detected language; carry it into
  `transcript.metadata.language` (CORE-04).

If a future whisper.cpp release changes any of these key names, update this
section AND `_normalize_payload` in the same commit. Reference probe:
`tools/probe_whisper_json.sh`.
