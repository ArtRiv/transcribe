# Requirements: Transcribe

**Defined:** 2026-04-27
**Core Value:** Turn long, skim-hostile audio/video into accurate, speaker-labeled, editable transcripts with **zero ongoing cost** to operate.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Core Flow (CORE)

- [ ] **CORE-01**: User lands on the home page and sees a clear, centered upload control as the primary action
- [ ] **CORE-02**: User can upload audio or video files via drag-and-drop or file picker
- [ ] **CORE-03**: Frontend shows the file's size and duration before upload starts and warns if it exceeds limits
- [ ] **CORE-04**: Files smaller than 90 MB upload via plain multipart POST; files ≥ 90 MB upload via TUS chunked upload (~90 MB chunks) directly to FastAPI
- [ ] **CORE-05**: Backend normalizes audio/video to 16 kHz mono via ffmpeg before transcription
- [ ] **CORE-06**: Backend transcribes the file with whisper.cpp (ASR via Vulkan on AMD GPU) plus pyannote on CPU (diarization), and returns a structured payload (segments × speakers × words × timestamps)
- [ ] **CORE-07**: Source media is deleted from the backend disk immediately after the transcription job completes (success or failure)
- [ ] **CORE-08**: Anonymous transcripts are not persisted server-side beyond the active editing session
- [ ] **CORE-09**: A failed transcription surfaces a clear error message to the user (with stage labels: upload / extraction / transcription / diarization / alignment)

### Options Modal (OPTS)

- [ ] **OPTS-01**: User picks a quality preset (Fast / Average / Slow) before submitting; Average is the default
- [ ] **OPTS-02**: Each preset shows a one-line hint describing the speed/quality trade-off
- [ ] **OPTS-03**: User can toggle diarization (speaker labels) on or off
- [ ] **OPTS-04**: User can choose auto-detect speaker count or pin a fixed number of speakers
- [ ] **OPTS-05**: User can pick the spoken language explicitly, or let Whisper auto-detect (default)
- [ ] **OPTS-06**: When auto-detect is used, the detected language is shown in the result header (e.g., "Detected: pt")
- [ ] **OPTS-07**: On 8 GB AMD RX 6600, the "Slow" preset (large-v3) is gated off by default; only "Fast" (small/base) and "Average" (medium or large-v3-turbo if it fits Vulkan) are exposed. The gate logic is centralized so that users on larger GPUs can unlock "Slow" via a single config flag.

### Transcript View & Playback (VIEW)

- [ ] **VIEW-01**: Transcript renders with speaker labels at every speaker change and per-turn timestamps
- [ ] **VIEW-02**: Speakers are color-coded with an accessible palette derived from speaker id
- [ ] **VIEW-03**: An HTML5 audio player is anchored to the transcript view
- [ ] **VIEW-04**: Audio player supports playback speeds of 1x, 1.25x, 1.5x, and 2x
- [ ] **VIEW-05**: Clicking a transcript segment seeks the audio player to that segment's start time

### Editor (EDIT)

- [ ] **EDIT-01**: User can rename a speaker globally (e.g., "Speaker 3" → "Maria") with the new name applied to every segment of that speaker
- [ ] **EDIT-02**: User can re-assign an individual segment from one speaker to another
- [ ] **EDIT-03**: When re-assigning a segment, the user gets an "apply to every instance of this speaker" option that bulk-merges all segments of the source speaker into the destination speaker
- [ ] **EDIT-04**: User can edit transcript text inline (fix mishears / typos)
- [ ] **EDIT-05**: Editor auto-saves edits to localStorage; on reload, the user is prompted to restore unsaved changes
- [ ] **EDIT-06**: Editor surfaces a "saved" indicator after each successful save (localStorage for anonymous, Supabase for signed-in)

### Export & Output (EXPORT)

- [ ] **EXPORT-01**: User can download the transcript as `.txt` (plain text, optional speaker labels and timestamps)
- [ ] **EXPORT-02**: User can download the transcript as `.srt` subtitles (timed, with speaker labels)
- [ ] **EXPORT-03**: User can download the transcript as `.vtt` subtitles
- [ ] **EXPORT-04**: User can download the transcript as `.json` (full payload: segments, words, timestamps, speakers — round-trippable)
- [ ] **EXPORT-05**: User can download the transcript as `.md` (Markdown — drops cleanly into Notion / docs)
- [ ] **EXPORT-06**: User can copy the transcript to clipboard with toggleable inclusion of timestamps and speaker labels
- [ ] **EXPORT-07**: All exports are rendered client-side from the in-memory payload (always reflect latest edits)

### Auth & History (AUTH)

