# Research Summary — Transcribe

**Project:** Transcribe
**Domain:** Free, self-hostable local-GPU audio/video transcription web app with speaker diarization
**Researched:** 2026-04-27
**Confidence:** HIGH (stack verified against upstream issue trackers and official docs; architecture constraints verified against Cloudflare/Supabase/Vercel platform limits)

---

## Executive Summary

Transcribe is a self-hostable web app that runs OpenAI Whisper locally on the developer's own GPU and exposes results through a polished editor — with $0/month recurring cost as a hard, non-negotiable constraint. The proven stack for this use case is **WhisperX 3.8.5** (bundles faster-whisper + wav2vec2 alignment + pyannote diarization in one pipeline) behind a **FastAPI** backend, with a **Next.js 15** frontend deployed to Vercel, **Supabase** (free tier) as the data and auth plane, and **Cloudflare Tunnel** as the free public-exposure layer for the home machine. All four agents agree on this core architecture; the disagreements are in the wiring between components.

The two load-bearing architectural decisions that were in conflict across research agents — the upload path and the progress channel — are resolved definitively in the "Resolved Trade-offs" section below. The resolution is driven by verified platform limits: Cloudflare Tunnel free has a hard 100 MB request body cap, and Supabase Storage free has a hard 50 MB per-file cap. Neither limit is configurable on the free tier. These constraints force a specific design that differs from what each individual agent proposed.

The primary implementation risks are the PyTorch/CUDA/cuDNN/ctranslate2 version matrix (a single mismatched package silently falls back to CPU), Supabase RLS being off-by-default for SQL-created tables (leading to full data exposure via the public anon key), and pyannote's HuggingFace gated-model requirement (which blocks every self-hoster who doesn't know to accept the license on two separate model pages). All three are preventable with explicit procedures at setup time. The overall confidence in the research conclusions is HIGH.

---

## Resolved Trade-offs

These two decisions were in conflict across agents. They are resolved here and are **locked for downstream planning**. Phase planners should not re-open them without a concrete counter-argument.

### Resolution 1 — Upload Path

**Conflict:** ARCHITECTURE.md proposed browser → Supabase Storage signed URL. STACK.md proposed TUS chunked upload direct to FastAPI. PITFALLS.md confirmed both: Cloudflare Tunnel free caps request bodies at 100 MB (hard, CF edge, not configurable) AND Supabase Storage free caps file size at 50 MB (hard, not configurable).

**Resolution: TUS chunked upload directly to FastAPI through Cloudflare Tunnel, with chunk size ≤ 90 MB.**

Rationale: The Supabase Storage 50 MB cap makes it unsuitable as the upload destination for source media — the project's stated use case is 90-minute meeting recordings that routinely exceed 50 MB. Supabase Storage is not used for source media at all. The Cloudflare Tunnel 100 MB body cap is solvable by client-side chunking: each chunk is ≤ 90 MB, well under the 100 MB edge limit. FastAPI receives chunks and assembles to a temp path on disk, then deletes after transcription. Source media is transient by design.

For files under the 90 MB threshold, a plain multipart POST to FastAPI is acceptable (no TUS ceremony). For files above, TUS chunked upload (`tus-js-client` on the client, a lightweight TUS server implementation on the FastAPI side, configured at `chunkSize: 90 * 1024 * 1024`). Supabase Storage is still used for transcript JSON artifacts for signed-in users (these are kilobytes, well under any cap).

**This means ARCHITECTURE.md's Pattern 4 (direct-to-Supabase signed upload) is superseded.** The upload data flow described in ARCHITECTURE.md's "Flow 1: Anonymous Upload + Transcribe" — which routes audio through Supabase Storage — does not apply. Everything else in ARCHITECTURE.md stands.

Spike recommended before Phase 1: verify TUS chunk assembly works cleanly through a named Cloudflare Tunnel on the developer's actual network (LAN upload to localhost vs. WAN upload through the tunnel have different behavior).

### Resolution 2 — Progress Channel

