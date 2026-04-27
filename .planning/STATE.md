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

Decisions are logged in PROJECT.md Key Decisions table. Locked architectural decisions (from research/SUMMARY.md, NOT to be relitigated):

- **Upload path:** TUS chunked direct to FastAPI through Cloudflare Tunnel (≤ 90 MB chunks); NOT Supabase Storage (50 MB cap blocks meeting recordings)
- **Progress channel:** Supabase Realtime (Postgres Changes on `jobs`); NOT SSE through Cloudflare Tunnel (cloudflared buffers SSE — issues #199, #1449)
- **Job queue:** in-process `asyncio.Queue` + `asyncio.Lock`, NO Redis/Celery (single-host, single-GPU)
- **Service-role key perimeter:** only on FastAPI host; never on Vercel, never `NEXT_PUBLIC_*`
- **Transcript editor:** roll-your-own with shadcn primitives (transcript is structural data, not prose)
- **Average preset:** `large-v3-turbo` (~6 GB VRAM); Slow uses `large-v3` and is VRAM-gated at 12 GB

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 1 user-blocked inputs** (executor must collect before starting Phase 1):

- HF_TOKEN (HuggingFace read-scoped; both pyannote license pages must be accepted in a browser)
- GPU model + VRAM (gates OPTS-07 "Slow" preset advertisement)
- Host OS (Linux native vs Windows + WSL2 vs Windows native)
- Domain name for Cloudflare named tunnel (stable hostname; `*.trycloudflare.com` is NOT acceptable)
- Supabase project ref + `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`

**Spike candidates** (resolve during their phase):

- Phase 2: TUS chunked upload through Cloudflare Tunnel — verify on dev's actual network (90 MB chunk + 10 MB headroom under 100 MB CF cap)
- Phase 2: WhisperX 3.8.5 progress callback — does it expose per-batch progress, or is stage-level the only honest signal?

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none — first milestone)* | | | |

## Session Continuity

Last session: 2026-04-27
Stopped at: Roadmap created and ready for first phase planning
Resume file: None