- [ ] **AUTH-01**: Anonymous users can transcribe and edit without creating an account
- [ ] **AUTH-02**: Users can sign in via Supabase magic-link email (no password)
- [ ] **AUTH-03**: User session persists across browser refresh
- [ ] **AUTH-04**: User can sign out from any page
- [ ] **AUTH-05**: Signed-in users have a "history" view listing their past transcriptions
- [ ] **AUTH-06**: Signed-in users can rename a saved transcript
- [ ] **AUTH-07**: Signed-in users can delete a saved transcript
- [ ] **AUTH-08**: Signed-in users can re-open a saved transcript and continue editing
- [ ] **AUTH-09**: Anonymous transcripts are NOT written to the database (only ephemeral in the browser/server)

### Progress UX (PROG)

- [ ] **PROG-01**: After submission, the UI shows the job's current stage with a label (Queued → Extracting → Transcribing → Diarizing → Aligning → Done)
- [ ] **PROG-02**: A progress bar reflects real backend stage transitions (no fake percent based on wall-clock)
- [ ] **PROG-03**: Progress updates reach the browser via Supabase Realtime (Postgres Changes on the `jobs` table), not SSE through Cloudflare Tunnel
- [ ] **PROG-04**: When another job is running, the user sees a "queued — N ahead of you" indicator
- [ ] **PROG-05**: User can cancel an in-flight job from the progress UI

### Public-URL Safety (SAFE)

- [ ] **SAFE-01**: A per-IP rate limit is enforced on transcription submissions (slowapi on FastAPI, using `cf-connecting-ip`)
- [ ] **SAFE-02**: Uploaded files are capped by both file size and audio duration; both checks happen client-side (early reject) and again server-side via `ffprobe`
- [ ] **SAFE-03**: Only one transcription job runs at a time (single-job queue gated by an `asyncio.Lock` around the GPU)
- [ ] **SAFE-04**: The FastAPI origin only accepts traffic from Cloudflare (origin lockdown via Cloudflare Tunnel — no other ingress)

### Operational (OPS)

