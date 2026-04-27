# Architecture Research

**Domain:** Free, self-hostable web app — long audio/video → speaker-labeled transcripts via local-GPU WhisperX
**Researched:** 2026-04-27
**Confidence:** HIGH (most decisions verified against official docs and known platform quirks; a few items flagged MEDIUM where they depend on operator preference)

---

## TL;DR (for the roadmapper)

- **Three deployments, one repo:** Next.js on Vercel, FastAPI on the home machine behind `cloudflared`, Supabase as the data plane. They are loosely coupled — the frontend talks to FastAPI directly through the tunneled hostname, and to Supabase directly for auth/storage/realtime.
- **Progress reporting flows through Supabase Realtime, not through the tunnel.** Cloudflare Tunnel has documented SSE buffering issues and a 100s idle WebSocket timeout on the free tier. Routing job-progress events through a Supabase `jobs` table that both backend and frontend subscribe to sidesteps the tunnel entirely.
- **Uploads go directly to Supabase Storage via signed upload URL,** not through the tunnel and not through Vercel. This avoids Vercel's 4.5 MB function-body limit, avoids tunneling huge multipart bodies, and gives the backend a stable URL to pull from.
- **Job queue is `asyncio.Queue` + a single worker task, not Redis.** Single-job-at-a-time on a single host with $0 budget makes Redis dead weight. The `jobs` table in Postgres is the durable record.
- **Transcripts are stored as a single `jsonb` payload per transcript row, not as one row per segment.** A transcript is read-and-write as a whole document; segment-level relational queries aren't a use case here.
- **WhisperX models are loaded once at FastAPI startup and held in VRAM for the process lifetime.** Re-loading per request would dominate latency and is the most common WhisperX-in-FastAPI mistake.

---

## System Overview

```
                            ┌──────────────────┐
                            │     Browser      │
                            │  (Next.js app)   │
                            └────┬─────┬───────┘
                                 │     │
        ┌────────────────────────┘     └─────────────────────────┐
        │ (1) Auth, (2) signed upload URL,                       │
        │ (3) Realtime subscribe to jobs/transcripts             │
        ▼                                                        │
┌──────────────────┐                                             │
│  Supabase Cloud  │ ◄─── (4) backend writes job/transcript ──┐  │
│  Postgres        │                                          │  │
│  Auth (JWKS)     │                                          │  │
│  Storage         │ ◄─── (5) backend pulls audio file ────┐  │  │
│  Realtime (WS)   │                                       │  │  │
└──────────────────┘                                       │  │  │
        ▲                                                  │  │  │
        │ (3) WS subscribe (UPDATE events on jobs)         │  │  │
        │                                                  │  │  │
        │                                                  │  │  │
                                                           │  │  │
                                            ┌──────────────┴──┴──┴──┐
                                            │  Vercel (frontend)    │
                                            │  Next.js App Router   │
                                            │  Server Actions       │
                                            └───────────┬───────────┘
                                                        │ (6) POST /jobs
                                                        │     {storage_key, opts}
                                                        ▼
                                       ┌────────────────────────────────┐
                                       │      Cloudflare Tunnel         │
                                       │      (cloudflared, free)       │
                                       │  api.<your-domain>             │
                                       └────────────────┬───────────────┘
                                                        │ HTTP
                                                        ▼
                                       ┌────────────────────────────────┐
                                       │   FastAPI on home machine      │
                                       │   ┌──────────────────────┐     │
                                       │   │  asyncio Job Queue   │     │
                                       │   │  (single worker)     │     │
                                       │   └─────────┬────────────┘     │
                                       │             │                  │
                                       │   ┌─────────▼────────────┐     │
                                       │   │  WhisperX pipeline   │     │
                                       │   │  - faster-whisper    │     │
                                       │   │  - alignment         │     │
                                       │   │  - pyannote diariz.  │     │
                                       │   └──────────────────────┘     │
                                       │             │                  │
                                       │             ▼                  │
                                       │       NVIDIA GPU (CUDA)        │
                                       └────────────────────────────────┘
```

**Key insight:** The tunnel only carries small JSON requests (job submit, control, anonymous-only download). Bulk bytes (audio in, transcript out for signed-in users) flow through Supabase. Progress events flow through Supabase Realtime. This is what keeps the system working on the free tier.

---

## Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **Browser (Next.js client)** | Render UI, hold edit state, render exports (.txt/.srt/.vtt/.json) in-browser, subscribe to Realtime for progress | React + Shadcn UI, Supabase JS client |
| **Next.js Server Actions / Route Handlers** | Issue Supabase signed upload URLs, mint short-lived backend job tokens, fetch own-history pages with RLS-enforced queries | App Router, `@supabase/ssr`, Server Actions |
| **Vercel Edge / Node runtime** | Serve the SPA shell + SSR for `/history` | Vercel free tier (Node runtime for anything that needs the Supabase service-role key — the Edge runtime is fine for read-only client work) |
| **FastAPI (home machine)** | Accept job submissions, enqueue, run WhisperX, write results to Postgres + (signed-in) Storage, emit progress | `uvicorn` + `fastapi`, started as a `systemd` user unit or `tmux`/`pm2` process |
| **Job worker (asyncio task)** | Drain `asyncio.Queue`, run pipeline, update `jobs` row at each stage | Single coroutine launched at app startup; runs WhisperX synchronously inside `loop.run_in_executor` to keep the event loop free for progress writes |
| **WhisperX pipeline** | Audio normalize (ffmpeg) → ASR (faster-whisper) → forced alignment → diarization (pyannote) → merge into segments | Loaded **once** at FastAPI startup; models held in VRAM for process lifetime |
| **Cloudflare Tunnel (`cloudflared`)** | Expose FastAPI to the public internet on a stable hostname with TLS | Named tunnel + DNS route; runs as a daemon alongside FastAPI |
| **Supabase Postgres** | Source of truth for users, transcripts, jobs | Free tier (500 MB DB, plenty for transcripts-as-jsonb) |
| **Supabase Auth** | Email/OAuth sign-in, issues asymmetric JWTs (JWKS) | Free tier; backend verifies via JWKS endpoint |
| **Supabase Storage** | Hold uploaded audio (during job) + transcript JSON (signed-in users) | Free tier; 50 MB per file cap on free tier — see "Constraints" below |
| **Supabase Realtime** | Push `jobs` row UPDATEs to the browser so progress bars move | Free tier; unidirectional consumer in the browser |

