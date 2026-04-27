# Pitfalls Research

**Domain:** Self-hosted local-GPU transcription web app (WhisperX + FastAPI + Next.js + Supabase + Cloudflare Tunnel, $0/month, public repo)
**Researched:** 2026-04-27
**Confidence:** HIGH for stack/version/limit claims (verified against vendor docs and upstream issue trackers); MEDIUM for UX edge-cases derived from community reports.

This document is consumed by phase planners. Every pitfall is specific to the locked stack: ignore generic web-app advice. "Phase to address" uses placeholder phase numbers (P1 = Skeleton/scaffolding, P2 = Backend transcription pipeline, P3 = Frontend upload + progress, P4 = Editor + outputs, P5 = Auth/history, P6 = Hardening/abuse-resistance, P7 = Portfolio polish). The roadmap planner can rebind these to actual phase IDs.

---

## Critical Pitfalls

### Pitfall 1: PyTorch / CUDA / cuDNN / ctranslate2 version-soup blowing up on first install

**What goes wrong:**
WhisperX pulls in faster-whisper, which depends on ctranslate2, which embeds a specific cuDNN ABI. PyTorch ships its own cuDNN. When the host CUDA Toolkit, the PyTorch wheel index (cu118 / cu121 / cu124 / cu126), ctranslate2's cuDNN, and pyannote's torchaudio don't all line up, you get one of: `libcudnn_ops_infer.so.8: cannot open shared object file`, `CUDA error: no kernel image is available for execution`, or the model loads on CPU silently and "works" 30x slower than expected.

