# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-27)

**Core value:** Turn long, skim-hostile audio/video into accurate, speaker-labeled, editable transcripts with zero ongoing cost to operate.
**Current focus:** Phase 1 — Foundation

## Current Position

Phase: 1 of 6 (Foundation)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-04-27 — Roadmap created (6 phases, 81/81 v1 requirements mapped)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: — (no data yet)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Locked architectural decisions (NOT to be relitigated):

- **Engine pivot (2026-04-27):** Hardware is AMD RX 6600 (8 GB VRAM) on Ubuntu 26.04 → CUDA-based stack (WhisperX, faster-whisper, ctranslate2) is unavailable. Replaced by **whisper.cpp + Vulkan** (GPU-accelerated ASR on AMD) + **pyannote on CPU** (diarization). All other locked decisions below survive the pivot.
- **Tunnel:** Cloudflare **Quick Tunnel** (`trycloudflare.com`) for v1 — accept hostname churn on restart, document the Vercel-env-update workflow. Named tunnel deferred until a domain is registered.
- **Upload path:** TUS chunked direct to FastAPI through Cloudflare Tunnel (≤ 90 MB chunks); NOT Supabase Storage (50 MB cap blocks meeting recordings)
- **Progress channel:** Supabase Realtime (Postgres Changes on `jobs`); NOT SSE through Cloudflare Tunnel (cloudflared buffers SSE — issues #199, #1449)
- **Job queue:** in-process `asyncio.Queue` + `asyncio.Lock`, NO Redis/Celery (single-host, single-GPU)
- **Service-role key perimeter:** only on FastAPI host; never on Vercel, never `NEXT_PUBLIC_*`
- **Transcript editor:** roll-your-own with shadcn primitives (transcript is structural data, not prose)
- **Quality presets (post-pivot):** Fast = whisper.cpp `small`/`base`; Average = `medium` (or `large-v3-turbo` if it fits 8 GB Vulkan); Slow = `large-v3`, gated off by default on 8 GB

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 1 user-supplied inputs (collected 2026-04-27):**

- ✓ `HF_TOKEN` captured (in gitignored `hf_token` file at repo root) — license-acceptance step on `pyannote/segmentation-3.0` and `pyannote/speaker-diarization-3.1` model pages still required by user before first diarization run
- ✓ GPU: AMD Radeon RX 6600 (8 GB VRAM, RDNA2) — locked
- ✓ Host OS: Ubuntu 26.04 LTS — locked
- ✓ Tunnel: Cloudflare Quick Tunnel (`trycloudflare.com`) — domain decision deferred
- ✓ Supabase URL + anon (publishable) + service-role (secret) keys captured (in gitignored `supabase` file at repo root)

**Spike candidates** (resolve during their phase):

- Phase 1: TUS chunked upload through Cloudflare Quick Tunnel — verify on dev's actual network (90 MB chunk + 10 MB headroom under 100 MB CF cap)
- Phase 2: whisper.cpp Vulkan throughput on RX 6600 — measure realtime factor for `small`, `medium`, `large-v3-turbo`, `large-v3` to validate which presets are actually usable
- Phase 2: pyannote-on-CPU diarization wall-time on a 90-min file — calibrate user-facing ETA

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none — first milestone)* | | | |

## Session Continuity

Last session: 2026-04-27
Stopped at: Roadmap created and ready for first phase planning
Resume file: None