- [ ] **OPS-01**: Frontend deploys to Vercel from a `main`-branch push (auto-deploy)
- [ ] **OPS-02**: Backend runs on the developer's local machine via a single command after `git pull` (e.g., `uv run uvicorn ...`)
- [ ] **OPS-03**: Backend is reached publicly via a Cloudflare Quick Tunnel (`trycloudflare.com`); the current tunnel hostname is captured in a local file and the documented restart workflow describes how to update `NEXT_PUBLIC_BACKEND_URL` in Vercel and redeploy
- [ ] **OPS-04**: Frontend has a health probe to the backend; when the backend is unreachable, the upload control is disabled and a clear "service offline — host is asleep" message is shown
- [ ] **OPS-05**: Backend startup runs a Vulkan self-check (probes the AMD GPU via `vulkaninfo` or whisper.cpp's `--list-devices`, asserts at least one Vulkan-capable device, logs device name and driver version) and fails fast on misconfiguration
- [ ] **OPS-06**: whisper.cpp models (loaded once into Vulkan device memory) and pyannote pipeline (loaded once into CPU/RAM) are initialized at FastAPI lifespan startup and stay resident for the process lifetime
- [ ] **OPS-07**: Between jobs, the backend explicitly releases per-job buffers (whisper.cpp context reset and pyannote intermediate tensors) so steady-state memory does not grow across consecutive transcriptions
- [ ] **OPS-08**: A `/healthz` and `/readyz` endpoint expose service status (used by the frontend health probe)

### Security & Privacy (SEC)

- [ ] **SEC-01**: Row-Level Security is `ENABLE`d on every public Postgres table from the first migration
- [ ] **SEC-02**: A CI check (or pre-commit hook) fails the build when any `public.*` table has `rowsecurity=false`
- [ ] **SEC-03**: Service-role Supabase key never appears in any `NEXT_PUBLIC_*` variable, Vercel env, or committed file
- [ ] **SEC-04**: `.gitignore` excludes `.env*` (with `!.env.example` allowed) from commit zero
- [ ] **SEC-05**: A pre-commit hook runs a secret scanner (gitleaks or detect-secrets) and blocks commits with leaked credentials
- [ ] **SEC-06**: Signed-in users can only read/write their own rows in `transcripts` and `jobs` (RLS enforced)
- [ ] **SEC-07**: Anonymous job rows are scoped by an unguessable `anon_token` and not readable without that token
- [ ] **SEC-08**: Transcription source media is deleted from disk after processing; never written to Supabase Storage
- [ ] **SEC-09**: A privacy posture statement is visible under the upload control ("Your file never leaves the host machine and is deleted after transcription")

### Repo & Portfolio (REPO)

- [ ] **REPO-01**: Frontend (`frontend/`) and backend (`backend/`) live in this single `transcribe` repo (monorepo)
- [ ] **REPO-02**: Repo has a top-level `README.md` that explains what the app is, how to self-host it, and how the architecture works (with screenshots / a demo gif)
- [ ] **REPO-03**: Repo has a permissive `LICENSE` file (MIT or Apache-2.0)
- [ ] **REPO-04**: Repo includes a `.env.example` documenting every required environment variable for both frontend and backend
- [ ] **REPO-05**: A pinned dependency matrix is documented (Python deps via `uv`, Node deps via `pnpm`); CUDA / cuDNN / torch / ctranslate2 versions are pinned and called out
- [ ] **REPO-06**: A `CONTRIBUTING.md` (or README section) explains the local development workflow
- [ ] **REPO-07**: Commit history is readable to a portfolio reviewer (no `wip`/`fix typo` noise on the `main` branch)

### Quality & Testing (TEST)

- [ ] **TEST-01**: Backend has golden-fixture transcription tests (3–5 short audio clips with reference transcripts) measured with `jiwer` WER thresholds, marked `@pytest.mark.gpu` and skippable in CI
- [ ] **TEST-02**: Backend tests can run in a "mock engine" mode without a GPU (no Vulkan, no pyannote weights) so CI passes without GPU/heavy-model runners
- [ ] **TEST-03**: Frontend has Vitest unit tests for the export renderers (`.txt`, `.srt`, `.vtt`, `.json`, `.md`)
- [ ] **TEST-04**: A 20-job memory soak test runs locally before any release of the backend pipeline (covers both Vulkan device memory via whisper.cpp diagnostics AND host RAM via `psutil`); steady-state memory must stay within ~5% of the post-warmup baseline
- [ ] **TEST-05**: Playwright E2E covers at least the anonymous golden path (upload → transcribe → edit → download)

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Editor v1.x (EDITX)

- **EDITX-01**: Read-along highlight (current segment highlighted as audio plays)
- **EDITX-02**: Find-and-replace inside the transcript
- **EDITX-03**: Per-word confidence shading + "needs review" badges
- **EDITX-04**: Read mode vs Edit mode toggle
- **EDITX-05**: Keyboard shortcuts with `?` help overlay
- **EDITX-06**: Undo / redo stack

### Capture (CAPT)

- **CAPT-01**: In-browser microphone recording (record then transcribe)

### Performance (PERF)

- **PERF-01**: Within-stage progress (per-batch percent inside "Transcribing"), not just stage-level

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Paid GPU hosting | Hard "$0/month" constraint; if URL needs the dev's PC on, that's accepted |
| Real-time / streaming transcription | Use case is uploaded files, not live capture |
| Translation | Different UX surface; users reach for DeepL — out of scope per PROJECT.md |
| Multi-tenant team features (orgs, sharing transcripts between users) | Single-user model only |
| Mobile native apps | Web only |
| Speaker fingerprinting across files | Diarization is per-file; "this is Maria" doesn't carry between uploads |
| Always-on availability | Public URL is up only while the host PC is on — accepted |
| Transcript collaboration (multi-editor on one transcript) | Single-editor model |
| OpenAI Whisper API as paid fallback | Per-minute cost violates the free constraint |
| Custom Whisper fine-tuning / domain adaptation | Vanilla Whisper / WhisperX models only |
| YouTube URL input | Legal exposure (copyright) + yt-dlp instability; users can upload the file themselves |
| AI summary / chapters / action items | Requires paid LLM or heavy local LLM — violates $0/month constraint |
| Password-based auth | Magic-link covers same ground with less attack surface |
| DOCX / PDF export | Heavy deps; Markdown + Pandoc covers same ground |
| Word-level click-to-seek | Per-segment seek is enough; per-word adds DOM cost without UX gain |

## Traceability

Each v1 requirement maps to exactly one phase. 81/81 mapped, 0 orphans.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 3 | Pending |
| CORE-02 | Phase 3 | Pending |
| CORE-03 | Phase 3 | Pending |
| CORE-04 | Phase 2 (server) + Phase 3 (client) | Pending |
| CORE-05 | Phase 2 | Pending |
| CORE-06 | Phase 2 | Pending |
| CORE-07 | Phase 2 | Pending |
| CORE-08 | Phase 4 | Pending |
| CORE-09 | Phase 3 | Pending |
| OPTS-01 | Phase 3 | Pending |
| OPTS-02 | Phase 3 | Pending |
| OPTS-03 | Phase 3 | Pending |
| OPTS-04 | Phase 3 | Pending |
| OPTS-05 | Phase 3 | Pending |
| OPTS-06 | Phase 3 | Pending |
| OPTS-07 | Phase 2 | Pending |
| VIEW-01 | Phase 3 | Pending |
| VIEW-02 | Phase 3 | Pending |
| VIEW-03 | Phase 3 | Pending |
| VIEW-04 | Phase 3 | Pending |
| VIEW-05 | Phase 3 | Pending |
| EDIT-01 | Phase 3 | Pending |
| EDIT-02 | Phase 3 | Pending |
| EDIT-03 | Phase 3 | Pending |
| EDIT-04 | Phase 3 | Pending |
| EDIT-05 | Phase 3 | Pending |
| EDIT-06 | Phase 3 | Pending |
| EXPORT-01 | Phase 3 | Pending |
| EXPORT-02 | Phase 3 | Pending |
| EXPORT-03 | Phase 3 | Pending |
| EXPORT-04 | Phase 3 | Pending |
| EXPORT-05 | Phase 3 | Pending |
| EXPORT-06 | Phase 3 | Pending |
| EXPORT-07 | Phase 3 | Pending |
| AUTH-01 | Phase 4 | Pending |
| AUTH-02 | Phase 4 | Pending |
| AUTH-03 | Phase 4 | Pending |
| AUTH-04 | Phase 4 | Pending |
| AUTH-05 | Phase 4 | Pending |
| AUTH-06 | Phase 4 | Pending |
| AUTH-07 | Phase 4 | Pending |
| AUTH-08 | Phase 4 | Pending |
| AUTH-09 | Phase 4 | Pending |
| PROG-01 | Phase 3 | Pending |
| PROG-02 | Phase 3 | Pending |
| PROG-03 | Phase 3 | Pending |
| PROG-04 | Phase 3 | Pending |
| PROG-05 | Phase 3 | Pending |
| SAFE-01 | Phase 5 | Pending |
| SAFE-02 | Phase 5 | Pending |
| SAFE-03 | Phase 5 | Pending |
| SAFE-04 | Phase 5 | Pending |
| OPS-01 | Phase 1 | Pending |
| OPS-02 | Phase 2 | Pending |
| OPS-03 | Phase 1 | Pending |
| OPS-04 | Phase 5 | Pending |
| OPS-05 | Phase 2 | Pending |
| OPS-06 | Phase 2 | Pending |
| OPS-07 | Phase 2 | Pending |
| OPS-08 | Phase 2 | Pending |
| SEC-01 | Phase 1 | Pending |
| SEC-02 | Phase 5 | Pending |
| SEC-03 | Phase 5 | Pending |
| SEC-04 | Phase 1 | Pending |
| SEC-05 | Phase 1 | Pending |
| SEC-06 | Phase 4 | Pending |
| SEC-07 | Phase 4 | Pending |
| SEC-08 | Phase 2 | Pending |
| SEC-09 | Phase 3 | Pending |
| REPO-01 | Phase 1 | Pending |
| REPO-02 | Phase 6 | Pending |
| REPO-03 | Phase 1 | Pending |
| REPO-04 | Phase 1 | Pending |
| REPO-05 | Phase 1 | Pending |
| REPO-06 | Phase 6 | Pending |
| REPO-07 | Phase 6 | Pending |
| TEST-01 | Phase 2 | Pending |
| TEST-02 | Phase 2 | Pending |
| TEST-03 | Phase 3 | Pending |
| TEST-04 | Phase 2 | Pending |
| TEST-05 | Phase 4 | Pending |

**Note on CORE-04:** This requirement spans both lanes (server-side TUS endpoints in Phase 2, client-side TUS upload in Phase 3). The two halves integrate in Phase 4. For execution accounting, count it in Phase 2; for completion accounting, both phases must satisfy their half.

**Coverage:**
- v1 requirements: 81 total (CORE 9 · OPTS 7 · VIEW 5 · EDIT 6 · EXPORT 7 · AUTH 9 · PROG 5 · SAFE 4 · OPS 8 · SEC 9 · REPO 7 · TEST 5)
- Mapped to phases: 81/81 ✓
- Unmapped: 0
- Per-phase counts: Phase 1 = 9, Phase 2 = 14 (incl. CORE-04 server), Phase 3 = 30 (incl. CORE-04 client), Phase 4 = 13, Phase 5 = 7, Phase 6 = 3 → 76 unique + CORE-04 split → 81 unique requirements covered

---
*Requirements defined: 2026-04-27*
*Last updated: 2026-04-27 — traceability filled in by gsd-roadmapper*