---

## Recommended Repo Structure

```
transcribe/
├── README.md                    # What it is, how to run, how to self-host
├── LICENSE
├── .gitignore
├── .editorconfig
├── .pre-commit-config.yaml      # ruff (py) + biome (ts) + format on commit
│
├── frontend/                    # Next.js 15 App Router (Vercel)
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── biome.json               # or eslint+prettier — biome keeps deps lean
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── public/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx             # landing + upload control (anon + signed-in)
│   │   ├── job/[id]/page.tsx    # active transcription (Realtime progress)
│   │   ├── transcript/[id]/     # editor (signed-in saved view)
│   │   ├── history/             # signed-in only
│   │   ├── auth/                # callback routes
│   │   └── api/                 # Route Handlers (signed-url, job-token, etc.)
│   ├── components/
│   │   ├── ui/                  # shadcn primitives (vendored)
│   │   ├── upload/
│   │   ├── transcript-editor/
│   │   └── progress/
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts        # browser
│   │   │   ├── server.ts        # server components
│   │   │   └── middleware.ts    # cookie refresh
│   │   ├── api.ts               # fetch wrapper for FastAPI base URL
│   │   ├── exporters/           # in-browser .srt/.vtt/.txt/.json renderers
│   │   └── types.ts             # shared with backend (manually kept in sync, see "Type sharing")
│   └── middleware.ts            # supabase auth refresh
│
├── backend/                     # FastAPI + WhisperX (home machine)
│   ├── pyproject.toml           # poetry or uv; uv recommended for cold-install speed
│   ├── README.md                # how to run on a CUDA box
│   ├── .env.example
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI() + lifespan(load_models, start_worker)
│   │   ├── config.py            # pydantic-settings
│   │   ├── deps.py              # auth dep (JWKS verify), supabase admin client
│   │   ├── routes/
│   │   │   ├── jobs.py          # POST /jobs, GET /jobs/{id}, DELETE /jobs/{id}
│   │   │   └── health.py        # GET /healthz, GET /readyz
│   │   ├── queue/
│   │   │   ├── __init__.py
│   │   │   ├── queue.py         # asyncio.Queue wrapper, worker task
│   │   │   └── progress.py      # write progress to jobs table
│   │   ├── pipeline/
│   │   │   ├── __init__.py
│   │   │   ├── models.py        # singleton model holders
│   │   │   ├── normalize.py     # ffmpeg → 16k mono wav
│   │   │   ├── transcribe.py    # faster-whisper
│   │   │   ├── align.py         # whisperx forced alignment
│   │   │   ├── diarize.py       # pyannote
│   │   │   └── merge.py         # merge ASR + diarization into segments
│   │   ├── storage.py           # download from Supabase Storage by key
│   │   └── db.py                # supabase python client (service role)
│   ├── tests/
│   │   ├── conftest.py
│   │   ├── fixtures/            # tiny sample wav
│   │   └── test_pipeline.py
│   └── scripts/
│       ├── warmup.py            # pre-download all models (run once at install)
│       └── tunnel.sh            # wrapper that starts cloudflared + uvicorn
│
├── supabase/                    # versioned data layer
│   ├── config.toml              # supabase CLI project config
│   ├── migrations/
│   │   ├── 0001_init.sql        # tables, indexes
│   │   ├── 0002_rls.sql         # RLS policies
│   │   └── 0003_realtime.sql    # ALTER PUBLICATION supabase_realtime
│   └── seed.sql                 # optional, for local dev
│
├── docs/
│   ├── architecture.md          # this file's polished version for portfolio readers
│   ├── self-hosting.md          # how to run your own instance
│   └── adr/                     # architecture decision records
│
└── .github/
    └── workflows/
        ├── frontend-ci.yml      # lint + typecheck + build on PR (Vercel handles deploy)
        └── backend-ci.yml       # ruff + pytest (no GPU in CI; pipeline tests skipped)
```

### Structure Rationale

- **`frontend/` and `backend/` as siblings, not a pnpm workspace.** They share zero runtime code — one is TS, one is Python. A workspace adds tooling tax for no benefit. Keep them as two independent projects in one repo.
- **`supabase/` at the repo root** because the schema is the contract between the two apps. Not a property of either.
- **`backend/app/pipeline/` is split per-stage** (normalize, transcribe, align, diarize, merge). Each stage is independently testable on a tiny fixture. WhisperX itself fuses these, but exposing them as separate functions keeps the failure modes addressable (e.g., diarization can fail without killing transcription).
- **`backend/scripts/warmup.py`** exists because the first run downloads ~3 GB of weights. Run it once at install time; CI and the actual server start are then fast.
- **Pre-commit with ruff + biome** keeps both languages clean without a heavyweight monorepo build system. Biome is preferred over eslint+prettier because it's a single fast binary — matches the "lean" project vibe.
- **No Dockerfile in the recommended path.** A Dockerfile for the backend means losing native CUDA at worst and adding 2 GB of base image at best. A README that says "install ffmpeg, install CUDA, `uv sync`, `uv run uvicorn app.main:app`" is more honest. (Optional: `docker-compose.dev.yml` that runs only the frontend + a local Supabase, with a placeholder for the backend URL — useful for frontend-only contributors.)

---

## Architectural Patterns

### Pattern 1: Models-as-Singletons via FastAPI Lifespan

**What:** Load WhisperX models once at process startup, keep them in VRAM until shutdown.
**When:** Always for this project. The single-job queue means there's no benefit to lazy-loading.
**Trade-offs:**
- Pro: First request is the only fast request; subsequent are equally fast. No 30s+ cold-start per job.
- Pro: Simpler than a multi-model cache.
- Con: Idle GPU still holds VRAM. Acceptable: the dev's PC isn't shared with other GPU work while serving.

