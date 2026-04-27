# Roadmap: Transcribe

## Overview

Transcribe is a free, self-hostable web app that turns long audio/video into editable, speaker-labeled transcripts using WhisperX on the developer's home GPU, with $0/month recurring cost. The journey: lay a secure foundation (monorepo, Supabase schema with RLS-from-day-zero, Cloudflare named tunnel, secret hygiene), then build the backend transcription pipeline and the frontend editor in parallel against a shared `jobs` table contract, integrate them end-to-end with auth and history, harden the public URL against abuse and misconfiguration, and finish with the portfolio polish (README, demo gif, clean commit history) that makes it worth linking to.

The architecture is locked: source media uploads via TUS chunked POST directly to FastAPI through the tunnel (90 MB chunks); progress flows over Supabase Realtime (Postgres Changes on `jobs`), never SSE through the tunnel; the service-role key never leaves the FastAPI host. These decisions are not revisited at phase boundaries.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Phases 2 and 3 can execute in parallel (independent lanes after Phase 1).

- [ ] **Phase 1: Foundation** - Monorepo skeleton, Supabase schema with RLS, Cloudflare named tunnel, secret hygiene
- [ ] **Phase 2: Backend Pipeline** - WhisperX pipeline, FastAPI with single-job queue, TUS upload, JWT verification (parallel with Phase 3)
- [ ] **Phase 3: Frontend Skeleton** - Next.js upload + editor + Realtime progress UI + in-browser exporters (parallel with Phase 2)
- [ ] **Phase 4: Integration & Auth** - End-to-end anonymous and signed-in flows, magic-link auth, history view
- [ ] **Phase 5: Public-URL Safety & Hardening** - Rate limiting, file/duration caps, origin lockdown, offline UX, RLS CI gate, soak validation
- [ ] **Phase 6: Portfolio Polish** - README with screenshots/demo gif, contributing docs, clean commit history

## Phase Details

### Phase 1: Foundation
**Goal**: A correctly-wired empty monorepo where every secret is gitignored from commit zero, the Supabase schema has RLS on every public table, and a stable public hostname resolves to the (empty) backend.
**Depends on**: Nothing (first phase). **BLOCKED by user inputs** — see "User-Blocked Items" below.
**Requirements**: REPO-01, REPO-03, REPO-04, REPO-05, SEC-01, SEC-04, SEC-05, OPS-01, OPS-03
**Success Criteria** (what must be TRUE):
  1. The repo has `frontend/`, `backend/`, and `supabase/` directories with their respective tooling (`pnpm`, `uv`, `supabase` CLI), a top-level `LICENSE`, a `.env.example` documenting every variable, and a pinned dependency matrix (CUDA / cuDNN / torch / ctranslate2 / pyannote / whisperx versions called out)
  2. A `git commit` containing any high-entropy string (HF token, Supabase service-role key, Cloudflare tunnel credentials) is blocked by a pre-commit secret scanner; `.gitignore` excludes `.env*` (with `!.env.example` allowed)
  3. The Supabase project has migrations applied for `jobs` and `transcripts` tables with `ENABLE ROW LEVEL SECURITY` in the same migration as `CREATE TABLE`, and `supabase_realtime` publication includes both tables
  4. A named Cloudflare Tunnel resolves a stable custom-domain hostname (e.g., `api.<your-domain>`) and proxies to the developer's local machine; the hostname does not change on tunnel restart
  5. Pushing to `main` triggers a Vercel auto-deploy of the (empty) frontend
**Plans**: TBD
**UI hint**: no

**User-Blocked Items** (executor must ask before proceeding):
  - **HF_TOKEN**: HuggingFace read-scoped token; user must accept licenses on `pyannote/segmentation-3.0` AND `pyannote/speaker-diarization-3.1` in a browser
  - **GPU model and VRAM**: determines whether "Slow" preset is gateable (REQ OPTS-07)
  - **Host OS**: Linux native vs Windows + WSL2 vs Windows native — affects ffmpeg / tunnel / CUDA setup paths
  - **Domain name**: registered domain for the named Cloudflare Tunnel (free `*.workers.dev` is NOT sufficient)
  - **Supabase project ref + keys**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

---