**Why it happens:**
- torch>=2.5.1 requires cuDNN 9; ctranslate2<4.5.0 only supports cuDNN 8 (verified in WhisperX issue #954, #1158, #1398).
- pip's resolver does not enforce ABI compatibility across these packages — install order can produce two valid resolutions, only one of which actually runs on GPU.
- `nvidia-smi` reports the *driver* CUDA capability; PyTorch needs a wheel matching the *runtime* it was compiled against, not the driver.
- pyannote.audio recently broke against torchaudio 2.9.0 (`AudioMetaData` removed).

**How to avoid:**
- Pin a single tested matrix in `backend/requirements.txt` (or `pyproject.toml`) and document the host CUDA toolkit version in the README. Recommended starting point as of April 2026: `torch==2.5.1+cu124`, `ctranslate2>=4.5.0`, `faster-whisper` matching, `pyannote.audio>=3.3,<4` (pin major), `whisperx` matching, with cuDNN 9 on the host.
- Use a `uv`-based lockfile or `pip-tools`-generated `requirements.lock` so the install is reproducible byte-for-byte.
- Add a startup self-check that prints `torch.cuda.is_available()`, `torch.version.cuda`, `torch.backends.cudnn.version()`, and the loaded device — fail-fast if not GPU.
- Provide a `Makefile` / `setup.sh` that installs with the explicit `--index-url https://download.pytorch.org/whl/cu124` flag.

**Warning signs:**
- A 30-minute file takes 30 minutes to transcribe (should be ~3-5x realtime on a consumer GPU). It's running on CPU.
- `nvidia-smi` shows the python process attached but 0% GPU utilization during transcription.
- Stack traces mentioning `libcudnn` or `OSError: ... cannot open shared object file` at startup.

**Phase to address:** P1 (Skeleton). The very first backend endpoint must be a `/health` route that asserts CUDA + cuDNN compatibility before any real transcription work is built on top.

---

### Pitfall 2: Whisper model size larger than available VRAM

**What goes wrong:**
User picks "Slow / best quality" → backend tries to load `large-v3` → OOM mid-load on an 8 GB card, or loads but OOMs on the second concurrent request, or runs but evicts itself on the diarization step.

**Why it happens:**
Whisper large-v3 needs ~10 GB VRAM for inference at fp16 (verified — total weight footprint ~2.87 GB but practical inference incl. activations and batched decoder is ~10 GB; plan for +20% headroom). Diarization (pyannote) loads its own model on top. Word-alignment loads a separate alignment model. All three coexist during a single job.

**How to avoid:**
- Detect VRAM at startup (`torch.cuda.get_device_properties(0).total_memory`) and enumerate which model sizes are *safe* on this host. Refuse to advertise "Slow" if the card has <12 GB.
- Map UI presets to concrete models with a config table the operator edits, not hard-coded:
  - Fast → `tiny` or `base` (1-2 GB)
  - Average → `small` (3-4 GB) or `medium` (6-8 GB)
  - Slow → `large-v3` (10+ GB), gated behind a VRAM check
- Use `int8` quantization in faster-whisper as the default; `int8_float16` if the card supports it. This drops large-v3 to ~5 GB and is the standard production setting for WhisperX.
- Unload alignment + diarization models between jobs (`del model; gc.collect(); torch.cuda.empty_cache()`).

**Warning signs:**
- `RuntimeError: CUDA out of memory` in logs.
- `nvidia-smi` shows VRAM creeping up across jobs and never coming down — leak.
- Quality presets all silently fall back to the same actual model.

**Phase to address:** P2 (Backend pipeline). Quality preset → model mapping is a first-class config decision, not a UI afterthought.

---

### Pitfall 3: Blocking the FastAPI event loop with synchronous Whisper calls

**What goes wrong:**
You write `@app.post("/transcribe") async def transcribe(...)` and then call `model.transcribe(file)` directly inside it. The whole server freezes for the duration of the job — `/health` doesn't respond, the upload progress polling stalls, SSE connections die. From the user's perspective the site is broken.

**Why it happens:**
FastAPI runs `async def` handlers *on the event loop*. Any synchronous CPU/GPU call inside one blocks every other request. Whisper inference is fully blocking — it's a long-running C++ kernel call, not awaitable. (Verified in FastAPI docs and the "Concurrency Mistake Hiding in Every FastAPI AI Service" pattern.)

**How to avoid:**
- Either declare the route with plain `def` (FastAPI will run it in a threadpool automatically) **or** keep `async def` and explicitly `await asyncio.get_running_loop().run_in_executor(executor, blocking_fn)`.
- Better: don't tie the HTTP request lifetime to the job. Submit job to an in-process queue (a single asyncio.Queue + one consumer task that pulls jobs and runs them in a `ProcessPoolExecutor` with `max_workers=1`). Return a `job_id` immediately; client polls `/jobs/{id}` or subscribes via SSE.
- Run uvicorn with `--workers 1` (multiple workers each load their own copy of the model into VRAM and fight). Add concurrency *inside* the worker, not by spawning more workers.

**Warning signs:**
- `/health` becomes unresponsive while a transcription is running.
- Two concurrent uploads cause the second to hang in "uploading" forever.
- CPU is at 100% on one core and the rest of the API is dead.

**Phase to address:** P2. The job-queue abstraction needs to be the second thing built, right after the model loader. Bolt-on async-ifying later is painful.

---

### Pitfall 4: GPU memory leak across jobs — VRAM grows until OOM

**What goes wrong:**
First job: 4 GB used. Second job: 6 GB. Third: 9 GB. Tenth: OOM. The host PC becomes unusable until restart. This kills the public URL even when the dev's machine is technically on.

**Why it happens:**
- WhisperX loads three models per job (transcribe + align + diarize). Re-loading without explicitly deleting the old reference and emptying the cache leaves orphaned tensors.
- pyannote pipelines retain audio buffers via torchaudio.
- Python's GC doesn't free CUDA memory promptly; you have to call `torch.cuda.empty_cache()`.
- `ProcessPoolExecutor` workers that get reused for many jobs accumulate fragmentation even with `empty_cache()`.

**How to avoid:**
- Wrap the pipeline so each job: `del whisper_model, align_model, diarize_pipeline; gc.collect(); torch.cuda.empty_cache()` in a `finally` block.
- Or: load the model once at worker startup, never per-job, and only clear the activation cache (`empty_cache`) between jobs — model weights stay resident, no leak.
- Use `ProcessPoolExecutor(max_workers=1, max_tasks_per_child=N)` (Python 3.11+) so the worker process recycles every N jobs, guaranteeing VRAM resets.
- Add a `/metrics` endpoint that reports `torch.cuda.memory_allocated()` and `memory_reserved()`. Watch it during testing.

**Warning signs:**
- VRAM in `nvidia-smi` strictly monotonic across jobs.
- Job 10+ fails with OOM; restart fixes it.
- The first job after dev-mode reload works; subsequent reloads OOM.

**Phase to address:** P2 (job pipeline). Validate explicitly with a 20-job soak test before declaring P2 done.

---

### Pitfall 5: pyannote requires HuggingFace token + interactive license accept

**What goes wrong:**
First diarization request fails with `HTTP 401` or `gated repo`. The fix isn't documented in WhisperX's quick-start: you have to (a) create a HF account, (b) accept the license on **two separate model pages** (`pyannote/segmentation-3.0` and `pyannote/speaker-diarization-3.1`), (c) generate a read token, (d) export it as `HF_TOKEN` or pass `use_auth_token=...`. Self-hosters who follow the README hit this on day one.

**Why it happens:**
pyannote ships gated models. The license accept must be done by a logged-in human in a browser — it's not just a token check. Token-only access without prior license acceptance returns 403.

**How to avoid:**
- README has a clearly-labeled "Diarization setup" section with the exact two URLs to click-through and the env var name.
- Backend startup log prints a friendly message if `HF_TOKEN` is missing or if the gated-model probe returns 401: "Visit https://hf.co/pyannote/speaker-diarization-3.1 and accept the license, then run again."
- `.env.example` shows `HF_TOKEN=` placeholder.
- Optional: provide a `--no-diarization` CLI flag / env var so a contributor without HF can still run/test the rest of the pipeline.

**Warning signs:**
- Transcription works, diarization silently returns no speakers.
- 401/403 in logs from `huggingface.co`.
- Stranger trying to self-host opens an issue titled "diarization broken".

**Phase to address:** P2 (when diarization is wired) AND P7 (README must explain it for portfolio reviewers).

---

### Pitfall 6: Cold-start latency from loading the model on every request

**What goes wrong:**
Every transcribe call takes +20-40s before the first byte of audio is processed because the model is loaded fresh inside the request handler. User stares at a stalled progress bar. Two requests in a row each pay the cost.

**Why it happens:**
Naive examples in tutorials show `model = whisperx.load_model(...)` *inside* the route function. That works for one-shot scripts; in a server it must be hoisted to module scope or, better, to the worker-process initializer so it loads exactly once and stays resident.

**How to avoid:**
- Load all models (whisper, align per-language-on-demand, diarize) at FastAPI startup via a `lifespan` context manager and stash on `app.state`.
- For multi-language: lazily load the alignment model on first use of each language and cache it (`{lang: model}`). Don't reload on every request.
- Provide a `--warmup` flag that runs a tiny dummy clip through the pipeline at startup so the first real user doesn't pay JIT/CUDA-graph compile cost either.

**Warning signs:**
- First few seconds of a job show no GPU activity in `nvidia-smi`.
- Server logs show "Loading model..." per request instead of once at startup.
- Cold first request is dramatically slower than steady-state requests.

**Phase to address:** P2.

---

### Pitfall 7: Audio format / sample-rate / channel mismatch silently degrading quality

**What goes wrong:**
User uploads a 48kHz stereo .m4a. WhisperX expects 16kHz mono. The library *might* resample for you depending on which loader path is hit, but if you decode with the wrong helper or if ffmpeg isn't on PATH, you get silent quality loss, mis-aligned word timestamps, or pyannote refusing the file.

**Why it happens:**
WhisperX docs assume the audio is already 16kHz mono. The `load_audio` helper in whisperx calls ffmpeg under the hood — if ffmpeg isn't installed, you get an obscure `FileNotFoundError`. Diarization uses torchaudio, which has its own format quirks.

**How to avoid:**
- Check `ffmpeg` is on PATH at startup; refuse to start otherwise with a clear error.
- Always normalize to 16 kHz mono PCM WAV as the *first* pipeline step, regardless of input. Use a single `ffmpeg -i input -ac 1 -ar 16000 -c:a pcm_s16le out.wav` call.
- Reject unsupported containers up front with a clean 415, don't let ffmpeg's stderr leak to the user.
- Strip video to audio-only before any further work — saves I/O and avoids torchaudio video-decoding surprises.

**Warning signs:**
- Word timestamps are subtly off by a fraction of a second (resample artifact).
- Diarization randomly fails on certain inputs only.
- `ffmpeg` not in PATH on the deployment machine.

**Phase to address:** P2.

---

### Pitfall 8: Diarization speaker count is wrong and the UI can't recover

**What goes wrong:**
Two things, both bad:
1. **Overestimate** — pyannote thinks the same person is "Speaker 1", "Speaker 2", and "Speaker 3" because of room acoustic shifts, microphone changes, or a long pause. User has to manually merge.
2. **Underestimate** — two distinct quiet speakers get merged into one. User has to manually split (much harder than merge).

If the editor only supports rename-and-merge but not split-by-segment, underestimation is unrecoverable without re-running.

**Why it happens:**
- Pyannote's clustering is sensitive to audio conditions, especially at non-meeting recording quality.
- If the user's "set N speakers" hint is ignored or overridden by auto-detect, results are non-deterministic.
- The `min_speakers` and `max_speakers` parameters exist but are rarely exposed in tutorial code.

**How to avoid:**
- UI has *both*: "auto-detect" and "exactly N speakers" with clear copy explaining the tradeoff.
- Pass `min_speakers` and `max_speakers` to pyannote's pipeline when the user specifies a count — don't just use the count as a hint.
- Editor must support **(a)** rename-with-apply-everywhere, **(b)** reassign a single segment, **(c)** reassign-with-apply-everywhere, **(d)** split — selecting a region and creating a new speaker label.
- Diarization pass uses `pyannote/speaker-diarization-3.1` (current stable as of research). Pin the version, don't track HEAD.

**Warning signs:**
- Sample audio with 2 speakers comes back as 5.
- Users complain they can't fix the result.
- Same file produces different speaker counts across runs (set `torch.manual_seed`, but acknowledge non-determinism is partly inherent).

**Phase to address:** P2 (set diarization params correctly), P4 (editor UX must include split + merge).

---

### Pitfall 9: Vercel function timeout silently breaks transcription proxy

**What goes wrong:**
Frontend developer instinctively adds a Next.js API route at `/api/transcribe` that proxies to FastAPI to "hide" the backend URL or "add auth". A 5-minute transcription request hits Vercel's 60-second Hobby-plan timeout (verified — Hobby default 60s, max configurable to 60s on Hobby; Fluid Compute also caps at 1 minute on free) and returns a 504 FUNCTION_INVOCATION_TIMEOUT mid-job. The job actually completed on the backend, but the user sees a failure.

**Why it happens:**
Vercel Hobby plan caps function duration at 60 seconds. Streaming responses don't help past the limit. Free-tier serverless is fundamentally not for long-running work.

**How to avoid:**
- **The browser calls FastAPI directly.** Frontend gets the backend URL from `NEXT_PUBLIC_BACKEND_URL` and the user's session JWT via a fetch with `Authorization: Bearer ...`. No Next.js API route in the data path.
- The job-submission pattern is: client POSTs file directly to FastAPI → gets `job_id` instantly (well under any timeout) → subscribes to SSE/WebSocket *also direct to FastAPI* → downloads result from FastAPI or a Supabase Storage URL.
- The only Next.js API routes that are acceptable: lightweight things like generating a Supabase signed-upload URL, or listing a user's history (Supabase query, fast).

**Warning signs:**
- `504 FUNCTION_INVOCATION_TIMEOUT` in browser network tab.
- "Transcription failed" with no backend log entry — because the request never failed, just the proxy.
- Latency spikes whenever a transcribe is happening.

**Phase to address:** P3 (frontend upload flow). This must be designed correctly the first time — refactoring later means re-doing the whole upload + progress UI.

---

### Pitfall 10: Cloudflare Tunnel 100 MB body limit + WebSocket idle timeout

**What goes wrong:**
1. **100 MB upload limit:** User uploads a 200 MB meeting recording. Cloudflare Free returns 413 / connection reset. (Verified in Cloudflare community thread "100mb tunnel limit".) This is a hard limit on Free; not configurable without upgrading to Enterprise.
2. **Idle timeout on WS / SSE:** Free/Pro plans have a 100-second WebSocket idle timeout (verified). A long transcription with no progress event for >100s drops the socket. Client reconnects; a buggy reconnect loses progress.

**Why it happens:**
Cloudflare's edge enforces these as defaults and they cannot be lifted on free plans.

**How to avoid:**
- **Upload:** Don't push the original file through the tunnel. Either:
  - (Preferred) Frontend uploads directly to Supabase Storage (free tier 1 GB) using a signed URL, then sends FastAPI just the storage path. FastAPI fetches it server-side.
  - Or: Chunk the upload — split the file client-side into <90 MB parts, POST each to a `/upload/{session}/part/{n}` endpoint, finalize on the last part.
  - Document the cap explicitly in the UI ("Max 100 MB per file via the public URL"). Don't accept a 200 MB file from the file-picker only to reject it after upload.
- **Long-poll / SSE / WS:** Send a `keepalive` event every 30 seconds (well under 100s) even if there's no real progress to report. A simple `event: ping\n\n` over SSE is enough.
- Make the client resumable: progress reported by `job_id` polling endpoint as a *fallback* alongside SSE, so a dropped socket reconnects and gets caught up.

**Warning signs:**
- Files >100 MB fail with no backend log (rejected at edge).
- Long jobs disconnect at the ~1:40 mark consistently.
- "Connection lost" toast right around 100s.

**Phase to address:** P3 (upload path) and P6 (hardening / abuse-resistance). The upload-via-Supabase-Storage decision is architectural — settle it in P3.

---

### Pitfall 11: Forgetting Supabase RLS — public-repo + leaked anon key = full data exposure

**What goes wrong:**
You create tables via the SQL editor (RLS off by default for SQL-created tables — verified in Supabase docs and community discussion). You ship. Anyone with the publishable `anon` key (which is checked into the public repo as `NEXT_PUBLIC_SUPABASE_ANON_KEY` — by design, it's safe *only when RLS is on*) can `select *` from your `transcripts` table and read every user's history.

This was a real-world incident in early 2025: 170+ apps leaked user data this exact way (the "Lovable" incident).

**Why it happens:**
- RLS is **enabled by default for tables created in the dashboard Table Editor**, but **disabled by default for tables created via raw SQL or migrations** — and any serious project uses migrations.
- The anon key is correctly public when RLS is on. Devs see "anon key" in the public repo, assume something is wrong, but the actual problem (RLS off) is invisible.

**How to avoid:**
- Enable RLS on every table at creation: `CREATE TABLE ... ; ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` in the same migration.
- Write a deny-all default policy first, then add allow policies. RLS without policies = everything denied (safer than the inverse).
- Add a *test* (Python or SQL) that asserts `SELECT * FROM pg_tables WHERE schemaname='public' AND rowsecurity=false` returns zero rows. Run it in CI.
- For per-user history table: policy `USING (auth.uid() = user_id)` for select/update/delete, `WITH CHECK (auth.uid() = user_id)` for insert.
- Never use the `service_role` key from the browser. It bypasses RLS. Backend (FastAPI) holds it; frontend never sees it.
- Storage buckets: same story. Default to private. Add explicit policies for read/write.

**Warning signs:**
- Supabase dashboard linter showing `rls_disabled_in_public` warnings.
- A test user can fetch another user's records by ID.
- Service-role key appearing in any `NEXT_PUBLIC_*` env var.

**Phase to address:** P5 (auth/history) and again as a P6 hardening checklist. Ideally the RLS-test-in-CI is added the first day Supabase tables exist, even before auth is wired.

---

### Pitfall 12: Public repo leaking secrets (HF_TOKEN, Supabase service-role, Cloudflare tunnel creds)

**What goes wrong:**
A `.env` slips into a commit. Someone clones the repo, runs the project for free against your account, you exhaust HF rate limits or get billed for someone using your Cloudflare tunnel.

**Why it happens:**
`.env` not in `.gitignore` from the first commit. Or it is, but a `.env.local`, `.env.production`, or `cloudflared/config.yml` isn't.

**How to avoid:**
- `.gitignore` lines from commit 0: `.env*`, `!.env.example`, `*.pem`, `*credentials*.json`, `cloudflared/`, `~/.cloudflared/`.
- Check in `.env.example` with placeholders for every variable, with a short comment per variable.
- Pre-commit hook (`gitleaks` or `detect-secrets`) runs on every commit, blocks pushes containing high-entropy strings.
- GitHub secret-scanning is on for public repos by default — but only catches *known* providers (AWS, Stripe). HF_TOKEN and Supabase keys may not be detected; do not rely on it.
- If a leak happens: rotate the key in the provider dashboard *first*, then `git filter-repo` and force-push. The latter alone is not enough.

**Warning signs:**
- A reviewer says "you have a token in your repo".
- Supabase usage dashboard shows traffic you didn't make.
- HF token gets revoked.

**Phase to address:** P1 (initial scaffolding) — pre-commit hook + `.gitignore` are commit-zero items.

---

## Moderate Pitfalls

### Pitfall 13: Background tasks killed on uvicorn dev reload

**What goes wrong:**
You start a transcription locally; you save a file in the editor; uvicorn `--reload` restarts; the running job dies, the client SSE drops, you lose your test data.

**Prevention:** Use `--reload` only with `--reload-dirs` scoped to source code, not the whole repo. Better: separate the worker from the API — run the worker as its own long-lived process (`python -m backend.worker`) that doesn't reload, and have FastAPI talk to it via Redis/SQLite/local IPC. For dev simplicity in P1-P3, accept the reload-kills-jobs limitation and document it; revisit in P6.

**Phase to address:** P6.

---

### Pitfall 14: Authenticated tunnel vs. anonymous tunnel choice

**What goes wrong:**
"Quick tunnels" (`cloudflared tunnel --url ...`) give a random `*.trycloudflare.com` hostname that changes every restart — bad for portfolio (broken links) and bad for a fixed Vercel `NEXT_PUBLIC_BACKEND_URL`. Authenticated tunnels (requires a free Cloudflare account + a domain) give a stable hostname.

**Prevention:** Use a named tunnel with a stable hostname tied to a domain (Cloudflare's free tier supports this; you can use a `.dev` or `.app` domain you own, or a free `.workers.dev` is *not* sufficient — you need a registered zone). Alternative if you don't want to register a domain: accept the changing URL and have the frontend read `NEXT_PUBLIC_BACKEND_URL` at *build* time only when deploying — but this means redeploying on every tunnel restart. Recommended path: spend $10/year on a domain or use an existing one; document this in README.

**Phase to address:** P1 / P6.

---

### Pitfall 15: Origin server reachable directly, bypassing Cloudflare

**What goes wrong:**
Cloudflare Tunnel is set up correctly, but the FastAPI server is also bound to `0.0.0.0:8000` and the home network has port 8000 forwarded for some unrelated reason. Strangers can hit FastAPI directly, bypassing all WAF / rate-limit rules.

**Prevention:** Bind FastAPI to `127.0.0.1:8000` only. `cloudflared` runs on the same host and connects to localhost. No port-forward needed (and outbound-only is the whole point of Tunnel — verified in Cloudflare docs). Optionally: check `cf-connecting-ip` header presence in a middleware and reject requests without it.

**Phase to address:** P6.

---

### Pitfall 16: PC sleep / power management kills the public URL mid-job

**What goes wrong:**
Windows / Linux power management suspends the machine after 30 minutes of "idle" (the OS doesn't see GPU work or network sockets as activity). Tunnel drops, in-flight job dies, user sees a broken site.

**Prevention:** Document required OS settings in README:
- Linux: `systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target`, or for laptop: `systemd-inhibit` while a job runs, or `caffeine`.
- Windows: power plan "Never sleep" + screen-only-off.
- Add a heartbeat to the tunnel itself or a small `keepalive` request from the worker to itself every minute.

**Phase to address:** P7 (documentation).

---

### Pitfall 17: Word timestamps vs. segment timestamps — choosing the wrong granularity for the editor

**What goes wrong:**
Whisper natively returns **segment**-level timestamps (one timestamp per ~5-30s utterance). The editor wants to highlight individual words as audio plays — that requires **word**-level timestamps. WhisperX's whole reason to exist is producing word timestamps via forced alignment. If you skip the alignment step "to save time," the editor's highlight feature is unbuildable later without re-running the whole pipeline.

**Prevention:** Always run the alignment step, always store word-level timestamps in the JSON output. Display granularity in the editor is a UI choice; data granularity must be fine.

**Phase to address:** P2 (data model decision) — must be settled before P4 (editor) is built.

---

### Pitfall 18: Multi-language input where speaker switches language mid-file

**What goes wrong:**
Whisper's `--language` flag forces a single language for the whole file. If the user has a bilingual call, the non-detected language gets badly transcribed (or "translated" to the chosen one, which Whisper does silently for some configs).

**Prevention:** Default to `--language=None` (auto-detect) but only run detection on the first ~30s, accept that mid-file switches will degrade. Document this limitation honestly. Out of scope to fix in v1 (would need per-segment language detection — a real research project). Surface "detected language: en" in the UI so the user knows what happened.

**Phase to address:** P2 / P4 (UI surface).

---

### Pitfall 19: Hydration mismatches with Shadcn theming + auth state on App Router

**What goes wrong:**
Server renders "Sign in" button (no session cookie yet read). Client hydrates with session present (cookie was actually there). React throws hydration mismatch warning, theme flash, layout shift. With Next.js 15+ App Router, `cookies()` must be `await`ed — there are open issues against `@supabase/ssr` for this exact thing.

**Prevention:**
- Use `@supabase/ssr` (not the deprecated auth-helpers), follow current Supabase Next.js docs (link in README), pin to a known-working `@supabase/ssr` version.
- Read auth state in a Server Component at the layout root and pass it down; do not read in client components on first paint.
- For theme: use `next-themes` with `attribute="class"` and `suppressHydrationWarning` on `<html>` — standard fix.
- Always call `supabase.auth.getClaims()` (or `getUser()`) on the server; never trust the cookie's session payload directly.

**Phase to address:** P5.

---

### Pitfall 20: "Looks-like-progress" progress bars

**What goes wrong:**
A wall-clock-based fake progress bar ("estimate 3 minutes, go from 0 to 100% linearly") drifts wildly because actual transcription time depends on language, speaker count, and silence ratio. User sees "1% remaining" for 3 minutes. Trust collapses.

**Prevention:** Real chunk-based progress. faster-whisper exposes per-segment iteration; emit "processed X seconds of Y total" events. For the alignment + diarize stages, emit stage-level events ("aligning… 30%", "diarizing… 60%"). Three stages × per-stage % is honest and understandable.

**Phase to address:** P3 (progress UI must be designed against real backend events, not faked).

---

### Pitfall 21: Editor data corruption from segment splits/merges

**What goes wrong:**
User edits a segment's text (adds two sentences, breaks one into two). Word timestamps now don't match the audio. User adjusts speaker boundaries. A merge operation drops the timestamps of the dropped half. Re-export to SRT produces drift.

**Prevention:**
- Keep word-level timestamps as the source of truth, regenerate segment timestamps on the fly.
- All edit operations are immutable transforms over the word-list; never modify in place.
- Validation step before export: assert segment start ≤ end, segments non-overlapping (per speaker), no orphan words.
- Save edits as a diff layered on top of the original transcript (so "reset to original" is one click).

**Phase to address:** P4.

---

### Pitfall 22: SRT / VTT encoding bugs — line endings, BOM, fractional-second format

**What goes wrong:**
- SRT uses `,` as decimal separator (`00:00:01,500`); VTT uses `.` (`00:00:01.500`). Mix them up → players reject the file.
- VTT requires `WEBVTT\n\n` header; SRT does not.
- BOM at start of file breaks ffmpeg / older players.
- Line endings: SRT spec is `\r\n`; many tools accept `\n` but not all.

**Prevention:** Use a known-good library or a small, well-tested in-house formatter; do not hand-roll inside the route handler. Test outputs against `ffmpeg -i file.mkv -vf subtitles=file.srt` in CI / local testing — broken files fail this immediately.

**Phase to address:** P4.

---

### Pitfall 23: Anonymous user abuse of GPU time

**What goes wrong:**
Hacker News finds the URL. Someone uploads back-to-back 90-minute files via a script. The home GPU is pinned for hours. Real users (the friend, the dev) can't use it.

**Prevention:** Layered defense:
- Single-job queue (already a stated requirement) — only one transcription at a time, the rest queue.
- Per-IP daily cap (e.g., 30 minutes of audio/day for anonymous, 2 hours/day for signed-in). Enforce at FastAPI middleware via Redis/SQLite.
- Hard file-size cap (≤ 100 MB anyway due to Cloudflare) AND duration cap (e.g., 60 min) — duration is checked after ffmpeg probe, before transcription.
- Cloudflare WAF rate-limit rule (free tier supports a small number of rules) on `/transcribe` POSTs.
- Short retention for anonymous: results stored 24h then purged. Signed-in users keep their history.
- If abuse persists, README has a "this URL may be down or paused" disclaimer.

**Phase to address:** P6.

---

## Minor Pitfalls

### Pitfall 24: README that doesn't actually let a stranger run it

**What goes wrong:**
README says "install Python deps and run". It omits: the CUDA toolkit version assumption, the `HF_TOKEN` step, the Cloudflare account setup, the `.env` keys, the Supabase migrations. Reviewer can't run the project; portfolio impact wasted.

**Prevention:** README sections in this exact order: (1) what it is + screenshot/gif, (2) prerequisites (CUDA 12.x, ffmpeg, Node 20, Python 3.11, NVIDIA GPU ≥ 8 GB), (3) self-host quickstart with copy-pasteable commands, (4) the HF_TOKEN clickthrough, (5) Supabase project setup + SQL migrations, (6) Cloudflare Tunnel setup, (7) limitations / when the demo URL is down. Have a friend who didn't help build it actually run it from the README before declaring done.

**Phase to address:** P7.

---

### Pitfall 25: Public commit history full of "wip", "fix typo", planning-doc churn

**What goes wrong:**
Recruiter opens the repo, sees 200 commits titled "wip", "asdf", "ok", "trying again". The portfolio framing collapses regardless of code quality.

**Prevention:** Commit etiquette from day one:
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`) — non-negotiable for portfolio repos.
- Squash trivial work into meaningful commits before pushing to `main` (interactive rebase locally on feature branches, or just `git commit --amend` while on a WIP).
- `.planning/` directory is in `.gitignore` for the public repo OR is committed cleanly as a finished artifact at milestone boundaries (not as in-flight scratch). Decide once, hold the line.
- One feature → ideally one PR with one clean commit. Multiple PRs per phase is fine.

**Phase to address:** Continuous; set policy in P1 and enforce throughout.

---

### Pitfall 26: No LICENSE file on a public repo

**What goes wrong:**
"All rights reserved" is the default in many jurisdictions. Reviewers are uncomfortable forking. Self-hosters legally can't.

**Prevention:** Pick MIT or Apache-2.0 in P1, commit `LICENSE` at the root.

**Phase to address:** P1.

---

### Pitfall 27: Tests that need a real GPU — slow / nonexistent CI

**What goes wrong:**
Either CI doesn't exist (regressions go unnoticed), or CI tries to run real transcriptions (no GPU on free GitHub runners → tests fail or take forever).

**Prevention:** Two-tier testing:
- **CI tier (no GPU):** All tests that can mock the engine. Mock `whisperx.load_model` to return a fake that emits canned segments. Test the FastAPI routes, the queue, the upload validation, the SRT/VTT formatters, the editor's transform logic, the Supabase RLS policies (against a local Supabase via `supabase start`).
- **Local-only tier (GPU required):** Golden-fixture tests. Pin a small reference audio (e.g., a 30s LibriSpeech clip you have a license to ship), assert the output transcript matches a stored gold JSON within a tolerance (word-error-rate < 5%, speaker-count exact). Not in CI; runs on the dev's machine before merging "engine" PRs. Document the command (`make test-engine`).
- Mark GPU-required tests with `pytest.mark.gpu` and skip by default.

**Phase to address:** P2 (golden fixtures established when pipeline is built), P6 (CI mock-tier integrated).

---

### Pitfall 28: WSL2 vs. native Linux GPU passthrough

**What goes wrong:**
Project assumes a Linux GPU; dev's machine is Windows + WSL2. CUDA passthrough exists but has its own version requirements (Windows driver ≥ a certain version, no native cuDNN inside WSL kernel for some workloads, audio device passthrough is harder).

**Prevention:** *Information needed.* Platform of the dev's host machine wasn't stated in PROJECT.md. The CUDA pitfall section assumes Linux. **Flag for the dev:** if you're on Windows + WSL2, expect (a) the WSL2 NVIDIA passthrough is solid for compute as of CUDA 12+ (verified) but (b) ffmpeg in WSL2 cannot read Windows-side files efficiently across `/mnt/c/`, copy them in first, and (c) the tunnel runs cleaner on the Windows side of the boundary, FastAPI on the WSL2 side — choose one and stick with it. Native Linux is simpler if you have the option.

Confidence: MEDIUM (CUDA-on-WSL2 works generally; project-specific friction depends on choices not yet made).

**Phase to address:** P1.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| In-process job queue (asyncio.Queue, no Redis) | One fewer dependency, no Redis to install | Doesn't survive process restart; can't scale to multi-worker; lost jobs on uvicorn reload | Acceptable for v1 since this is a single-user-ish app. Note: revisit in P6 hardening or accept forever. |
| Storing transcripts as JSON files on disk vs. Postgres | No schema design needed; trivial to inspect | Bad for the history feature; no concurrent-edit safety; backup story missing | Acceptable for anonymous (24h retention, no history) but never for signed-in user data |
| Hard-coded model paths instead of config | Faster initial dev | Operator can't switch models without code changes; bad portfolio signal | Never — make it config-driven from P2 |
| Polling progress instead of SSE | Simpler client; no socket lifetime issues | Worse UX; more requests; lag in updates | Acceptable as fallback alongside SSE; not as the primary path |
| No mock for the engine in tests | Skip writing the mock | No CI possible, regressions in routes/editor caught only manually | Never — write the mock the first time you need a route test |
| Skipping word-level alignment to "save GPU time" | Jobs run ~30% faster | Editor highlight feature unbuildable without re-running every existing job | Never — the differentiator is editable + speaker-labeled, both need word timestamps |
| Single SRT/VTT formatter without tests | One afternoon saved | Subtle encoding bugs surface as "broken in player X" support tickets | Never for portfolio framing; minor for personal-use phase |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| WhisperX | `pip install whisperx` then expect it to work | Pin torch/ctranslate2/cuDNN as a tested matrix; document host CUDA toolkit version |
| pyannote | Treat HF token as a generic API key | Token + per-model license accept (two pages) — not interchangeable |
| Supabase | Create tables via SQL migration → forget RLS | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in the same migration; CI test for `rowsecurity=true` |
| Supabase Storage | Use a public bucket "for simplicity" | Private bucket + signed URLs; RLS on `storage.objects` table |
| Vercel | Proxy the transcribe call through a Next.js API route | Browser → FastAPI direct; Next.js routes only for fast Supabase ops |
| Cloudflare Tunnel | Quick-tunnel for "real" deploy | Named tunnel + stable hostname tied to a domain you control |
| Cloudflare Tunnel | Trust that long SSE connections "just work" | 30s keep-alive heartbeat; SSE with HTTP polling fallback |
| HuggingFace | Bake `HF_TOKEN` into a Docker image | Read from env at runtime; mount via secrets; never in image layers |
| FastAPI | `async def transcribe()` calling sync model | Plain `def`, or `await loop.run_in_executor(...)`, or external worker |
| Next.js + Supabase | Read auth state in Client Components first | Server Component reads it, passes down |
| ffmpeg | Assume it's on PATH | Check at startup; fail-fast with a clear message |
| PyTorch | Match `nvidia-smi` driver CUDA to torch wheel CUDA | Match the *runtime* / wheel index (cu124 etc.); driver is forward-compatible |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading model per request | Cold start every job; first GPU activity at +20s | Load at startup via lifespan handler | From job 1 |
| VRAM leak across jobs | nvidia-smi monotonically growing | `empty_cache` + worker recycle every N jobs | After ~10-20 jobs depending on card |
| Multiple uvicorn workers each loading the model | Multi-X memory at startup, OOM | `--workers 1` + threadpool/process executor for concurrency | At server start, on any machine without huge VRAM |
| Synchronous I/O in async handlers (reading file) | Other endpoints stall during upload | Use `aiofiles`, or accept sync file reads in plain `def` routes | At first concurrent request |
| Cloudflare Tunnel as the upload path | 100MB cap; latency adds 100-200ms per chunk | Direct-to-Supabase-Storage upload; signed URLs | At first file >100MB |
| Polling job status at 1Hz with N concurrent users | API saturated by polling not by work | SSE primary, poll fallback at 5s intervals | At ~20 concurrent open editors |
| All editor operations rerender the whole transcript | Sluggish editor on long transcripts | Virtualized list (e.g., react-virtuoso); keyed by segment id | At ~30 minutes of audio (~500 segments) |
| Diarization + alignment + transcribe loaded simultaneously | OOM on 8GB cards even with int8 | Stage-by-stage: transcribe → free → align → free → diarize, OR pin the alignment model only for the duration | At first job on smaller GPUs |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| RLS off on user-data tables | Full data exposure via public anon key (leaked via NEXT_PUBLIC_*) | RLS on all tables; CI test asserting it; deny-all default policies |
| Service-role key in client env | Total Supabase bypass | Service-role key only on FastAPI; never in `NEXT_PUBLIC_*` |
| FastAPI bound to 0.0.0.0 + home network port-forwarded | Origin reachable bypassing Cloudflare WAF | Bind to 127.0.0.1; cloudflared on same host |
| Public Supabase Storage bucket | Anyone can list/download files | Private bucket; signed URLs scoped to the user |
| HF_TOKEN committed | Token usable by anyone; quota abuse | `.gitignore` `.env*`; pre-commit secret-scan; rotate if exposed |
| Anonymous rate-limit only in app code | Bypassable by closing/opening tabs (new session); abuser pins your GPU | Per-IP layer at Cloudflare WAF + per-IP layer at FastAPI; both required |
| Trusting `cookie` session content client-side | Session spoofing | `supabase.auth.getClaims()` or `getUser()` server-side every request |
| User-supplied filenames passed to ffmpeg unescaped | Shell injection via `; rm -rf` | Use ffmpeg-python with arg arrays, or shlex.quote; never f-string into shell |
| Exposing job IDs as sequential integers | Trivial enumeration of others' transcripts | UUIDs; RLS policy on `jobs` table by `user_id` |
| Logging full transcripts to stdout | Captures of sensitive audio in journalctl/Docker logs | Log job IDs and counts, not transcript content |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Speaker auto-detect with no override | Wrong N speakers, unrecoverable in editor | "Auto" + "Exactly N" toggle in advanced options; pass min/max to pyannote |
| Rename "Speaker 3 → Maria" with apply-everywhere when there are actually two real speakers misidentified as one "Speaker 3" | Real speaker silently renamed wrong | Show before/after preview; show count of affected segments; offer split-then-rename |
| Fake percent progress (wall-clock-based) | Trust collapses when bar stalls | Real chunk-based per-stage progress; "Stage 2 of 3 (aligning) — 40%" |
| No autosave on editor; user navigates away → lost edits | Hours of work destroyed | Local autosave (IndexedDB) + server save on idle + visible "saved 3s ago" indicator + warn-on-navigate |
| Upload UI doesn't reject file size before upload starts | User waits 5 minutes for an upload that fails | Client-side check; backend echo of limit in 413 response body |
| "URL down" with no explanation when host PC is off | Confusion, broken portfolio link | Vercel-side maintenance page detection: ping backend, show "Demo offline — host machine asleep, try again or read the README" |
| Showing raw "Speaker_00" labels | Looks unfinished | Default to "Speaker 1, 2, 3..." (1-indexed, friendly); persist user-renamed labels |
| All output formats look the same to user | "Why are there 4 download buttons?" | Tooltip / one-line help under each: "TXT (reading), SRT (video subtitles), VTT (web), JSON (re-import for editing later)" |
| Long file gets stuck without cancel | Frustration; can't recover the queue slot | "Cancel job" button; on cancel, free the queue immediately |
| No language indicator after auto-detect | "Did it know I was speaking Spanish?" | Show "detected: es (auto)" with click-to-override + re-run |

## "Looks Done But Isn't" Checklist

- [ ] **Transcription pipeline:** First job after a 24h-idle host completes — verify cold-cold start, not just warm restart.
- [ ] **Diarization:** Run on a known-2-speaker sample, then a known-4-speaker sample, then a 30s monologue. Verify counts match (or are explicable).
- [ ] **Vercel function path:** Open browser dev tools, confirm zero requests to `/api/transcribe` during a transcription. All long calls must hit the FastAPI hostname directly.
- [ ] **Cloudflare body limit:** Try uploading a 110 MB file. Frontend should reject before upload; if it doesn't, document the failure mode. Try 50 MB; should succeed.
- [ ] **WS / SSE keep-alive:** Run a transcription where progress events are >100s apart (e.g., a long single segment). Verify connection survives.
- [ ] **RLS:** As anonymous client, attempt `select * from transcripts` — must return zero rows or 401. As user A, attempt to read user B's transcript by ID — must fail.
- [ ] **Storage:** As anonymous, attempt to list bucket contents directly via Supabase API — must fail.
- [ ] **Secrets:** `git log -p | grep -iE "(token|secret|key|password)"` finds nothing real.
- [ ] **README:** A friend who didn't help build it can clone, follow only the README, and run a successful transcription. They write down every step they had to figure out themselves; those gaps are README updates.
- [ ] **License:** `LICENSE` file present at repo root; `package.json` and `pyproject.toml` reference it.
- [ ] **Editor autosave:** Make 5 edits, hard-refresh the page, edits are restored from autosave (signed-in) or session storage (anonymous).
- [ ] **Apply-everywhere rename:** Edge case test — two real speakers misclustered as one. Renaming "Speaker 3 → Maria" must NOT also rename a separate "Speaker 3" segment that's actually a different person. (This requires the editor to surface the count and let the user split first.)
- [ ] **SRT/VTT correctness:** Generated `.srt` plays in VLC; generated `.vtt` displays in a `<track>` element on a test HTML page. Both have correct frame-accurate timestamps on a fixture file.
- [ ] **Cancel:** Cancel a running job; verify GPU is released within 5 seconds; verify the queue accepts the next job immediately.
- [ ] **GPU memory:** After 20 sequential jobs, `nvidia-smi` reports the same VRAM as after job 1 (within ~5%).
- [ ] **PC sleep:** Trigger Windows/Linux sleep manually; verify the tunnel reconnects when it wakes; verify a clear in-flight-job-failed message reaches the user.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| RLS leak in production | HIGH | (1) Enable RLS + add policies immediately, (2) rotate `anon` key + redeploy, (3) audit logs for unauthorized access, (4) notify any users whose data was exposed |
| Committed HF_TOKEN | MEDIUM | (1) Revoke token at hf.co/settings/tokens, (2) generate new, (3) `git filter-repo` to scrub history, (4) force-push (sole maintainer, public repo — acceptable), (5) update local `.env` |
| VRAM leak in production worker | LOW | Restart the worker process (or set `max_tasks_per_child=10`); fix in code on next deploy |
| Cloudflare Tunnel hostname changed | LOW | Use a named tunnel with a stable hostname tied to a registered domain; if you're on quick-tunnel, update `NEXT_PUBLIC_BACKEND_URL` and redeploy |
| Vercel timeout breaking a feature | LOW | Move the slow call from Next.js API route to direct frontend → FastAPI; one PR |
| Whisper model OOM at startup | LOW | Drop preset's mapped model size in config; restart |
| Anonymous abuse pinning the GPU | MEDIUM | Add Cloudflare WAF rate-limit rule (immediate), tighten per-IP cap in app, consider temporary anonymous-disable behind a feature flag |
| Editor data corruption from bad merge logic | MEDIUM | Restore from autosave history if implemented; otherwise the original transcript is intact, edits are lost |
| Public-repo "wip" commit history | HIGH if discovered late | While solo, before others fork: rebase `main` into a clean history with conventional commits, force-push. After others fork: must live with it; squash-merge cleanly going forward |
| pyannote license not accepted in self-host setup | LOW | README link to the license pages; one-time human action |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. CUDA / cuDNN / ctranslate2 mismatch | P1 | `/health` endpoint asserts GPU + CUDA + cuDNN versions match expected |
| 2. Whisper model > VRAM | P2 | Startup log enumerates allowed presets per detected VRAM; integration test on small/large |
| 3. Blocking event loop | P2 | Concurrent-request test: while one job runs, `/health` and `/jobs/list` respond <500ms |
| 4. GPU memory leak | P2 | 20-job soak test; assert VRAM after = VRAM start ±5% |
| 5. pyannote HF token | P2, P7 | Fresh-checkout self-host test by an outsider following only README |
| 6. Cold-start model load | P2 | Log shows "model loaded" once at startup, not per request |
| 7. Audio format normalization | P2 | Test fixtures: .m4a 48kHz stereo, .mp4 video, .ogg, .flac all produce identical-quality results |
| 8. Diarization speaker count UX | P2 (params), P4 (editor) | Editor supports merge, split, reassign-segment, reassign-everywhere |
| 9. Vercel timeout on transcribe | P3 | DevTools Network tab during transcribe — zero hits to Vercel beyond initial page load |
| 10. Cloudflare 100MB / WS timeout | P3 (upload), P6 (hardening) | Upload >100MB rejected client-side; SSE survives 5+ minute idle |
| 11. Supabase RLS off | P5 | CI test: `SELECT * FROM pg_tables WHERE schemaname='public' AND rowsecurity=false` returns zero rows |
| 12. Secrets in repo | P1 | Pre-commit hook (`gitleaks` / `detect-secrets`); `.gitignore` covers all `.env*` |
| 13. Uvicorn reload kills jobs | P6 | Worker as separate process; documented in README that dev-mode reload only affects API |
| 14. Tunnel hostname instability | P1 / P6 | Named tunnel + stable domain; documented in README |
| 15. Origin reachable bypassing Cloudflare | P6 | `netstat` shows FastAPI bound to 127.0.0.1 only |
| 16. PC sleep | P7 | README documents required power-management settings per OS |
| 17. Word vs. segment timestamps | P2 | JSON output schema has word-level timestamps from day one |
| 18. Multi-language mid-file | P2 / P4 | UI surfaces detected language; documented limitation |
| 19. Hydration mismatches | P5 | No console hydration warnings on cold load when signed in / out |
| 20. Fake progress bars | P3 | Progress UI driven by backend events only; no `setInterval`-based fake fill |
| 21. Editor data corruption | P4 | Round-trip test: load → 50 random edits → export → reimport → semantically equal |
| 22. SRT/VTT encoding bugs | P4 | Generated files validate against `ffmpeg -i video -vf subtitles=file` and HTML `<track>` |
| 23. Anonymous abuse | P6 | Layered limits: Cloudflare WAF + FastAPI per-IP + queue depth |
| 24. README quality | P7 | Outsider-runs-from-README test |
| 25. Commit history | All phases | Conventional Commits enforced; periodic `git log --oneline` review |
| 26. LICENSE | P1 | File at repo root |
| 27. GPU-required tests / no CI | P2 (fixtures), P6 (CI) | Mock-engine tests run in CI; golden-fixture tests run locally before merging engine PRs |
| 28. WSL2 vs. Linux | P1 | Decision logged in PROJECT.md Key Decisions; README states host requirement |

## Sources

- Cloudflare Tunnel 100 MB body limit (Free): [Cloudflare Community — 100mb tunnel limit](https://community.cloudflare.com/t/100mb-tunnel-limit/901339), [Cloudflare Community — Max upload size](https://community.cloudflare.com/t/max-upload-size/630925)
- Cloudflare WebSocket 100s idle timeout (Free/Pro): [Cloudflare Community — Websocket timeout over cloudflare tunnel](https://community.cloudflare.com/t/websocket-timeout-over-cloudflare-tunnel/524610), [Cloudflare WebSockets docs](https://developers.cloudflare.com/network/websockets/)
- Cloudflare origin lock-down: [Protect your origin server (Cloudflare docs)](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/), [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- WhisperX dependency hell: [WhisperX issue #954 — torch and ctranslate require different version of cudnn](https://github.com/m-bain/whisperX/issues/954), [WhisperX issue #1158 — Upgrading ctranslate to >= 4.5.0](https://github.com/m-bain/whisperX/issues/1158), [WhisperX issue #1398](https://github.com/m-bain/whisperX/issues/1398), [WhisperX issue #1032 — ctranslate2 breaks with glibc 2.41](https://github.com/m-bain/whisperX/issues/1032)
- pyannote HF token + license: [WhisperX issue #841 — Use whisperx and pyannote without HuggingFace token](https://github.com/m-bain/whisperX/issues/841), [WhisperX issue #1295 — Any plan to upgrade pyannote dependency](https://github.com/m-bain/whisperX/issues/1295)
- Whisper large-v3 VRAM ~10 GB: [HF — whisper-large-v3 memory discussion #150](https://huggingface.co/openai/whisper-large-v3/discussions/150), [HF automated memory requirements #83](https://huggingface.co/openai/whisper-large-v3/discussions/83), [WhisperX model selection guide](https://deepwiki.com/murtaza-nasir/whisperx-asr-service/6.2-model-selection)
- Vercel Hobby 60s timeout: [Vercel Functions Limits](https://vercel.com/docs/functions/limitations), [Vercel Function timeouts KB](https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out), [Configuring Maximum Duration for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/duration), [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby)
- Supabase free-tier limits (Apr 2026): [Supabase Free Tier Limits 2026](https://www.iloveblogs.blog/post/supabase-free-tier-limits-2026), [Supabase Pricing 2026 breakdown](https://uibakery.io/blog/supabase-pricing), [Supabase free plan discussion #38200](https://github.com/orgs/supabase/discussions/38200)
- Supabase RLS / Lovable incident: [Why Your Supabase Data Is Exposed (DEV)](https://dev.to/jordan_sterchele/why-your-supabase-data-is-exposed-and-you-dont-know-it-25fh), [Why Your Supabase App Might Be Leaking User Data (DEV)](https://dev.to/gifteddev/why-your-supabase-app-might-be-leaking-user-data-and-how-to-fix-it-with-rls-2fbf), [Supabase 170+ apps incident — byteiota](https://byteiota.com/supabase-security-flaw-170-apps-exposed-by-missing-rls/), [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase RLS troubleshooting](https://supabase.com/docs/guides/troubleshooting/rls-simplified-BJTcS8)
- FastAPI blocking ML inference: [Running Blocking ML Operations (apxml)](https://apxml.com/courses/fastapi-ml-deployment/chapter-5-async-operations-performance/running-blocking-ml-operations), [The Concurrency Mistake Hiding in Every FastAPI AI Service](https://jamwithai.substack.com/p/the-concurrency-mistake-hiding-in), [How to Optimize FastAPI for ML Model Serving](https://luis-sena.medium.com/how-to-optimize-fastapi-for-ml-model-serving-6f75fb9e040d), [FastAPI async docs](https://fastapi.tiangolo.com/async/)
- PyTorch / CUDA wheel matrix: [PyTorch Previous Versions](https://pytorch.org/get-started/previous-versions/), [PyTorch Forums — install with CUDA 12.1](https://discuss.pytorch.org/t/install-pytorch-with-cuda-12-1/174294)
- Next.js + Supabase SSR: [Supabase SSR — Creating a client](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Setting up Server-Side Auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs), [Supabase SSR cookies advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide), [Next.js #81445 cookies must be awaited (App Router + Turbopack)](https://github.com/vercel/next.js/discussions/81445)

---
*Pitfalls research for: self-hosted local-GPU transcription web app*
*Researched: 2026-04-27*