```python
# app/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.pipeline import models
from app.queue import start_worker, stop_worker

@asynccontextmanager
async def lifespan(app: FastAPI):
    models.load_all()       # whisper, alignment, diarization — ~30s one-time
    worker = await start_worker()
    yield
    await stop_worker(worker)
    models.unload_all()     # torch.cuda.empty_cache() etc.

app = FastAPI(lifespan=lifespan)
```

### Pattern 2: In-Process `asyncio.Queue` + Single Worker

**What:** Submit endpoint puts a `JobSpec` on `asyncio.Queue`, a single background worker drains it, runs WhisperX in `run_in_executor`, writes progress to `jobs` row. Postgres is the durable record; the queue is just an in-memory waitlist.
**When:** Always for this project. Single-GPU + single-job means a real broker is overkill.
**Trade-offs:**
- Pro: Zero extra infra. No Redis, no RQ/arq, no broker cost.
- Pro: `arq` benchmarks 7x faster than `rq` but neither matters here — we run one job at a time.
- Con: If the FastAPI process crashes, queued (not-yet-started) jobs vanish. Mitigation: on startup, scan `jobs` table for `status='queued'` rows and re-enqueue.
- Con: Doesn't scale horizontally. **Not a goal.**

```python
# app/queue/queue.py
import asyncio
from app.pipeline import run_pipeline
from app.queue.progress import set_status

queue: asyncio.Queue[str] = asyncio.Queue()  # job_id

async def worker():
    while True:
        job_id = await queue.get()
        try:
            await set_status(job_id, "running", progress=0)
            await asyncio.get_running_loop().run_in_executor(
                None, run_pipeline, job_id   # blocking GPU work off the loop
            )
            await set_status(job_id, "succeeded", progress=100)
        except Exception as e:
            await set_status(job_id, "failed", error=str(e))
        finally:
            queue.task_done()
```

### Pattern 3: Realtime-via-Postgres for Progress

**What:** Backend writes progress to a `jobs` row; Supabase Realtime streams the UPDATE to subscribed browsers via Supabase's own WebSocket (which terminates at Supabase, not at the tunnel).
**When:** For any client visibility into long-running jobs.
**Trade-offs:**
- Pro: Sidesteps Cloudflare Tunnel's documented SSE buffering and 100s WebSocket idle timeout. The backend → frontend path doesn't go through the tunnel at all for progress.
- Pro: Frontend reconnects are free — Supabase JS client handles them. After a refresh, the UI rehydrates from the `jobs` row.
- Pro: Anonymous clients can subscribe too, with RLS-permitted access keyed on a per-job random token.
- Con: One extra DB write per progress tick. Throttle to once per 1–2 seconds; don't write per-segment.
- Con: Requires `ALTER PUBLICATION supabase_realtime ADD TABLE jobs;` in a migration — easy to miss.

```typescript
// frontend: subscribe to a single job
const channel = supabase
  .channel(`job:${jobId}`)
  .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `id=eq.${jobId}` },
      (payload) => setProgress(payload.new))
  .subscribe();
```

### Pattern 4: Direct-to-Storage Upload via Signed URL

**What:** Frontend asks its own Server Action for a signed upload URL → browser PUTs the file directly to Supabase Storage → frontend POSTs the resulting `storage_key` to FastAPI.
**When:** For any user-supplied file.
**Trade-offs:**
- Pro: Bypasses Vercel's 4.5 MB serverless body cap entirely.
- Pro: Bypasses the Cloudflare Tunnel for the heavy bytes — large multipart through `cloudflared` works but is slower and pointless when Storage handles it natively.
- Pro: The backend can resume/retry by re-pulling from Storage without the user re-uploading.
- Con: Free-tier Supabase Storage caps at 50 MB per file. **This is the binding upload-size constraint.** A 90-min 192 kbps mp3 is ~120 MB → over the limit. Must enforce client-side: either reject, or transcode to 16 kHz mono opus in-browser before upload (fits ~600 minutes in 50 MB).
- Con: For anonymous users, requires a route that issues a signed URL without auth — gate with rate limiting on the Server Action.

### Pattern 5: Frontend-Owned Export Rendering

**What:** Backend produces one canonical artifact (the JSON transcript with segments + speakers + word timings). Browser renders `.txt`, `.srt`, `.vtt` from that JSON on demand.
**When:** Always. Don't put format conversion on the backend.
**Trade-offs:**
- Pro: Backend stays stateless after producing the JSON. No "regenerate SRT" round-trip after edits.
- Pro: User edits (renamed speakers, fixed text) immediately affect all downloads with no server call.
- Pro: Tiny: `.srt` is ~50 lines of TS; `.vtt` is `.srt` with header swap.
- Con: Browser does the timestamp formatting — need careful handling of edge cases (>1h durations, fractional seconds). Trivial.

### Pattern 6: Tunnel-as-Dumb-Pipe

**What:** `cloudflared` only proxies short JSON requests to FastAPI. No SSE, no long-lived WebSockets, no file uploads.
**When:** Whenever a Cloudflare-Tunnel-on-free-tier is the public-facing edge.
**Trade-offs:**
- Pro: Stays well within all known cloudflared free-tier behaviors. No SSE buffering issues, no 100s WS-idle drops.
- Pro: Tunnel restarts (which happen) only kill in-flight requests of seconds, not minutes.
- Con: Forces "no streaming over the tunnel," which is exactly what motivates the Realtime-via-Postgres pattern above. Acceptable.

---

## Data Flow

### Flow 1: Anonymous Upload + Transcribe