### Phase 2: Backend Pipeline
**Goal**: A standalone FastAPI service on the developer's GPU that accepts TUS chunked uploads, runs the WhisperX pipeline (ffmpeg normalize → ASR → alignment → diarization → merged JSON) under a single-job lock, writes progress and results to Supabase Postgres for Realtime to broadcast, and survives a 20-job VRAM soak test without leaking memory.
**Depends on**: Phase 1
**Parallelizable with**: Phase 3 (independent lane — both consume the Phase 1 schema as a contract)
**Requirements**: CORE-04, CORE-05, CORE-06, CORE-07, OPS-02, OPS-05, OPS-06, OPS-07, OPS-08, OPTS-07, SEC-08, TEST-01, TEST-02, TEST-04
**Success Criteria** (what must be TRUE):
  1. A standalone `backend/scripts/transcribe_local.py` takes an audio/video file path and prints a structured JSON payload (segments × speakers × words × timestamps) using the locked WhisperX 3.8.5 + faster-whisper + pyannote 3.x stack on the dev's GPU
  2. The FastAPI service starts with one command (`uv run uvicorn ...`), runs a CUDA self-check at startup that fails fast if no GPU is detected, loads all WhisperX models into VRAM exactly once via the lifespan hook, and exposes `/healthz` and `/readyz`
  3. Files smaller than 90 MB upload via plain multipart POST and files ≥ 90 MB upload via TUS chunked upload (90 MB chunks); the assembled file is normalized by ffmpeg to 16 kHz mono and deleted from disk after the job completes (success or failure); source media is never written to Supabase Storage
  4. Submitting a job through the queue runs end-to-end on a real audio file; progress and stage transitions (Queued → Extracting → Transcribing → Diarizing → Aligning → Done) are written to the `jobs` row in Postgres and `torch.cuda.empty_cache()` is called between jobs
  5. When VRAM is below 12 GB, the `/readyz` endpoint reports the "Slow" preset as unavailable; golden-fixture tests with `jiwer` WER thresholds (`@pytest.mark.gpu`) pass locally; a "mock engine" mode runs the same routes and queue tests without a GPU; a 20-job soak test ends with VRAM within ~5% of starting allocation
**Plans**: TBD
**UI hint**: no

---

### Phase 3: Frontend Skeleton
**Goal**: A deployed Next.js app that lets a user upload a file, configure transcription options, watch real progress over Supabase Realtime, and edit/export a transcript end-to-end against a mocked backend payload — visually complete and behaviorally correct before integration.
**Depends on**: Phase 1
**Parallelizable with**: Phase 2 (independent lane — consumes Phase 1 schema for Realtime, otherwise mocked)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-09, OPTS-01, OPTS-02, OPTS-03, OPTS-04, OPTS-05, OPTS-06, VIEW-01, VIEW-02, VIEW-03, VIEW-04, VIEW-05, EDIT-01, EDIT-02, EDIT-03, EDIT-04, EDIT-05, EDIT-06, EXPORT-01, EXPORT-02, EXPORT-03, EXPORT-04, EXPORT-05, EXPORT-06, EXPORT-07, PROG-01, PROG-02, PROG-03, PROG-04, PROG-05, SEC-09, TEST-03
**Success Criteria** (what must be TRUE):
  1. The landing page presents a clean, centered drag-and-drop upload control with a privacy posture statement underneath; selecting a file shows its size and duration before upload and warns when limits are exceeded; an advanced options modal exposes quality preset (Fast/Average/Slow with hints, Average default), diarization toggle, auto/fixed speaker count, and language picker (auto-detect default); the TUS client is wired to use 90 MB chunks for files ≥ 90 MB
  2. After submission, a progress UI subscribed to Supabase Realtime on the `jobs` row shows the current stage label and a progress bar reflecting real backend transitions (no fake percent), shows "queued — N ahead of you" when another job runs, and offers a Cancel button; failures display a stage-labeled error message
  3. The transcript view renders speaker labels at every speaker change with per-turn timestamps, color-codes speakers from an accessible palette derived from speaker id, displays the auto-detected language ("Detected: pt") when relevant, and anchors an HTML5 audio player with 1x/1.25x/1.5x/2x playback that seeks to a segment's start time when the segment is clicked
  4. The editor supports renaming a speaker globally, reassigning a single segment to a different speaker, reassigning with an "apply to every instance" merge, and inline text editing; edits auto-save to localStorage with a "saved" indicator and prompt-to-restore on reload
  5. The user can download the transcript as `.txt`, `.srt`, `.vtt`, `.json`, and `.md`, copy it to clipboard with toggleable timestamp and speaker-label inclusion, and all exports are rendered client-side from the in-memory payload (always reflecting the latest edits); Vitest unit tests cover every export renderer
**Plans**: TBD
**UI hint**: yes

---

