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