```
Browser                Vercel               Supabase                  FastAPI
   │                     │                     │                         │
   │ pick file           │                     │                         │
   ├────────────────────►│ (Server Action)     │                         │
   │                     │ POST /api/sign-upload                         │
   │                     │  { mime, size }     │                         │
   │                     │  rate-limit by IP   │                         │
   │                     ├────────────────────►│ createSignedUploadUrl   │
   │                     │◄────────────────────┤ { url, token }          │
   │ {url, token}        │                     │                         │
   │◄────────────────────┤                     │                         │
   │ PUT file (multipart)                      │                         │
   ├──────────────────────────────────────────►│  (audio.wav stored)     │
   │                                                                     │
   │ POST /jobs (via tunnel)                                             │
   │   { storage_key, opts: {model, diarize, lang}, anon_token }         │
   ├────────────────────────────────────────────────────────────────────►│
   │                                                                     │ INSERT jobs (status=queued)
   │                                                                     │ enqueue(job_id)
   │ { job_id, anon_token }                                              │
   │◄────────────────────────────────────────────────────────────────────┤
   │                                                                     │
   │ Realtime subscribe: jobs where id=job_id and anon_token=...         │
   ├──────────────────────────────────────────►│                         │
   │                                           │                         │ worker picks job:
   │                                           │                         │   download from Storage
   │                                           │                         │   ffmpeg normalize
   │                                           │ ◄───────────────────────┤   UPDATE jobs progress=10
   │ UPDATE event                              │                         │
   │◄──────────────────────────────────────────┤                         │
   │                                           │                         │   ASR + align + diarize
   │                                           │ ◄───────────────────────┤   UPDATE jobs progress=...
   │                                           │                         │
   │                                           │                         │ done:
   │                                           │ ◄───────────────────────┤   UPDATE jobs status=succeeded,
   │                                           │                         │     transcript_payload=<jsonb>
   │                                           │ ◄───────────────────────┤   DELETE storage object (cleanup)
   │ UPDATE event with transcript_payload      │                         │
   │◄──────────────────────────────────────────┤                         │
   │ render in editor (in-memory only)         │                         │
   │                                                                     │
   │ user closes tab → backend has no record (anon job was DELETEd       │
   │   from jobs after success delivery, or auto-purged after 1h TTL)    │
```

**Why the anonymous transcript is held in the `jobs` row, not `transcripts`:** the constraint is "anonymous transcripts not persisted past the active session." A short-TTL `jobs` row that gets purged on a `pg_cron` job (every hour, delete `WHERE user_id IS NULL AND completed_at < now() - interval '1 hour'`) is the cheapest implementation.

### Flow 2: Signed-In Upload + Transcribe + Save

Same as Flow 1, except:
- Server Action requires Supabase session.
- Job submission to FastAPI carries the user's JWT (Authorization header).
- FastAPI verifies JWT against Supabase JWKS, extracts `user_id`.
- On job success, backend INSERTs into `transcripts` (with `user_id`) **in addition to** the `jobs` row update.
- After delivery, `jobs` row stays as a historical record (or is purged after a few days; not load-bearing).
- The transcript_payload jsonb is the durable record — survives reboot.

### Flow 3: Edit + Download (Saved Transcript)

```
Browser                            Vercel                Supabase
   │                                 │                     │
   │ open /transcript/<id>           │                     │
   ├────────────────────────────────►│ Server Component    │
   │                                 │ select * from transcripts where id=...
   │                                 ├────────────────────►│ (RLS: user_id = auth.uid())
   │                                 │◄────────────────────┤
   │ initial transcript_payload      │                     │
   │◄────────────────────────────────┤                     │
   │                                                       │
   │ user edits (rename speaker, fix text) — local state   │
   │                                                       │
   │ debounced save (Server Action)  │                     │
   ├────────────────────────────────►│ UPDATE transcripts  │
   │                                 ├────────────────────►│
   │                                                       │
   │ user clicks "Download .srt"                           │
   │ (in-browser exporter; no network)                     │
   │                                                       │
```

The backend is not involved after the initial transcription — editing and exporting are pure frontend + Supabase.

### Flow 4: Backend Offline (Graceful Degradation)

```
Browser                Vercel               Supabase                  FastAPI
   │                     │                     │                         X (down)
   │ open /              │                     │                         │
   ├────────────────────►│ Server Component    │                         │
   │                     │ probe FastAPI /healthz (with 2s timeout)      │
   │                     ├──────────────────────────────────────────────►│ (no response)
   │                     │ (timeout)                                     │
   │ shell renders with  │                                               │
   │   "Service is offline — the host machine is asleep. Try again later."
   │   Sign-in still works (Supabase is independent).                    │
   │   Saved transcripts (signed-in) still readable + editable + exportable.
   │◄────────────────────┤                     │                         │
```

Health probe lives in a Server Component (or a Route Handler called from the client) and gates the upload UI but **not** the history/editor UI — those work without the backend.

---

## Persistence Model

### Schema Sketch

```sql
-- 0001_init.sql

-- Supabase manages auth.users automatically.
-- We never write to it; we reference it from public tables.

create table public.transcripts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,                -- editable; default = source filename
  source_filename text not null,
  duration_sec    integer not null,
  language        text,                          -- ISO code; null if auto-detect failed
  model_used      text not null,                 -- 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'
  diarized        boolean not null default false,
  payload         jsonb not null,                -- the transcript document; see "Payload shape" below
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index transcripts_user_created_idx
  on public.transcripts (user_id, created_at desc);

create table public.jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade,  -- nullable for anon
  anon_token          text,                                               -- random, for anon RLS
  storage_key         text not null,                                      -- in 'uploads' bucket
  source_filename     text not null,
  options             jsonb not null,            -- { model, diarize, num_speakers, language }
  status              text not null
                       check (status in ('queued','running','succeeded','failed','cancelled')),
  progress            smallint not null default 0
                       check (progress between 0 and 100),
  stage               text,                       -- 'normalize'|'transcribe'|'align'|'diarize'|'merge'
  error               text,
  transcript_payload  jsonb,                      -- only used for anon (held briefly here, not in transcripts)
  transcript_id       uuid references public.transcripts(id) on delete set null, -- set when signed-in & saved
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz
);
create index jobs_status_created_idx on public.jobs (status, created_at);
create index jobs_user_idx on public.jobs (user_id) where user_id is not null;

-- 0002_rls.sql
alter table public.transcripts enable row level security;
alter table public.jobs        enable row level security;

-- Transcripts: only the owner sees their rows.
create policy transcripts_select_own on public.transcripts
  for select using (auth.uid() = user_id);
create policy transcripts_insert_own on public.transcripts
  for insert with check (auth.uid() = user_id);
create policy transcripts_update_own on public.transcripts
  for update using (auth.uid() = user_id);
create policy transcripts_delete_own on public.transcripts
  for delete using (auth.uid() = user_id);

-- Jobs:
--  - Signed-in users see their own jobs (user_id match).
--  - Anonymous users see a job only if they present its anon_token via a header
--    that's surfaced as a request claim. Simpler alternative: the frontend filters
--    by id+anon_token; no RLS leak risk because the token is unguessable.
create policy jobs_select_own on public.jobs
  for select using (
    (auth.uid() is not null and auth.uid() = user_id)
    or (user_id is null and anon_token is not null
        and current_setting('request.headers', true)::jsonb ->> 'x-anon-token' = anon_token)
  );
-- Inserts come from the FastAPI service-role key — bypasses RLS. No client INSERT policy.
-- Updates likewise come from service-role only.

-- 0003_realtime.sql
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.transcripts;
```