**Conflict:** ARCHITECTURE.md asserted SSE through Cloudflare Tunnel is unreliable due to documented buffering (cloudflared issues #199, #1449) and that progress must go through Supabase Realtime. STACK.md asserted SSE is safe through Cloudflare Tunnel because it has no idle timeout equivalent to WebSocket's 100s.

**Both claims are correct and address different failure modes.** The buffering issue and the timeout issue are separate problems.

**Resolution: Supabase Realtime (Postgres Changes on the `jobs` table) is the primary progress channel. SSE via `sse-starlette` is retained in the FastAPI codebase as a fallback for local development and debugging only.**

Rationale: The buffering problem documented in cloudflared issues #199 and #1449 means SSE responses are held by the tunnel until the connection closes — the progress bar would sit at 0% and jump to 100% at the end, every time. This is a user-trust problem, not a timeout problem. Supabase Realtime sidesteps the tunnel entirely for the progress path: the FastAPI worker writes progress updates to the `jobs` row in Postgres, and Supabase's own Realtime WebSocket (which terminates at Supabase, not at the tunnel) pushes the change to the browser. This works for both anonymous and signed-in users (anonymous jobs use an `anon_token` column for RLS-scoped subscriptions).

STACK.md's SSE-via-tunnel observation (no idle timeout for SSE) is noted and remains useful if the Supabase Realtime free-tier quota is ever exhausted, but that quota is generous (200 concurrent connections, 2 million messages/month on free tier) and should not be a concern for this project's scale.

**Practical consequence:** The FastAPI `job.events` asyncio.Queue and the `sse-starlette` endpoint (`GET /jobs/{id}/events`) described in STACK.md can still be built — they are useful for local development, health-check tooling, and as an explicit fallback. They should not be the production progress path through the tunnel.

---

## Stack at a Glance

All versions verified against PyPI, upstream repos, and vendor docs as of 2026-04-27.

| Layer | Technology | Version | Role |
|-------|-----------|---------|------|
| Frontend framework | Next.js | 15.x (App Router) | SPA shell + SSR for history |
| UI runtime | React | 19.x | Comes with Next.js 15 |
| Styling | Tailwind CSS | 4.x | CSS-first config |
| Components | shadcn/ui | latest (2026-04) | Vendored headless primitives |
| Frontend types | TypeScript | 5.6+ | Standard |
| Backend framework | FastAPI | ≥0.115 | HTTP + async job handling |
| Backend runtime | Python | 3.11.x | Sweet spot for WhisperX + pyannote |
| Transcription pipeline | WhisperX | 3.8.5 | ASR + word alignment + diarization |
| ASR engine | faster-whisper | ≥1.2.0, <2.0 | CTranslate2-backed; 4–6x speedup |
| Inference engine | ctranslate2 | ≥4.5.0, <5.0 | Requires CUDA 12.3+ / cuDNN 9 |
| Diarization | pyannote.audio | ≥3.3.2, <4.0 | WhisperX 3.8.5 does not support pyannote 4 |
| DL framework | torch | 2.4–2.6 (match CUDA wheel) | Transitive; use cu124 wheel |
| Audio preprocessing | ffmpeg | ≥6.0 (system binary) | Decode + normalize to 16kHz mono |
| Database + auth | Supabase | hosted free tier | Postgres + Auth (JWKS) + Realtime |
| Frontend Supabase | @supabase/ssr | 0.7.x | Only supported Next.js 14+ pattern |
| Backend Supabase | supabase (supabase-py) | 2.x | Service-role writes from FastAPI |
| JWT verification | PyJWT[crypto] | ≥2.9, <3.0 | ES256 via JWKS endpoint |
| SSE (dev/fallback) | sse-starlette | 2.x | Local dev progress streaming only |
| Upload client | tus-js-client | 4.x | Chunked upload for files ≥90 MB |
| Rate limiting | slowapi | 0.1.9+ | Per-IP on FastAPI endpoints |
| Job queueing | asyncio.Queue + asyncio.Lock | stdlib | No Redis/Celery for v1 |
| Public exposure | Cloudflare Tunnel (cloudflared) | latest | Named tunnel + custom domain |
| Frontend deployment | Vercel | free tier | Auto-deploy on push to main |
| State (frontend) | Zustand | 5.x | Transcript editor state |
| Data fetching | @tanstack/react-query | 5.x | SSE/polling integration |
| Python env manager | uv | latest | 10–100x faster than pip |
| Node package manager | pnpm | latest | Monorepo-friendly |
| Backend linting | ruff | latest | Replaces black + isort + flake8 |
| Backend testing | pytest + pytest-asyncio + asgi-lifespan | latest | Async-native; required for lifespan worker |
| ASR quality testing | jiwer | 4.x | Word error rate thresholds |
| Frontend E2E | Playwright | 1.5x | Standard for Next.js |
| Frontend unit | Vitest | 2.x | Replaces Jest; native ESM |

### Version Compatibility Matrix (Critical)

| Combination | Status |
|-------------|--------|
| `whisperx==3.8.5` + `pyannote.audio>=4.0` | BROKEN — pin `pyannote.audio<4` |
| `whisperx==3.8.5` + `faster-whisper<1.2.0` | BROKEN — WhisperX 3.8.2 was yanked for this |
| `ctranslate2>=4.5` + cuDNN 8 | BROKEN at runtime — upgrade host to cuDNN 9 or pin `ctranslate2==4.4.0` |
| `@supabase/auth-helpers-nextjs` + Next.js 15 | NOT SUPPORTED — use `@supabase/ssr` |
| `whisperx` + Python 3.13 | UNTESTED — use 3.11 |

---

## Quality Presets — Model Mapping

| Preset | Model | VRAM Required | Speed (vs realtime) | WER (hard audio) |
|--------|-------|--------------|---------------------|-----------------|
| Fast | `small` (CT2 fp16) or `medium` | 2–5 GB | 20–40x | Higher; suitable for "get the gist" |
| **Average (default)** | **`large-v3-turbo`** | **~6 GB** | **~30–60x with WhisperX batching** | **~12% (~2pp worse than large-v3)** |
| Slow | `large-v3` | ~10 GB | ~10–20x | ~10%; best for non-English/spontaneous |

**Key recommendation:** Average defaults to `large-v3-turbo`, NOT `large-v3`. The turbo model is a 4-decoder-layer pruned finetune of large-v3 (~809M params vs 1.54B), roughly 6x faster with only ~2pp WER regression on hard audio. When users explicitly choose Slow, they want the best output (especially for non-English), so `large-v3` is correct there.

**VRAM gate:** At startup, FastAPI detects `torch.cuda.get_device_properties(0).total_memory`. If VRAM < 12 GB, the "Slow" preset is gated off and the UI disables it with an explanation. `int8` quantization in faster-whisper is the default; this drops `large-v3` to ~5 GB effective.

---

## Locked Architectural Decisions

These are locked after synthesis. Roadmap phases should not revisit them without a new research trigger.

| Decision | Resolution | Rationale |
|----------|-----------|-----------|
| Upload path | TUS chunked upload directly to FastAPI through Cloudflare Tunnel (chunk ≤ 90 MB) | CF Tunnel free: 100 MB body cap. Supabase Storage free: 50 MB/file cap. Neither works for source media as-is. Chunked-to-FastAPI is the only viable free-tier path. See Resolved Trade-off 1. |
| Progress channel | Supabase Realtime (Postgres Changes on `jobs` table), primary. SSE retained for dev/fallback only. | CF Tunnel buffers SSE (cloudflared #199, #1449) — progress bar shows 0% then 100%. Realtime avoids the tunnel entirely for progress. See Resolved Trade-off 2. |
| Job queueing | `asyncio.Queue` + `asyncio.Lock` + single background worker task, started in FastAPI lifespan | Single GPU, single host, single job. Redis/Celery adds a service for what is fundamentally a singleton. ~50 lines of stdlib. |
| Model lifecycle | Load all WhisperX models once at FastAPI lifespan startup; hold in VRAM for process lifetime | Re-loading costs 20–60s per request. The single-job queue means there is no benefit to lazy loading. |
| Transcript persistence | Single `jsonb` payload column per transcript row in Postgres, not row-per-segment | Transcript is read and written as a whole document. Segment-level relational queries are not a use case. One UPDATE per save, one SELECT per load, schema-flexible. |
| Service-role key perimeter | Service-role key lives only on the FastAPI host machine, never on Vercel, never in any `NEXT_PUBLIC_*` env var | Key bypasses all RLS. Public portfolio repo + misconfigured .env = full data exposure. FastAPI is the perimeter for all backend-owned writes. |
| Frontend transcript editor | Roll-your-own with shadcn primitives + `useReducer` (or Zustand), NOT Tiptap/Lexical/Slate | A diarized transcript is structural data (segments × speakers × word timings), not prose. Rich-text frameworks model it as rich text and the dev fights the framework. Editing surface is ~200–300 LoC of custom code. |
| Source media retention | Transient — FastAPI deletes the assembled temp file after transcription completes | Source media is never persisted to Supabase Storage. Supabase Storage is only used for transcript JSON artifacts for signed-in users. |
| Vercel function path | Browser calls FastAPI directly via `NEXT_PUBLIC_BACKEND_URL`; no Next.js API route in the transcription data path | Vercel Hobby: 60s function timeout. A 5-minute transcription through a Vercel proxy returns 504. Only lightweight Supabase operations (signed upload URLs, history reads) go through Next.js Server Actions. |
| Auth pattern | `@supabase/ssr` 0.7.x on Next.js; JWT verification via JWKS (`PyJWKClient`) in FastAPI; anonymous users get no JWT, use `X-Anon-Token` header keyed to `jobs.anon_token` | `@supabase/auth-helpers-nextjs` deprecated. Supabase migrated to ES256/JWKS. HS256 shared-secret is being phased out. |
| Export rendering | All exports (.txt, .srt, .vtt, .json) rendered in-browser from the in-memory payload. Backend outputs canonical JSON only. | Post-edit, server-side render is stale immediately. In-browser render is always current, requires no round-trip, and keeps the backend stateless after producing the transcript. |

---

## Feature Priorities

### Table Stakes (v1 — must ship)

Features that distinguish "product" from "demo." Missing any reads as amateur to a reviewer.

| Feature | Complexity | Portfolio Signal |
|---------|-----------|-----------------|
| Drag-and-drop upload with visible size/duration cap before upload starts | S | — |
| Quality preset (Fast/Average/Slow) with one-line hint text | S | — |
| Diarization toggle + auto/fixed speaker count | S | — |
| Language auto-detect with override + "detected: es" shown in result | S | — |
| Honest progress UX with stage labels (Queued → Extracting → Transcribing → Diarizing → Aligning) | M | HIGH — most demos fake this |
| Speaker-labeled transcript with per-turn timestamps | S | — |
| Color-coded speakers (hash speaker-id → accessible palette) | S | HIGH — 30-line change, dramatic visual lift |
| Click-to-seek + `<audio>` player with 1x/1.25x/1.5x/2x playback speed | S | — |
| Speaker rename, applied globally | S | — |
| Segment reassign with "apply to every instance of this speaker" | M | — |
| Inline text edit (fix mishears) | M | — |
| Find-in-transcript (jump to result + audio seek) | S | HIGH — cheap, huge utility on 90-min files |
| Copy-to-clipboard with timestamp/speaker toggles | S | HIGH — highest ratio of polish per LOC |
| Download as .txt, .srt, .vtt, .json | S | — |
| Markdown download | S | HIGH — directly serves "drop into Notion" use case |
| Per-IP rate limit + file-size cap + single-job queue | M | — |
| Anonymous transcribes (no sign-in required) | S | — |
| Supabase magic-link sign-in (no password auth) | S | — |
| History view (list, rename, delete, re-open) for signed-in users | M | — |
| Auto-save edits to localStorage with restore-on-load prompt | S | HIGH — users only notice when missing |
| Privacy posture statement under the upload control | S | HIGH — differentiates from cloud SaaS in 3 seconds |

### Differentiators — Add After v1 Validation (v1.x)

| Feature | Complexity | Trigger |
|---------|-----------|---------|
| Read-along highlight (current segment highlighted as audio plays) | M | v1 click-to-seek is stable; performance budget understood |
| Find-and-replace | S | Friend reports recurring mishears |
| Confidence-shaded text + "needs review" badges | M | Confirm WhisperX exposes per-word confidence cleanly |
| Read mode vs Edit mode toggle | S | Feedback that long transcripts feel cluttered |
| Keyboard shortcuts with ? help overlay | M | Stable editor UX; ready for power-user affordances |
| Undo/redo stack | M | Edit complexity grows past simple text fixes |
| In-browser microphone recording | M | A use case actually appears |

### Explicit Anti-Features (Do Not Build)

| Feature | Reason |
|---------|--------|
| YouTube URL input | Legal exposure (copyright); yt-dlp actively broken by YouTube; users can upload the file themselves |
| Real-time / streaming transcription | Out of scope per PROJECT.md; completely different UX surface |
| Translation | Out of scope; quality varies; users reach for DeepL |
| AI summary / chapters / action items | Requires paid LLM or heavy local LLM — violates $0/month constraint |
| Multi-user collaboration | Out of scope; fights the anonymous-by-default posture |
| Password-based auth | More attack surface; Supabase magic links cover the same ground with less code |
| OpenAI Whisper API as fallback | Per-minute cost — violates the $0/month constraint |
| DOCX / PDF export | Heavy dependencies; Markdown + Pandoc covers the same ground |

### Portfolio-Quality Cheap Wins (Highest Leverage)

1. Color-coded speakers — 30-line change, transforms the visual feel
2. Find-in-transcript — instantly turns a wall of text into a searchable artifact
3. Copy-to-clipboard with toggles — one button, two checkboxes, ten-fold daily utility
4. Markdown export — one extra formatter, directly serves the friend's Notion workflow
5. Honest staged progress — most demos fake this; doing it right is a clear craft signal
6. Auto-save to localStorage — users only notice when it's missing
7. Privacy posture statement — one sentence that differentiates from cloud SaaS immediately
8. A real README with screenshots, demo gif, .env.example, one-command bootstrap

---

## Top Pitfalls to Defuse Early

Ordered by leverage (highest damage if ignored, easiest to prevent proactively).

### 1. PyTorch / CUDA / cuDNN / ctranslate2 Version-Soup (Phase 0)

A single mismatched package causes one of: `libcudnn_ops_infer.so.8: cannot open`, silent CPU fallback (pipeline "works" at 30x realtime), or OOM at the wrong moment. pip's resolver does not enforce ABI compatibility across these packages.

**Prevention:** Pin a single tested matrix in `pyproject.toml`. The April 2026 working matrix: `torch==2.5.1+cu124`, `ctranslate2>=4.5.0`, `faster-whisper>=1.2.0`, `pyannote.audio>=3.3.2,<4`, `whisperx==3.8.5`. Use a `uv` lockfile. Add a startup self-check that prints `torch.cuda.is_available()`, `torch.version.cuda`, `torch.backends.cudnn.version()`, and asserts GPU — fail-fast, do not silently fall back to CPU.

### 2. Supabase RLS Off-By-Default for SQL Tables (Phase 0)

Tables created via SQL migrations have RLS disabled by default (only dashboard Table Editor enables it automatically). The `anon` key is intentionally public in `NEXT_PUBLIC_SUPABASE_ANON_KEY` — but it grants full table access when RLS is off. This was the mechanism in the "Lovable incident" that exposed 170+ apps in early 2025.

**Prevention:** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in every migration, same file as `CREATE TABLE`. Write a deny-all default, then add allow policies. Add a CI test: `SELECT * FROM pg_tables WHERE schemaname='public' AND rowsecurity=false` must return zero rows.

### 3. pyannote HuggingFace Token + Interactive License Accept (Phase 1)

Diarization silently skips (no error, no speakers) if `HF_TOKEN` is absent or if the license hasn't been accepted interactively on two separate HuggingFace model pages: `pyannote/segmentation-3.0` AND `pyannote/speaker-diarization-3.1`. Token-only without prior browser-based license accept returns 403.

**Prevention:** README has a "Diarization setup" section with exact URLs and a step-by-step. Backend startup prints a friendly message if HF_TOKEN is missing or the probe returns 401/403. `.env.example` has `HF_TOKEN=` placeholder. Provide a `--no-diarization` mode for contributors without HF accounts.

### 4. Vercel 60s Function Timeout (Phase 2)

Any Next.js API route or Server Action that proxies a transcription request to FastAPI will time out at 60 seconds (Vercel Hobby hard cap). The job completes on the backend; the user sees a 504 failure. This is unrecoverable without redesigning the upload flow.

**Prevention:** The browser calls FastAPI directly via `NEXT_PUBLIC_BACKEND_URL`. The job-submission pattern is: browser POSTs to FastAPI, gets `job_id` instantly, subscribes to Supabase Realtime for progress. No Next.js API route in the transcription data path. Only fast Supabase operations (issue signed upload URL, read history) go through Next.js Server Actions.

### 5. Cloudflare Tunnel 100 MB Body Cap (Phase 1)

Any single HTTP POST body over 100 MB is rejected at the Cloudflare edge with 413. The backend never sees the request. This is not configurable on the free plan.

**Prevention:** Resolved via the upload path decision above: TUS chunked upload with `chunkSize: 90 * 1024 * 1024`. Also enforce a client-side file size pre-check so the user knows before the upload starts. Backend re-validates with `ffprobe` after assembly.

### 6. Secrets in the Public Repo (Phase 0)

`.env` files not in `.gitignore` from commit 0. The Supabase service-role key, `HF_TOKEN`, or Cloudflare tunnel credentials committed once are permanent in git history (filter-repo can scrub, but it's painful on a public portfolio repo).

**Prevention:** `.gitignore` from the very first commit: `.env*`, `!.env.example`, `*.pem`, `cloudflared/`, `~/.cloudflared/`. Pre-commit hook running `gitleaks` or `detect-secrets`. GitHub secret-scanning catches known providers but not HF tokens or Supabase service-role keys — do not rely on it.

### 7. WhisperX large-v3 VRAM Requirement on Smaller GPUs (Phase 1)

`large-v3` requires ~10 GB VRAM for inference at fp16, plus additional VRAM for pyannote diarization and wav2vec2 alignment coexisting in memory. OOM mid-load on an 8 GB card will crash the worker.

**Prevention:** Detect VRAM at startup; gate the "Slow" preset behind a 12 GB check. Use `int8` quantization as default (drops large-v3 to ~5 GB effective). Validate with a 20-job soak test before calling Phase 1 backend pipeline done.

### 8. GPU Memory Leak Across Jobs (Phase 1)

First job: 4 GB. Second: 6 GB. Tenth: OOM. The pattern is orphaned tensors from re-loading models without explicit CUDA cache clearing. Python GC does not free CUDA memory promptly.

**Prevention:** Load models once at startup (hold in VRAM permanently); only `torch.cuda.empty_cache()` between jobs to release activation memory. Add a `/metrics` endpoint reporting `torch.cuda.memory_allocated()`. Run a 20-job soak test as a Phase 1 backend exit criterion.

---

## Build Order Recommendation

Adapted from ARCHITECTURE.md's lane diagram, with the upload-path and progress-channel conflicts resolved. A solo developer can alternate between lanes B and C (e.g., kick off a model download, work on frontend while waiting).

### Phase 0: Foundation (blocker for everything)

- Supabase project: create, apply migrations 0001 (tables), 0002 (RLS), 0003 (Realtime publication). RLS on from the first migration.
- Repo skeleton: `frontend/`, `backend/`, `supabase/` directories, `.gitignore` (with `.env*` from commit zero), pre-commit hooks (`gitleaks` + `ruff`), LICENSE, README skeleton.
- `.env.example` with all variables documented.
- Cloudflare Tunnel: named tunnel + custom domain (stable hostname). Resolve domain decision before this phase closes (see Open Questions).

Deliverable: empty-but-correctly-wired monorepo, database schema in place, public URL stable, secrets-safe from commit zero.

Research flags: WSL2 vs. native Linux decision; Cloudflare domain decision. Both block Phase 0 completion.

### Phase 1: Backend Pipeline (parallelizable with Phase 2 after Phase 0)

- Startup self-check: assert CUDA, cuDNN, torch versions; fail-fast if GPU not available.
- `backend/scripts/transcribe_local.py`: end-to-end WhisperX pipeline (ffmpeg normalize → ASR → alignment → diarization → merge to segments JSON) as a standalone script. Proves the pipeline works on the dev's GPU before any web layer exists.
- FastAPI shell: `main.py` with `/healthz`, `/readyz`, lifespan model loading, startup VRAM check.
- `asyncio.Queue` + single worker task wired into lifespan; test with a stub pipeline.
- Real `/jobs` POST route: accepts job options, enqueues, returns `job_id`. Writes progress to `jobs` Postgres row via `supabase-py` with service-role key (this is what Realtime broadcasts).
- JWT verification dependency: JWKS-based `current_user_optional` dep.
- TUS chunked upload endpoints: assemble to temp dir; enqueue on completion.
- Golden fixture tests: 3–5 short audio clips (10–30s) with reference transcripts. Marked `@pytest.mark.gpu`; skipped in CI.
- 20-job VRAM soak test. Run locally before declaring Phase 1 done.

Research flags: WhisperX progress callback hookability (real per-batch vs. stage-level only); empirical CUDA/cuDNN quartet on the developer's actual GPU; TUS-through-tunnel spike.

### Phase 2: Frontend Skeleton (parallelizable with Phase 1 after Phase 0)

- Next.js 15 app shell: layout, dark mode, Tailwind, shadcn/ui init. Deploy to Vercel from day one.
- `@supabase/ssr` auth wired: middleware, sign-in page (magic link), sign-out. Anonymous flows work.
- Upload UI (against mock backend): file picker, drag-and-drop, options form (preset, diarize toggle, speaker count, language). TUS client wired for files ≥ 90 MB; plain multipart for smaller files.
- Progress UI subscribed to Supabase Realtime: subscribe to `jobs` row, show stage labels and progress bar. Test by manually updating rows in Supabase Studio.
- Transcript editor component: render a hardcoded payload, support speaker rename (global), inline text edit, segment reassign with apply-everywhere. Pure local state initially.
- In-browser exporters: `.txt`, `.srt`, `.vtt`, `.json`, `.md` renderers. Vitest-tested.

Research flags: SRT/VTT timestamp formatting edge cases (>1h durations, fractional seconds, BOM, CRLF vs. LF) warrant explicit test fixtures.

### Phase 3: Integration

- End-to-end anonymous flow: real TUS upload to FastAPI, real job queue, real Supabase Realtime progress, real transcript rendered in editor.
- End-to-end signed-in flow + history: FastAPI inserts transcript row on job success; history page lists and re-opens saved transcripts.
- Public-URL safety: per-IP rate limit on FastAPI (slowapi + `cf-connecting-ip` header), file-size cap (client pre-check + `ffprobe` backend re-check), duration cap.
- Graceful offline state: health probe on landing page; upload control disabled with "host is asleep" message when FastAPI unreachable.

### Phase 4: Hardening + Polish

- Security audit: RLS CI test in place, secret scan passing, FastAPI bound to 127.0.0.1, Supabase Storage buckets private, no service-role key outside FastAPI.
- VRAM management validation: 20-job soak test passes.
- Mock engine CI: all routes/queue/RLS tests run without a GPU.
- Portfolio polish: README with screenshots, demo gif, `.env.example`, one-command bootstrap, self-hosting guide, ADRs committed, commit history cleaned.
- OS power management docs: sleep prevention instructions for Linux and Windows.

### Critical-Path Ordering

```
Phase 0 (foundation)
   |
   |---> Phase 1 (backend pipeline) -------------------------------------------+
   |                                                                            +--> Phase 3 --> Phase 4
   +---> Phase 2 (frontend skeleton) ------------------------------------------+
```

---

## Open Questions / Spike Candidates

| Question | Affects | How to Resolve |
|----------|---------|---------------|
| **Host OS** — Linux native vs. Windows + WSL2 vs. Windows native? | Phase 0/1 | Developer confirms in PROJECT.md Key Decisions. WSL2 CUDA passthrough works on CUDA 12+ but has ffmpeg cross-filesystem friction and tunnel placement ambiguity. Native Linux is simpler. |
| **Cloudflare domain** — stable named-tunnel + custom domain vs. trycloudflare.com URL churn | Phase 0 | Developer confirms domain they own or will buy. trycloudflare.com URLs change on every restart; NEXT_PUBLIC_BACKEND_URL would require a Vercel redeploy each time. Named tunnel requires a registered domain (approx. $10/year). Pre-Phase-0 decision. |
| **TUS chunked upload through Cloudflare Tunnel** — does chunk assembly work cleanly on the developer's actual network? | Phase 1 | Small spike: upload a 150 MB test file in 90 MB chunks through a named tunnel. Verify reassembly and that no chunk hits the 100 MB edge cap in practice (90 MB leaves 10 MB headroom for headers/encoding overhead). |
| **Empirical CUDA/cuDNN/torch/ctranslate2 quartet** — does the recommended matrix actually run on the developer's GPU? | Phase 1 | Run the startup self-check and `transcribe_local.py` on a small fixture immediately after install. Verify nvidia-smi shows GPU utilization during transcription. |
| **WhisperX progress callback hookability** — does WhisperX 3.8.5 expose a per-batch callback, or is progress interpolated between stages? | Phase 1 | Check WhisperX source for `progress_callback` argument to `transcribe()`. If absent, the only honest progress signal is stage-level. Document the answer in Phase 1. |
| **GPU model and VRAM** — developer's specific card | Phase 1/2 | Developer confirms GPU model and VRAM. Determines whether "Slow" preset is gateable, what int8 quantization achieves, and the soak test baseline. |

---

## Pre-Phase-0 User Inputs Required

The roadmapper should flag these as blockers for the setup phase.

| Input | Why Needed | Where to Record |
|-------|-----------|----------------|
| HuggingFace account + read-scoped `HF_TOKEN` | Required for pyannote diarization model download. Must accept licenses on two model pages interactively in a browser. | `.env` on backend machine; README must link both acceptance pages |
| GPU model and VRAM | Determines which presets are safe to advertise; affects int8 quantization decisions; sets the baseline for VRAM leak test | PROJECT.md Key Decisions |
| Host OS (Linux native / Windows + WSL2 / Windows native) | CUDA setup instructions differ; ffmpeg PATH and tunnel placement differ; README must state the tested path | PROJECT.md Key Decisions |
| Domain name for Cloudflare named tunnel | Required for a stable `NEXT_PUBLIC_BACKEND_URL` that does not change on tunnel restart | Cloudflare Tunnel config; Vercel env vars |
| Supabase project reference and keys | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` for both frontend and backend | `.env` files (never committed); documented in `.env.example` |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|-----------|-------|
| Stack | HIGH | All versions verified against PyPI, upstream issue trackers, and official docs on 2026-04-27. Version compatibility matrix confirmed against WhisperX issues #954, #1158, #1240, #1300. |
| Features | HIGH | Competitor feature parity well-documented; table-stakes list consistent across Otter/Descript/Sonix/Rev/Whisper-WebUI comparisons. Feature priorities are opinionated but grounded in stated use case. |
| Architecture | HIGH for component responsibilities and data model; MEDIUM for conflict resolutions | The upload-path and progress-channel resolutions are based on verified platform limits, but the TUS-through-tunnel path has not been tested on the developer's actual network. Spike recommended. |
| Pitfalls | HIGH for stack/version/platform-limit claims; MEDIUM for UX edge cases | Platform limits (CF 100 MB, Supabase 50 MB, Vercel 60s) verified against vendor docs. VRAM figures verified against upstream discussions. WSL2 behavior is MEDIUM — works generally; project-specific friction unknown. |

**Overall confidence: HIGH**

### Gaps to Address During Implementation

- **WhisperX progress callback:** Until the source is inspected, progress granularity within the "Transcribing" stage is unknown. Plan for stage-level progress as the baseline; batch-level as a stretch goal.
- **TUS library selection:** `tuspyserver` on PyPI is a candidate for the FastAPI server side, but a custom minimal TUS implementation (~150 LoC) may be simpler. Decide during Phase 1 spike.
- **Alignment model caching per-language:** WhisperX lazy-loads a separate wav2vec2 alignment model per language. The caching strategy (load once on first use, cache in `app.state`) needs implementation and testing with multi-language inputs.
- **Anon job RLS via `anon_token`:** The `current_setting('request.headers')::jsonb ->> 'x-anon-token'` RLS pattern is functional but has alternatives (Edge Function proxy, token-as-ID-prefix). Verify against the Supabase Realtime subscription pattern before Phase 3 integration.

---

## Sources

### Primary (HIGH confidence — official docs, upstream repos, vendor limits)

- [WhisperX 3.8.5 on PyPI](https://pypi.org/project/whisperx/) — version, Python range, release date
- [WhisperX GitHub](https://github.com/m-bain/whisperX) — installation, dependency expectations, HF token requirement
- [faster-whisper on PyPI](https://pypi.org/project/faster-whisper/) — CUDA/cuDNN matrix
- [WhisperX issue #1240](https://github.com/m-bain/whisperX/issues/1240), [#1300](https://github.com/m-bain/whisperX/issues/1300) — pyannote 4 incompatibility
- [pyannote/speaker-diarization-3.1 on HF](https://huggingface.co/pyannote/speaker-diarization-3.1) — gating, two-model acceptance
- [Cloudflare community — 100MB tunnel limit](https://community.cloudflare.com/t/100mb-tunnel-limit/901339) — confirmed hard cap
- [Cloudflare WebSockets docs](https://developers.cloudflare.com/network/websockets/) — 100s idle timeout
- [cloudflared issue #199](https://github.com/cloudflare/cloudflared/issues/199), [#1449](https://github.com/cloudflare/cloudflared/issues/1449) — SSE buffering in tunnel
- [Supabase Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits) — 50 MB/file free-tier cap
- [Supabase JWTs / JWKS](https://supabase.com/docs/guides/auth/jwts) — ES256 migration
- [Supabase SSR Next.js docs](https://supabase.com/docs/guides/auth/server-side/nextjs) — canonical client patterns
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) — 60s Hobby timeout
- [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — off-by-default for SQL migrations

### Secondary (MEDIUM confidence — engineering blogs, community consensus)

- [Modal — Choosing Whisper variants](https://modal.com/blog/choosing-whisper-variants) — engine comparison
- [pcxio — large-v3 vs turbo](https://pcxio.com/whisper-large-v3-vs-whisper-large-v3-turbo-the-speed-revolution/) — VRAM/speed/accuracy
- [Cloudflare community — SSE no 524 timeout](https://community.cloudflare.com/t/are-server-sent-events-sse-supported-or-will-they-trigger-http-524-timeouts/499621)
- [Petrina — Bypassing CF upload limit](https://tpetrina.com/til/2025-01-02-cloudflare-upload-limit)
- [byteiota — Supabase RLS / Lovable incident](https://byteiota.com/supabase-security-flaw-170-apps-exposed-by-missing-rls/)
- [davidmuraya — FastAPI BG tasks vs ARQ](https://davidmuraya.com/blog/fastapi-background-tasks-arq-vs-built-in/)
- [La Javaness — pyannote vs NeMo](https://lajavaness.medium.com/comparing-state-of-the-art-speaker-diarization-frameworks-pyannote-vs-nemo-31a191c6300)
- [Smart Interface Design Patterns — loading/progress UX](https://smart-interface-design-patterns.com/articles/designing-better-loading-progress-ux/)

---

*Research completed: 2026-04-27*
*Ready for roadmap: yes*

---

## Amendment 2026-04-27 — Engine Pivot (Post-Research)

After PROJECT.md was written and research was done, the developer supplied actual hardware: **AMD Radeon RX 6600 (8 GB VRAM, RDNA2) on Ubuntu 26.04 LTS**. The CUDA-based stack proposed throughout this document — WhisperX 3.8.5, faster-whisper, ctranslate2, torch+cu124 — is **NOT available on this hardware**. CUDA is NVIDIA-exclusive; the RX 6600 is AMD/RDNA2 and is officially unsupported in ROCm 6+.

### Engine pivot — locked

- **Transcription:** `whisper.cpp` with the Vulkan backend (works on any GPU, including AMD RDNA2). Model files in GGML/GGUF format (e.g., `ggml-medium.bin`, `ggml-large-v3-turbo.bin`).
- **Diarization:** `pyannote.audio` 3.x running on **CPU** (no torch.cuda dependency). Slower than GPU pyannote (≈5–10 minutes for a 90-minute file on a modern desktop CPU), but reliable and zero-cost.
- **Alignment / word timestamps:** whisper.cpp emits per-word timestamps natively when invoked with `--output-json-full` / equivalent — no separate wav2vec2 alignment step is required. (This actually simplifies the pipeline relative to WhisperX, which needed a third model.)
- **Quality preset → model mapping (revised for 8 GB Vulkan):**
  - **Fast** = `ggml-small.bin` or `ggml-base.bin` (whichever benchmarks better on RX 6600)
  - **Average (default)** = `ggml-medium.bin` (≈1.5 GB) or `ggml-large-v3-turbo.bin` (≈1.6 GB) if it loads cleanly under Vulkan with diarization concurrent in CPU/RAM
  - **Slow** = `ggml-large-v3.bin` (≈3.0 GB GGUF q5_0) — **gated off by default on 8 GB**, can be unlocked via a single config flag for users on bigger cards
- **Phase 2 must include a benchmarking spike** that measures realtime factor for each candidate model on the RX 6600 with whisper.cpp + Vulkan, plus pyannote-CPU wall-time on a 90-minute file, before declaring the preset map final.

### Stack rows that change

| Layer | Old (CUDA stack) | New (AMD/Vulkan stack) |
|---|---|---|
| Transcription engine | WhisperX 3.8.5 | whisper.cpp (Vulkan-built; via `pywhispercpp` or subprocess to `whisper-cli`) |
| Inference engine | ctranslate2 ≥ 4.5 (CUDA 12.3+/cuDNN 9) | whisper.cpp's Vulkan backend (no Python ML runtime needed for ASR) |
| ASR runtime | faster-whisper ≥ 1.2 | whisper.cpp |
| DL framework for ASR | torch 2.4–2.6 (cu124 wheel) | None (whisper.cpp is C++) |
| Word alignment | wav2vec2 via WhisperX | whisper.cpp native word timestamps |
| Diarization | pyannote.audio ≥3.3.2,<4 (on GPU) | pyannote.audio ≥3.3.2,<4 (on CPU; `device=torch.device("cpu")`) |
| GPU runtime check | `torch.cuda.is_available()` | `vulkaninfo` / whisper.cpp `--list-devices` |

### Stack rows that survive unchanged

- All frontend (Next.js, Shadcn, Tailwind, `@supabase/ssr`, `tus-js-client`, Zustand, react-query, Vitest, Playwright)
- All Supabase wiring (Auth via JWKS, Realtime, Storage for transcript JSON only)
- FastAPI + asyncio.Queue/Lock single-job queue
- TUS chunked upload, 90 MB chunks
- Supabase Realtime (Postgres Changes on `jobs`) as the progress channel
- Service-role key perimeter
- All security / RLS / secret hygiene requirements

### Tunnel decision change

The user has no registered domain, so a **Cloudflare Quick Tunnel** (`trycloudflare.com`) is used for v1. Hostname churn on tunnel restart is accepted; the Vercel `NEXT_PUBLIC_BACKEND_URL` env-var-update + redeploy step is documented in the README. A named tunnel with a custom domain remains the recommended v2 upgrade path once a domain is registered.

### Pitfalls section additions (informal)

- **Vulkan SDK setup on Ubuntu 26.04:** install `mesa-vulkan-drivers`, `libvulkan-dev`, and `vulkan-tools`; verify with `vulkaninfo --summary`. AMD's Mesa driver is the working path; do NOT install AMD's proprietary `amdgpu-pro` driver (incompatible with modern Mesa Vulkan on consumer cards).
- **whisper.cpp build:** clone the repo, `cmake -B build -DGGML_VULKAN=1 && cmake --build build --config Release`. The `whisper-cli` binary or the Python `pywhispercpp` package both work; choose subprocess for simplicity (less binding-version drift).
- **Model files:** download GGML/GGUF model files from the whisper.cpp HuggingFace mirror; pin model SHA-256 in `.env.example` for reproducibility.
- **Pyannote on CPU:** explicitly set `pipeline.to(torch.device("cpu"))` after instantiation; without this, pyannote 3.x will try to use CUDA if torch detects any CUDA device (it won't on AMD-only machines, but the explicit cast prevents future surprises).
- **Concurrent device memory:** whisper.cpp Vulkan and pyannote-CPU don't compete for VRAM, but they DO compete for host RAM during pyannote diarization. Run a wall-clock test with the largest expected file before promising any ETA.

This amendment supersedes the affected portions of "Stack at a Glance," "Quality Presets — Model Mapping," and the WhisperX/CUDA-specific items in "Top Pitfalls to Defuse Early." The original sections are retained for traceability but should be read with this amendment in mind.

