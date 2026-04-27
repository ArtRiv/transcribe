# Transcribe — Claude Project Context

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Transcribe** is a free, self-hostable web app that turns long audio/video into editable, speaker-labeled transcripts using OpenAI's Whisper running locally on the developer's own GPU. Built primarily so a friend can read instead of listen to long work recordings, and as a public Python/Next.js portfolio piece.

**Core Value:** Turn long, skim-hostile audio/video into accurate, speaker-labeled, editable transcripts with **zero ongoing cost** to operate.

**Hard constraint:** $0/month recurring. If hosting cost ever creeps in, the project has failed its premise. No paid GPU hosts, no per-minute API fees, no paid SaaS — only free tiers (Vercel, Supabase, Cloudflare).

**Operational shape:** Frontend on Vercel free; backend (FastAPI + WhisperX) on the developer's home GPU; public exposure via Cloudflare Tunnel free with a named tunnel + custom domain. The public URL works only while the host PC is awake — that's accepted, not a bug.

See `.planning/PROJECT.md` for the full project definition (validated/active/out-of-scope requirements, key decisions, evolution rules).
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

**Hardware (host):** AMD Radeon RX 6600 (8 GB VRAM, RDNA2) on Ubuntu 26.04 LTS.

**Frontend (Vercel free):** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind 4 · shadcn/ui · `@supabase/ssr` 0.7.x · Zustand · @tanstack/react-query · `tus-js-client` 4.x · Vitest · Playwright · pnpm.

**Backend (developer's machine):** Python 3.11 · FastAPI ≥0.115 · **whisper.cpp** with Vulkan backend (ASR; via `pywhispercpp` or subprocess to `whisper-cli`) · **pyannote.audio ≥3.3.2,<4 on CPU** (diarization) · ffmpeg ≥6 · supabase-py 2.x · PyJWT[crypto] · sse-starlette (dev only) · slowapi · pytest + pytest-asyncio + asgi-lifespan · jiwer · ruff · uv.

**Data plane (Supabase free):** Postgres + Auth (JWKS) + Realtime + Storage (transcript JSON only — never source media).

**Public exposure:** Cloudflare Quick Tunnel (`trycloudflare.com`) — hostname changes on restart; Vercel env update + redeploy is part of the documented operational workflow.

**Critical pinning / setup:**
- `pyannote.audio<4` (the 4.x release is incompatible with the rest of the diarization stack); explicitly pin `pipeline.to(torch.device("cpu"))` after instantiation
- whisper.cpp built with `-DGGML_VULKAN=1`; depends on Mesa Vulkan (`mesa-vulkan-drivers`, `libvulkan-dev`, `vulkan-tools`) — NOT the proprietary `amdgpu-pro` driver
- `@supabase/auth-helpers-nextjs` is dead — use `@supabase/ssr`
- whisper.cpp model files (GGML/GGUF) — pin SHA-256 in `.env.example`
- Engine pivot is documented in `.planning/research/SUMMARY.md` "Amendment 2026-04-27"

See `.planning/research/STACK.md` for the original CUDA-stack research (now superseded for the engine + tunnel layers; the rest stands).
<!-- GSD:stack-end -->

<!-- GSD:architecture-start source:research/ARCHITECTURE.md -->
## Architecture

The architecture has two **load-bearing decisions locked during research** that should not be relitigated without a new research trigger:

1. **Upload path = TUS chunked direct to FastAPI** (chunk ≤ 90 MB), through Cloudflare Tunnel. **Not** Supabase Storage (50 MB free-tier cap), **not** plain POST through Vercel (4.5 MB function body cap, 60 s timeout). Source media is transient — deleted from disk after the job completes.
2. **Progress channel = Supabase Realtime** (Postgres Changes on the `jobs` row). **Not** SSE through Cloudflare Tunnel (cloudflared #199 / #1449 — buffering causes the bar to sit at 0% then jump to 100%). The FastAPI worker writes progress to Postgres; Supabase Realtime pushes updates over its own WebSocket directly to the browser, bypassing the tunnel.

**Other locked decisions:**
- Job queueing: `asyncio.Queue` + `asyncio.Lock` + single background worker in FastAPI lifespan. No Redis/Celery for v1.
- Model lifecycle: WhisperX models load once at lifespan startup; held in VRAM for process lifetime; `torch.cuda.empty_cache()` between jobs.
- Transcript persistence: single `jsonb` payload column per row (not row-per-segment).
- Service-role key never leaves the FastAPI host. Vercel only sees the anon key. RLS is enforced.
- Frontend transcript editor: roll-your-own with shadcn primitives + `useReducer`/Zustand. Not Tiptap/Lexical/Slate (transcripts are structural data, not prose).
- Browser calls FastAPI directly via `NEXT_PUBLIC_BACKEND_URL` — Vercel functions are not in the transcription data path (60s timeout would 504).
- All exports (.txt, .srt, .vtt, .json, .md) rendered client-side from the in-memory payload.

**Repo layout (monorepo):**
```
transcribe/
  frontend/       # Next.js 15 (deploys to Vercel)
  backend/        # FastAPI + WhisperX (runs on home GPU)
  supabase/       # Migrations + RLS
  .planning/      # GSD planning artifacts
  CLAUDE.md       # This file
  README.md
```

See `.planning/research/ARCHITECTURE.md` and `.planning/research/SUMMARY.md` for full data flows, schema sketch, and conflict resolutions.
<!-- GSD:architecture-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

- **Commits:** Conventional Commits style (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`). The `main` branch must read cleanly to a portfolio reviewer — no `wip` / `fix typo` noise.
- **Secrets:** Never commit `.env*` (only `.env.example`). Pre-commit secret scanner (gitleaks/detect-secrets) runs before every commit. Service-role Supabase key never appears in any `NEXT_PUBLIC_*` variable, Vercel env, or committed file.
- **Python:** `uv` for env + lockfile; `ruff` for lint + format; type hints required on public APIs.
- **TypeScript:** Strict mode; ESLint + Prettier (or Biome).
- **Database:** RLS `ENABLE`d in the same migration as `CREATE TABLE`. CI gate: `SELECT * FROM pg_tables WHERE schemaname='public' AND rowsecurity=false` must return zero rows.
- **Tests:** GPU-dependent backend tests marked `@pytest.mark.gpu` and skipped in CI. Mock-engine mode runs the same routes/queue tests without a GPU.

Conventions emerge as patterns settle; this section will grow.
<!-- GSD:conventions-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` — do not edit manually.
<!-- GSD:profile-end -->