### Why `payload jsonb`, not `transcript_segments` table

The choice was: one row per segment (`transcript_segments(transcript_id, idx, start_ms, end_ms, speaker, text)`) versus a single `payload jsonb` per transcript.

**Recommendation: `jsonb`.** Reasoning:

| Consideration | Rows-per-segment | jsonb payload |
|---|---|---|
| Read pattern (load full transcript for editor) | N rows + ORDER BY → reassemble | One row, instant |
| Write pattern (save edits) | N upserts or full delete+insert | Single UPDATE |
| Querying within a transcript ("find segment with text X") | SQL LIKE | jsonb_path_query or just frontend filter |
| Cross-transcript search | Full-text on text column | Full-text on `payload->>'text'` (still works) |
| Schema evolution (add word-level timings, confidence scores) | New columns / migration | Add a key, no migration |
| Storage size | Slightly smaller (no JSON overhead) | Slightly larger; negligible at this scale |
| Free-tier 500 MB DB pressure | ~same | ~same |

The use case is "load the whole transcript, edit it, save the whole transcript." A row-per-segment table optimizes for queries we don't make. **jsonb is correct here.**

#### Payload shape

```jsonc
{
  "version": 1,
  "language": "en",
  "duration_sec": 3621.4,
  "speakers": [
    { "id": "S0", "label": "Speaker 1" },
    { "id": "S1", "label": "Maria" }     // user-renamed
  ],
  "segments": [
    {
      "id": "seg_000",
      "start": 0.12,
      "end": 4.56,
      "speaker": "S1",
      "text": "Hello everyone, welcome.",
      "words": [
        { "w": "Hello",     "s": 0.12, "e": 0.42 },
        { "w": "everyone,", "s": 0.45, "e": 0.93 },
        { "w": "welcome.",  "s": 0.95, "e": 1.40 }
      ]
    }
    // ...
  ]
}
```

A single 90-minute talk in this format is roughly 200–500 KB of JSON. Postgres `jsonb` handles that trivially; the 500 MB free-tier DB fits ~1000–2500 transcripts.

### Job lifecycle states

```
queued → running → succeeded
   │         │
   │         └──► failed
   └──► cancelled
```

- **queued**: Row created by FastAPI on POST /jobs; in `asyncio.Queue`.
- **running**: Worker picked the job. `started_at` set. `stage` updates as pipeline advances.
- **succeeded**: Pipeline returned. `completed_at` set. For signed-in: `transcript_id` set; transcript row exists. For anon: `transcript_payload` populated in-place.
- **failed**: Exception raised. `error` populated.
- **cancelled**: User aborted before/during running. (V1 may skip cancellation; "Out of Scope" candidate if it complicates the queue worker.)

A `pg_cron` task purges anon jobs older than 1 hour (or rows where `user_id is null and status in ('succeeded','failed')`). This honors "anon transcripts not persisted past the active session" without requiring browser-driven cleanup.

---

## Suggested Build Order (for the roadmapper)

The dependency graph collapses to four lanes that can be partially parallelized.

### Lane A: Foundation (must come first)

**A1. Supabase project + schema** — Create project, write migrations 0001/0002/0003, push. Without this, neither the frontend nor the backend has anywhere to read/write.
**A2. Repo skeleton** — Create `frontend/`, `backend/`, `supabase/` directories with empty configs. Pre-commit hooks. README skeleton.

These two can happen in one short setup phase. Everything else depends on them.

### Lane B: Backend pipeline (parallelizable with C)

**B1. WhisperX pipeline standalone** — A `backend/scripts/transcribe_local.py` that takes a wav file path and prints JSON. No FastAPI, no Supabase, no queue. Just prove the pipeline works on the dev's machine end-to-end (ffmpeg → faster-whisper → align → diarize → merge).
**B2. FastAPI shell + lifespan model loading** — `app/main.py` with `/healthz`, lifespan-loaded models, no real routes yet. Confirms the singleton pattern works.
**B3. Job queue + worker** — `asyncio.Queue` + worker coroutine. Test with a stub pipeline that just sleeps + writes progress.
**B4. Real `/jobs` route + Supabase write-through** — Wire B1 into B3. Supabase service-role client. `jobs` row updates from the worker.
**B5. JWT verification dep** — JWKS-based verify_token dep that decorates protected routes. Can be added after B4 — anon-only at first is fine.
**B6. Cloudflare Tunnel** — Set up named tunnel, point to local FastAPI, confirm public URL works. Should be one-day work.

### Lane C: Frontend skeleton (parallelizable with B)

**C1. Next.js app shell + Tailwind + Shadcn** — Landing page, dark mode, layout, no real logic. Deploy to Vercel free tier on day one.
**C2. Supabase auth wired** — `@supabase/ssr` middleware, sign-in page, sign-out. Anonymous flows still work.
**C3. Upload UI (mock backend)** — File picker, options form, "Submit" button. Calls a mock route that returns a fake job_id. Builds the visual scaffolding before B is done.
**C4. Progress UI subscribed to Supabase Realtime** — Subscribe to a `jobs` row, show progress bar. Test by manually inserting/updating rows in Supabase Studio.
**C5. Transcript editor component** — Render a hardcoded payload, support speaker rename + segment text edit + segment reassign. No save yet; pure local state.
**C6. In-browser exporters** — `.srt`/`.vtt`/`.txt`/`.json` from a payload. Unit-tested.

### Lane D: Integration