### Phase 4: Integration & Auth
**Goal**: The end-to-end anonymous golden path works (upload → transcribe → edit → download) with the real backend, and signed-in users get magic-link sign-in plus a history of their saved transcripts that they can rename, delete, and re-open for further editing — with RLS enforcing per-user isolation.
**Depends on**: Phase 2 AND Phase 3
**Requirements**: CORE-08, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09, SEC-06, SEC-07, TEST-05
**Success Criteria** (what must be TRUE):
  1. An anonymous user can land on the page, upload a real audio file, watch real progress, edit, and download — without creating an account; their transcript is never written to the `transcripts` table (CORE-08, AUTH-09); the anonymous job uses an unguessable `anon_token` for RLS-scoped Realtime subscription
  2. A user can sign in via Supabase magic-link email (no password); the session persists across browser refresh; the user can sign out from any page
  3. A signed-in user who completes a transcription sees their saved transcript in a history view; they can rename it, delete it, re-open it, and continue editing — with edits persisted to Supabase
  4. Database-side: a signed-in user can only read or write their own rows in `transcripts` and `jobs` (RLS enforced and tested); the anonymous `jobs` row is only accessible with the matching `anon_token`
  5. A Playwright E2E test covers the anonymous golden path (upload → transcribe → edit → download)
**Plans**: TBD
**UI hint**: yes

---

### Phase 5: Public-URL Safety & Hardening
**Goal**: The public URL is safe to leave online — abuse-resistant (rate limit + caps + single-job lock + origin-locked), self-aware (frontend gracefully shows offline state when the host is asleep), and protected by automated checks that catch the next person who forgets to enable RLS or leaks the service-role key.
**Depends on**: Phase 4
**Requirements**: SAFE-01, SAFE-02, SAFE-03, SAFE-04, OPS-04, SEC-02, SEC-03
**Success Criteria** (what must be TRUE):
  1. A per-IP rate limit (slowapi keyed on `cf-connecting-ip`) blocks abusive transcription submissions; uploaded files are rejected when over the size or duration cap, both client-side (early reject) and server-side via `ffprobe` after assembly
  2. Only one transcription job runs at a time on the GPU (single-job queue gated by `asyncio.Lock`); concurrent submissions queue rather than crash; the FastAPI origin only accepts traffic from Cloudflare (bound to `127.0.0.1`, no other ingress)
  3. When the backend is unreachable, the frontend health probe disables the upload control and shows a clear "service offline — host is asleep" message; saved-transcript views still work (they read from Supabase directly)
  4. A CI check fails the build when any `public.*` table has `rowsecurity=false` (catches the next missed `ENABLE ROW LEVEL SECURITY`); a separate check fails when the Supabase service-role key appears in any `NEXT_PUBLIC_*` variable, Vercel env var, or committed file
**Plans**: TBD
**UI hint**: yes

---

### Phase 6: Portfolio Polish
**Goal**: A reviewer arriving at the public repo can understand what it is, run it on their own GPU, see it in action without running it, and skim a clean commit history that reads as professional work.
**Depends on**: Phase 5
**Requirements**: REPO-02, REPO-06, REPO-07
**Success Criteria** (what must be TRUE):
  1. The top-level `README.md` explains what Transcribe is, includes screenshots and a 30-second demo gif, walks through self-hosting (CUDA setup, HF_TOKEN with both license-acceptance URLs, Supabase migrations, Cloudflare named tunnel, OS-specific sleep-prevention notes), and a one-command bootstrap is documented
  2. A `CONTRIBUTING.md` (or README section) describes the local development workflow (`uv sync`, `pnpm dev`, `supabase start`/`db push`) so a contributor without a GPU can run the frontend against a mock backend
  3. The `main` branch commit history reads cleanly to a portfolio reviewer — no `wip` / `fix typo` / `asdf` noise; conventional-commits style; planning artifacts either committed cleanly at milestone boundaries or excluded
**Plans**: TBD
**UI hint**: no

## Progress

**Execution Order:**
Phase 1 → (Phase 2 ‖ Phase 3) → Phase 4 → Phase 5 → Phase 6

Phases 2 and 3 are independent lanes; the executor MAY plan and run them in parallel after Phase 1 closes.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/TBD | Not started | - |
| 2. Backend Pipeline | 0/TBD | Not started | - |
| 3. Frontend Skeleton | 0/TBD | Not started | - |
| 4. Integration & Auth | 0/TBD | Not started | - |
| 5. Public-URL Safety & Hardening | 0/TBD | Not started | - |
| 6. Portfolio Polish | 0/TBD | Not started | - |