**D1. End-to-end anonymous flow** — Real upload to Storage signed URL, real POST to FastAPI, real Realtime progress, real transcript rendered. This is the first time A+B+C integrate.
**D2. End-to-end signed-in flow + history** — Save on success, list past transcripts, reopen + edit + save.
**D3. Public-URL safety** — Per-IP rate limit (Vercel middleware on the Server Action that issues signed URLs; FastAPI middleware on POST /jobs), file-size cap (frontend pre-check + backend re-check on storage object metadata), single-job queue is already enforced by lane B.
**D4. Offline graceful state** — Health probe + degraded UI.
**D5. Polish** — README, self-hosting guide, ADRs, portfolio review pass.

### Critical-path ordering

```
A (foundation)
   │
   ├──► B1 (pipeline) ──► B2 ──► B3 ──► B4 ──► B6 ──┐
   │                                                ├─► D1 ──► D2 ──► D3 ──► D4 ──► D5
   └──► C1 ──► C2 ──► C3 ──► C4 ──► C5 ──► C6 ─────┘
```

Lanes B and C are fully independent until D1. A solo dev alternates between them (e.g., start a B-lane GPU model download, work on C while it downloads). On a team this would parallelize cleanly.

### Where roadmap research is likely needed (flags for later phases)

- **B1 (WhisperX pipeline):** model selection, VRAM tuning, alignment language coverage. Significant unknowns.
- **D3 (rate limit):** how exactly to do per-IP rate limiting on Vercel's edge. Multiple possible patterns.
- **A1 specifically the RLS for anon jobs:** the `current_setting('request.headers')` pattern works but has alternatives (Edge Function proxy, "anon-token-as-id-prefix"). Worth a small spike.
- **B6 cloudflared SSE/WebSocket behavior in practice:** Theoretical limits are clear; verify the Realtime-via-Supabase pattern by actually running it before committing.

---

## Critical Edges & Boundaries

### CORS

- **Where:** FastAPI middleware (`fastapi.middleware.cors.CORSMiddleware`).
- **Allowed origins:** the Vercel deployment URL(s) — the prod alias and preview branches if you care about previews. Localhost for dev.
- **Allowed methods:** `POST`, `GET`, `OPTIONS`.
- **Allowed headers:** `Authorization`, `Content-Type`, `X-Anon-Token`.
- **Credentials:** not needed — JWT is in the `Authorization` header, not in cookies.
- **Why FastAPI not the tunnel:** Cloudflare Tunnel passes CORS through unchanged; trying to set CORS at Cloudflare needs a Worker, which costs (effort, not money) and adds another moving piece.

### Auth

- **Sign-in happens in the browser** via `@supabase/ssr`. Tokens land in HTTP-only cookies on the Vercel side.
- **Server Components / Server Actions** read the session via `createServerClient` — never expose the service-role key to the browser.
- **The frontend sends the user JWT to FastAPI** in `Authorization: Bearer <token>` for protected routes (saving transcripts).
- **FastAPI verifies the JWT against the Supabase JWKS endpoint** (`https://<project>.supabase.co/auth/v1/.well-known/jwks.json`). Cache the JWKS for 10 min; refresh on `kid` miss. Use `python-jose` or `PyJWT` with `jwks-client`.
- **The anon flow has no JWT.** Anon endpoints accept an `X-Anon-Token` header instead — a UUID generated by the frontend at job-create time, stored in the `jobs.anon_token` column, and used to filter Realtime subscriptions.
- **Service-role key lives only on the FastAPI host** in an env var. Never on Vercel, never in the frontend bundle. The frontend uses anon key + RLS; the backend uses service-role for unrestricted writes to `jobs`/`transcripts`.

### Rate limiting

- **Two layers, both are cheap:**
  1. **Vercel Server Action that issues signed upload URLs** — keyed on client IP from `x-forwarded-for`. In-memory LRU is fine on a single-region deploy; Vercel KV is a "later" option and isn't free in all configs. For $0, an in-memory counter per function instance is acceptable — over-limit recovers in seconds when a new instance spins up. Slightly leaky but cheap.
  2. **FastAPI middleware on `POST /jobs`** — same idea, keyed on IP from the `cf-connecting-ip` header that `cloudflared` propagates. `slowapi` is the canonical FastAPI rate limiter.
- **Why both:** Layer 1 keeps drive-by abuse from chewing Supabase Storage egress (which is metered). Layer 2 protects the GPU when someone bypasses the frontend and posts directly. Belt-and-suspenders is appropriate when one of the two is at the perimeter of free-tier quotas.

### Failure mode: home machine off

- **Frontend health probe** on the landing page: a Server Component fetches `https://api.<your-domain>/healthz` with a short timeout (2s). If it 5xx or times out, render a banner: "Transcription service is offline (the host machine is asleep). Sign in to view your saved transcripts." Upload control disabled.
- **Saved-transcript pages are unaffected** — they read from Supabase directly, not from the backend.
- **In-flight job + machine off mid-job:** the `jobs` row is stuck at `running`. A second `pg_cron` job marks `running` jobs older than 30 min as `failed` with `error='backend timeout'`. The frontend, subscribed via Realtime, sees the transition and shows an error. (V1 can skip the cron and just have the user refresh; the failure state is implicit. Belt-and-suspenders again is nice but not load-bearing.)

### Tunnel constraints (load-bearing)

- **No SSE through the tunnel.** Cloudflare Tunnel is documented to buffer SSE responses; behavior across Quick and Named tunnels is similar enough that "don't" is the right policy. ([cloudflared #199](https://github.com/cloudflare/cloudflared/issues/199), [cloudflared #1449](https://github.com/cloudflare/cloudflared/issues/1449))
- **WebSockets work but with a 100s idle timeout** on free + named tunnels. ([Cloudflare WebSockets docs](https://developers.cloudflare.com/network/websockets/)) If the project ever needs a direct WS to FastAPI, send pings every 30s. **Default plan: don't.** Use Supabase Realtime instead.
- **Long bodies through the tunnel work** but are slower than direct-to-Storage. Avoid.

---

## Local Dev Story

Recommended setup for a contributor:

```bash
# One-time
git clone <repo>
cd transcribe

# Backend (requires CUDA-capable machine for full pipeline; CPU fallback is slow but works)
cd backend
uv sync                              # poetry alternative: poetry install
cp .env.example .env                 # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, etc.
uv run python scripts/warmup.py      # downloads ~3 GB of models on first run
uv run uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd ../frontend
pnpm install
cp .env.local.example .env.local     # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
                                     # NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
pnpm dev                             # Next.js on :3000

# Supabase (option A: hosted dev project)
# Just point .env at a free Supabase project. Run migrations:
cd ../supabase
supabase db push --project-ref <ref>

# Supabase (option B: local stack)
supabase start                       # spins up Postgres + Studio + GoTrue locally
supabase db reset                    # apply migrations + seed
```

**Recommendation: skip docker-compose, skip a workspace tool.** Three terminals (`uvicorn`, `pnpm dev`, `supabase`) is fine for a project this size and is honest about the architecture. A `Makefile` or `justfile` at the repo root with `just dev-frontend`, `just dev-backend`, `just dev-supabase` is a nice quality-of-life touch.

A frontend-only contributor (someone fixing UI without a GPU) can run against the live tunneled backend by just setting `NEXT_PUBLIC_BACKEND_URL` to the dev's tunnel hostname.

---

## Deploy Story

### Frontend (Vercel)

- Connect the GitHub repo to Vercel, set the project root to `frontend/`.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_BACKEND_URL` (the cloudflared hostname), and any server-only ones.
- `git push` to `main` → Vercel deploys. PRs get preview URLs automatically.
- No additional CI needed for deploy; a lint/typecheck workflow in `.github/workflows/frontend-ci.yml` is the only thing to add.

### Backend (home machine)

- A `systemd` user unit (or `tmux`/`screen` if dead-simple is preferred) running:
  ```bash
  cd /home/<user>/code/transcribe/backend
  uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
  ```
- A second `systemd` unit running `cloudflared tunnel run <tunnel-name>`. Ingress points to `http://localhost:8000`.
- Update flow:
  ```bash
  cd ~/code/transcribe
  git pull
  cd backend && uv sync                          # picks up new deps
  systemctl --user restart transcribe-backend    # picks up new code
  ```
- Optionally a `git pull` cron, but for a portfolio project the manual `git pull` is fine — the dev wants to see what's deploying.

### Supabase (schema)

- Migrations versioned in `supabase/migrations/`.
- Apply with `supabase db push --project-ref <ref>` from the dev's machine.
- This is rare — schema changes happen at phase boundaries.

### "Dead-simple to operate" checklist

- One `systemctl --user restart transcribe-backend` after a backend change.
- One `git push` after a frontend change (Vercel handles the rest).
- One `supabase db push` after a schema change.
- A README section titled "Operating this thing" that lists exactly these three commands.
- Health check: open the site. If the upload control is grayed out, the home machine is off — go turn it on. No dashboards, no observability stack. Honest with the project's $0 budget.

---

## Scaling Considerations

| Scale | What changes |
|-------|--------------|
| 1–10 concurrent users (typical) | Nothing. They queue. Single-job worker handles them in turn. |
| ~50 concurrent | Queue depth grows; users wait minutes. Add a UI cue: "you are #4 in line, ETA ~20 min." Easy to compute from the running job's progress + queue length. |
| Sustained traffic that exceeds GPU throughput | Out of scope. The project's premise is "free for the dev who hosts it." If it's ever popular enough that the GPU saturates 24/7, the answer is one of: (a) close it down, (b) accept the long queue, (c) ask users to self-host (which the README enables). Paid GPU is explicitly out of scope. |
| Free-tier Supabase quota pressure | At 500 MB DB, ~1000–2500 transcripts before pressure. At 1 GB monthly storage egress, depends on transcript download volume. Mitigation: enforce per-user transcript count cap (e.g., 100). Keep `jobs` purged. |
| Free-tier Vercel function-invocation cap | Server Actions for issuing signed URLs are tiny and fast; should not be a near-term concern. |

### First bottleneck (realistic)

GPU throughput on the dev's home machine. WhisperX large-v3 with diarization on a single 16GB consumer GPU runs at roughly 5–10x real-time, so a 60-minute audio takes 6–12 minutes. With a single-job queue and 10 jobs queued, the 10th user waits 1–2 hours. That's the actual scaling cliff for this project — and the right answer is honesty in the UI, not infrastructure.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Streaming progress via SSE through the Cloudflare Tunnel

**What people do:** "It's a long job, just open an SSE connection from the browser to FastAPI through the tunnel."
**Why it's wrong:** Cloudflare Tunnel buffers SSE — events don't reach the browser until the connection closes. ([cloudflared issue #199](https://github.com/cloudflare/cloudflared/issues/199), [cloudflared issue #1449](https://github.com/cloudflare/cloudflared/issues/1449)) Confirmed across Quick Tunnels and reported on Named Tunnels too. The progress bar will sit at 0% and then jump to 100% at the end — every time.
**Do this instead:** Write progress to a `jobs` row in Postgres; subscribe to it via Supabase Realtime. The progress channel doesn't traverse the tunnel at all.

### Anti-Pattern 2: Loading WhisperX models per request

**What people do:** Load the model inside the request handler so "the API is stateless."
**Why it's wrong:** Loading + warming faster-whisper-large + alignment + pyannote takes 20–60 seconds and consumes the GPU's entire memory bandwidth during load. Doing it per request makes the API unusable.
**Do this instead:** Load all models in FastAPI's `lifespan` startup hook. Hold them as module-level globals (or in `app.state`). Single-process; single-worker; never reload. ([Beam.cloud WhisperX deployment notes](https://www.beam.cloud/blog/whisperx))

### Anti-Pattern 3: Routing the audio file through the tunnel and through Vercel

**What people do:** Form POST → Vercel Server Action → `await fetch(backend, { body: formData })`.
**Why it's wrong:** Hits Vercel's 4.5 MB function body limit ([Vercel KB](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)) and then drags the entire audio over the tunnel. Slow, fragile, and hits multiple platform caps for no benefit.
**Do this instead:** Direct browser → Supabase Storage via signed upload URL ([Supabase signed upload](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)). Backend pulls from Storage by key.

### Anti-Pattern 4: Modeling segments as relational rows

**What people do:** `transcript_segments(transcript_id, idx, start, end, speaker, text)` "for queryability."
**Why it's wrong:** The application reads and writes a transcript as a whole document. The "queries" the relational shape would enable (search across segments, paginate segments) aren't real use cases here. Result: every save is a delete-and-reinsert of N rows, every load is a JOIN, schema migrations every time we add a field (e.g., word-level timings).
**Do this instead:** `transcripts.payload jsonb`. One row, one update, one read. Schema-flexible.

### Anti-Pattern 5: Putting Redis (RQ/arq/Celery) in front of one GPU

**What people do:** "Production-grade job queue means Redis."
**Why it's wrong:** Adds a service the project doesn't host (free Redis is rare and metered; running Redis on the home machine is fine but pointless). The single-GPU constraint means concurrency = 1; the queue is almost always empty or has 1–2 items. `asyncio.Queue` does this in 30 lines.
**Do this instead:** `asyncio.Queue` + a single worker coroutine + Postgres for durability. Reserve "real broker" as a "future scale" answer that probably never comes.

### Anti-Pattern 6: Backend-side SRT/VTT generation

**What people do:** Backend offers `GET /transcript/<id>.srt` that re-renders from the JSON.
**Why it's wrong:** After the user edits in the browser, the server-side render is stale. Forces a save-and-fetch round trip per export. Adds backend code paths.
**Do this instead:** All exports rendered in-browser from the in-memory payload. Backend's only output format is the canonical JSON.

### Anti-Pattern 7: Using the service-role key from the frontend "just for this one thing"

**What people do:** Need a backend-write that the user shouldn't be able to do via RLS, slip the service-role key into a Server Action's env.
**Why it's wrong:** A leaked service-role key bypasses every RLS policy. Server Actions run on Vercel, not on the home machine — every time the repo is public-portfolio-mode, a misconfigured `.env` is one mistake from disaster.
**Do this instead:** Service-role key lives only on the FastAPI host. Anything that needs unrestricted writes is a FastAPI endpoint, not a Server Action. The Vercel side has only the anon key.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Supabase Auth | JS client on browser; JWKS verify in FastAPI | Use `@supabase/ssr` on Next.js side; cache JWKS in backend. |
| Supabase Storage | Signed upload URL (browser → Storage); service-role download in backend | 50 MB/file free-tier cap is the binding constraint on input size. |
| Supabase Postgres | `supabase-py` (service-role) in backend; `@supabase/supabase-js` (anon, RLS-enforced) on frontend | Don't use Supabase's REST client from the backend — direct SQL via the same client is fine. |
| Supabase Realtime | Browser-only consumer; backend writes are plain UPDATEs that Realtime broadcasts | Remember `ALTER PUBLICATION supabase_realtime ADD TABLE jobs`. |
| Cloudflare Tunnel | Named tunnel + DNS route; `cloudflared` daemon on home machine | No SSE, mind the 100s WS idle timeout. |
| pyannote.audio (diarization) | Loaded as a WhisperX dependency | Requires accepting HuggingFace model license once; `HF_TOKEN` env var on the backend. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Browser ↔ Vercel Server Actions | RSC + Server Actions (RPC over fetch) | Auth via cookies; Vercel handles. |
| Browser ↔ Supabase | HTTPS REST + WebSocket (Realtime) | Anon key + RLS. |
| Browser ↔ Supabase Storage | HTTPS PUT to signed URL | No auth header needed; URL embeds the signature. |
| Browser ↔ FastAPI | HTTPS through `cloudflared` | `Authorization: Bearer <jwt>` for auth'd routes; `X-Anon-Token` for anon. |
| FastAPI ↔ Supabase | `supabase-py` with service-role key | Bypasses RLS for backend writes. |
| FastAPI worker ↔ FastAPI HTTP layer | Shared `asyncio.Queue` in same process | No IPC; same event loop. |

### Type sharing between Python and TypeScript

The `payload` jsonb shape is the contract. Recommended approach: write the schema once in `supabase/migrations/0001_init.sql` (as a JSON Schema comment or a separate `docs/payload.schema.json`), generate Python types via `datamodel-code-generator`, generate TS types via `json-schema-to-typescript`. Keep both generated files committed to make diffs reviewable. **Optional in V1** — manually maintaining matching types in `backend/app/schemas.py` and `frontend/lib/types.ts` is acceptable for a project of this size if updates are infrequent.

---

## Sources

- [Cloudflare Tunnel — WebSockets docs (idle timeout, free-tier behavior)](https://developers.cloudflare.com/network/websockets/)
- [cloudflared issue #199 — Server-sent-events are buffered](https://github.com/cloudflare/cloudflared/issues/199)
- [cloudflared issue #1449 — SSE not streamed in real-time](https://github.com/cloudflare/cloudflared/issues/1449)
- [Cloudflare Community — SSE through Cloudflare proxy](https://community.cloudflare.com/t/are-server-sent-events-sse-supported-or-will-they-trigger-http-524-timeouts/499621)
- [Supabase Storage — file upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits)
- [Supabase JS — createSignedUploadUrl reference](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)
- [Supabase Realtime — Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Supabase Realtime — Architecture](https://supabase.com/docs/guides/realtime/architecture)
- [Supabase Auth — JWTs and JWKS](https://supabase.com/docs/guides/auth/jwts)
- [Supabase Auth — Server-side auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Vercel — Bypassing the 4.5 MB body size limit](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
- [Vercel Functions — limits](https://vercel.com/docs/functions/limitations)
- [Beam.cloud — Deploying WhisperX (model lifecycle)](https://www.beam.cloud/blog/whisperx)
- [Modal — Choosing Whisper variants (faster-whisper, WhisperX)](https://modal.com/blog/choosing-whisper-variants)
- [DEV — Validating a Supabase JWT locally with Python and FastAPI](https://dev.to/zwx00/validating-a-supabase-jwt-locally-with-python-and-fastapi-59jf)
- [DEV — FastAPI BackgroundTasks vs ARQ + Redis](https://davidmuraya.com/blog/fastapi-background-tasks-arq-vs-built-in/)
- [arq docs](https://arq-docs.helpmanual.io/)

---

*Architecture research for: free, self-hostable audio/video transcription web app powered by local-GPU WhisperX*
*Researched: 2026-04-27*
