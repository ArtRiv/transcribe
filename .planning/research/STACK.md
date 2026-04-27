# Stack Research

**Domain:** Self-hosted GPU-accelerated audio/video transcription web app (Whisper + diarization, Next.js + FastAPI + Supabase, exposed via Cloudflare Tunnel, $0/month)
**Researched:** 2026-04-27
**Confidence:** HIGH on transcription engine, diarization, FastAPI patterns, observability. MEDIUM-HIGH on Supabase integration and upload UX (because Cloudflare Tunnel free-tier 100MB cap and Supabase free-tier 50MB-per-file cap force a non-obvious upload path). MEDIUM on transcript-editor library choice (multiple sane options, recommendation is opinionated rather than universal).

---

## TL;DR

| Layer | Pick | One-line rationale |
|-------|------|--------------------|
| Transcription engine | **WhisperX 3.8.5** (with `faster-whisper` backend, CTranslate2) | Only library that bundles VAD + word-level timestamps + pyannote diarization in one pipeline. Already what you guessed; research confirms it. |
| Whisper model | **`large-v3-turbo`** (default) + `large-v3` (Slow preset) + `medium`/`small` (Fast preset) | Turbo is ~6x faster than `large-v3`, ~6 GB VRAM, only ~2pp worse WER on tough audio. Best quality-per-watt for the user's "Average" preset. |
| Diarization | **pyannote-audio 3.4.x with `pyannote/speaker-diarization-3.1`** (pin pyannote at `>=3.3.2,<4`) | WhisperX 3.8.5 does not yet support pyannote 4. The Community-1 model (CC-BY-4.0) is the future path but doesn't work cleanly with WhisperX yet. |
| Audio/video preprocess | **`ffmpeg` system binary + `subprocess`** (no Python wrapper) | WhisperX/faster-whisper already shell out to ffmpeg. One subprocess call to normalize is simpler and more debuggable than `ffmpeg-python`. |
| Job queueing | **`asyncio.Queue` + a single background `asyncio.Task` worker, app-singleton lock** (NO Redis, NO Celery, NO arq for v1) | Single-host, single-GPU, single-job constraint = a 50-line in-process worker beats every external broker. Add arq+Redis only if you outgrow it. |
| Progress reporting | **SSE via `sse-starlette`** | Cloudflare Tunnel kills idle WebSockets at 100s; SSE has no such limit on Cloudflare. SSE is also simpler (one direction = progress only). |
| Backend tunnel | **Cloudflare Tunnel (`cloudflared`)** — keep | Best free option (no bandwidth cap, no time cap, named domain). Real blockers below addressed via upload-path design. |
| Frontend | **Next.js 15 App Router + React 19 + Tailwind 4 + shadcn/ui** | Locked. |
| Auth | **`@supabase/ssr` 0.7.x in Next.js, JWT verification via JWKS in FastAPI (`PyJWT[crypto]` + `PyJWKClient`)** | Only sane pattern in 2026. Old `@supabase/auth-helpers` is deprecated; old HS256 shared-secret pattern is being phased out for ES256/JWKS. |
| DB writes | **Frontend → Supabase directly using RLS for user data; FastAPI uses `service_role` key only for backend-owned writes (job state, transcript artifacts)** | Avoids the FastAPI proxy anti-pattern; lets RLS do its job. |
| File upload | **Browser → Supabase Storage (TUS resumable, ≤50MB) for signed-in users; Browser → FastAPI direct (chunked, ≤95MB chunks) over Cloudflare Tunnel for anonymous users** | Two paths because two free-tier caps collide. Detailed in §7. |
| Transcript editor | **Roll your own with shadcn primitives + `react-aria` for keyboard a11y, NOT a rich-text framework** | A diarized transcript is a *structured* document (segments × speakers × words × timestamps), not free-form prose. Tiptap/Lexical/Slate force you to model it as rich text and you fight the framework forever. |
| Audio sync | **`wavesurfer.js` + `@wavesurfer/react`** (optional, only if you want a waveform; otherwise `<audio>` with refs is enough) | Industry standard. Don't reach for it day 1. |
| Testing | **`pytest` + `pytest-asyncio` + `httpx.AsyncClient` + `asgi-lifespan` (backend); `Playwright` (frontend); `jiwer` for WER thresholds against a small golden-audio fixture set** | Standard 2026 stack. |

---

## 1. Whisper / transcription engine

### Recommendation: **WhisperX 3.8.5**

- **PyPI:** `whisperx==3.8.5` (released 2026-04-01) — Source: [whisperx · PyPI](https://pypi.org/project/whisperx/)
- **Python:** `>=3.10, <3.14` (use 3.11 — pyannote and faster-whisper both fully tested on 3.11)
- **CUDA:** 12.8 recommended per the WhisperX README; minimum 12.3 because `ctranslate2>=4.5` requires cuDNN 9 which requires CUDA ≥12.3 — Source: [SYSTRAN/faster-whisper#1086](https://github.com/SYSTRAN/faster-whisper/issues/1086)
- **Backend:** WhisperX wraps `faster-whisper>=1.2.0` (CTranslate2 INT8/FP16) for transcription, then runs `wav2vec2` for forced word-level alignment, then optionally `pyannote.audio` for diarization.

### Why WhisperX, not the alternatives

| Engine | Word-level timestamps | Diarization built-in | Speed (relative) | Verdict |
|--------|----------------------|---------------------|------------------|---------|
| `openai-whisper` (the reference impl, latest `20250625`) | Approximate (segment-level) | No | 1x | Use only as a sanity baseline. PyTorch eager, no batching. |
| `faster-whisper` (1.2.1) | Better, but no forced alignment | No | ~4x | Best general-purpose backend, but you'd have to bolt on pyannote yourself. |
| `whisper.cpp` (ggml) | Yes | No | CPU-fast, GPU-good with CUDA build | Best if you wanted to run on the friend's machine without Python; not your case. |
| **WhisperX 3.8.5** | **Yes (wav2vec2 forced alignment)** | **Yes (pyannote)** | **~60–70x via batched inference on `large-v2`** | ✅ Pick this. Solves all three of your needs in one pipeline. |
| `insanely-fast-whisper` | No alignment | No | Very fast | Throughput-focused, no diarization, less battle-tested for production transcript editing. |

Sources: [Modal — Choosing between Whisper variants](https://modal.com/blog/choosing-whisper-variants), [WhisperX repo](https://github.com/m-bain/whisperX), [faster-whisper repo](https://github.com/SYSTRAN/faster-whisper).

### Whisper model selection (the user's quality preset)

| Preset | Model | VRAM | Speed (vs realtime, single 30xx-class GPU, fp16) | WER on tough audio |
|--------|-------|------|--------------------------------------------------|---------------------|
| Fast   | `small` (CT2 fp16) or `medium`  | ~2–5 GB | 20–40x | Higher; fine for low-stakes "just give me the gist" |
| **Average (default)** | **`large-v3-turbo`** | **~6 GB** | **~30–60x with WhisperX batching** | **~12% on hard audio (~2pp worse than `large-v3`)** |
| Slow   | `large-v3` | ~10 GB | ~10–20x | ~10%; the gold standard for non-English/spontaneous speech |

`large-v3-turbo` (4-decoder-layer pruned `large-v3` finetune, ~809M params vs 1.54B for `large-v3`) is the right default in 2026: it's `large-v2`-quality at ~6x the speed and fits 6GB GPUs. Sources: [pcxio — large-v3 vs turbo](https://pcxio.com/whisper-large-v3-vs-whisper-large-v3-turbo-the-speed-revolution/), [HuggingFace — whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo).

For Slow, use `large-v3` not `turbo` — when the user explicitly opts into slow they want the best output, especially for non-English audio (turbo is finetuned mostly on English). Source: [PyPI — openai-whisper](https://pypi.org/project/openai-whisper/).

### Pinning rationale

```
whisperx==3.8.5
faster-whisper>=1.2.0,<2.0
ctranslate2>=4.5.0,<5.0      # requires CUDA 12.3+/cuDNN 9
pyannote.audio>=3.3.2,<4.0   # WhisperX 3.8.5 does NOT yet support pyannote 4
torch>=2.4,<3.0              # whatever ships with your CUDA wheel
torchaudio                    # match torch
```

Confidence: **HIGH** (versions verified against PyPI, faster-whisper README, and WhisperX issue tracker on 2026-04-27).

---

## 2. Diarization

### Recommendation: **pyannote-audio 3.4.x with `pyannote/speaker-diarization-3.1`** (driven *through* WhisperX, not directly).

### The 2026 lay of the land

There are three viable options, in order of fit for your stack:

1. **WhisperX-driven pyannote 3.x** ← **PICK THIS**. Zero glue code. Hands you `[{text, start, end, speaker}, ...]`. Works on CUDA, ~2.5% real-time factor on a single GPU. DER ~11–19% on standard benchmarks.
2. **pyannote-audio 4.0.4 + Community-1** — CC-BY-4.0 fully open model. **But:** WhisperX 3.8.5 still pins `pyannote-audio>=3.3.2` and pyannote 4 has breaking API changes (`use_auth_token` kwarg semantics) that break WhisperX. Tracking issues: [whisperX#1240](https://github.com/m-bain/whisperX/issues/1240), [#1241](https://github.com/m-bain/whisperX/issues/1241), [#1300](https://github.com/m-bain/whisperX/issues/1300). Revisit when WhisperX 3.9 drops.
3. **NVIDIA NeMo Sortformer** — strictly open (no HF gating), better than pyannote for 2-speaker scenarios, but doubles inference time and requires you to write your own ASR↔diarization stitching layer. Not worth it given WhisperX exists.

Sources: [La Javaness — pyannote vs NeMo](https://lajavaness.medium.com/comparing-state-of-the-art-speaker-diarization-frameworks-pyannote-vs-nemo-31a191c6300), [BrassTranscripts — diarization comparison 2026](https://brasstranscripts.com/blog/speaker-diarization-models-comparison), [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1).

### HuggingFace token / model gating — the licensing gotcha (call this out in the README)

Every viable pyannote pipeline requires:

1. A HuggingFace account.
2. A read-scoped User Access Token (`HF_TOKEN` env var).
3. **Manually accepting the user agreement on each gated model page**, even Community-1 (CC-BY-4.0) requires acceptance even though the license is open. The acceptance is instant for individuals.

For `speaker-diarization-3.1`, you must accept conditions on **two** model pages: `pyannote/segmentation-3.0` AND `pyannote/speaker-diarization-3.1`. WhisperX will silently fail-soft and skip diarization if the token can't pull either model.

Sources: [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1), [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1), [WhisperX#841](https://github.com/m-bain/whisperX/issues/841).

### Practical setup

```python
import whisperx, torch

device = "cuda"
asr = whisperx.load_model("large-v3-turbo", device, compute_type="float16")
align_model, metadata = whisperx.load_align_model(language_code="en", device=device)
diarize = whisperx.DiarizationPipeline(use_auth_token=os.environ["HF_TOKEN"], device=device)

audio = whisperx.load_audio("input.wav")
result = asr.transcribe(audio, batch_size=16)
result = whisperx.align(result["segments"], align_model, metadata, audio, device)
diar = diarize(audio, num_speakers=None)  # or min_speakers/max_speakers
result = whisperx.assign_word_speakers(diar, result)
```

Confidence: **HIGH**.

---

## 3. Audio / video preprocessing (ffmpeg)

### Recommendation: **System `ffmpeg` binary + `subprocess.run` from Python.** Skip the wrappers.

WhisperX and faster-whisper both already invoke `ffmpeg` internally to decode audio into a 16kHz mono float32 numpy array — the wrappers (`ffmpeg-python`, `pydub`, `moviepy`) add an extra layer for what is, in practice, a single 1-line normalization step. `ffmpeg-python` (`kkroening/ffmpeg-python`) hasn't had a meaningful release in years; `pydub` does its own subprocess shelling.

### The single normalization call you need

```python
import subprocess, pathlib

def normalize_to_wav(src: pathlib.Path, dst: pathlib.Path) -> None:
    subprocess.run([
        "ffmpeg", "-y", "-i", str(src),
        "-vn",                  # drop video
        "-ac", "1",             # mono
        "-ar", "16000",         # 16 kHz
        "-c:a", "pcm_s16le",    # uncompressed
        str(dst),
    ], check=True, capture_output=True)
```

That's the entire preprocessing pipeline for v1. Whisper expects 16kHz mono, accepts mp3/m4a/mp4/mov/webm/etc. via this single command.

### Operational notes

- **Bundle ffmpeg.** The backend deploy environment (your local machine) must have `ffmpeg` ≥ 6.x in `$PATH`. Add a startup check that runs `ffmpeg -version` and refuses to boot otherwise.
- **Stream stderr for progress.** ffmpeg writes `time=HH:MM:SS.ms` to stderr; if you want a real-time normalization progress bar (only matters for very long inputs), parse it. For v1, just block; normalization is far faster than transcription so it doesn't need its own progress.
- **Validate inputs before running.** `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1` lets you reject inputs longer than your duration cap (your file-size + duration cap requirement) **before** copying bytes around.

Source: [Gumlet — How to Use FFmpeg with Python in 2026](https://www.gumlet.com/learn/ffmpeg-python/).

Confidence: **HIGH**.

---

## 4. FastAPI patterns for long-running jobs with progress

### Recommendation: **`asyncio.Queue` + a single background worker task started in the FastAPI lifespan, with a process-wide `asyncio.Lock` around the GPU.** No Redis. No Celery. No arq.

### Why not Celery/RQ/arq for v1

The single-job-on-the-GPU constraint inverts the normal "we need a queue because we have N workers" reasoning. You have *exactly one* worker (the GPU) and *exactly one* host (your PC). Adding Redis means:

- A Redis container you have to keep alive.
- Two processes (FastAPI + arq worker) where there should be one.
- Cross-process state for what is fundamentally a singleton.

Pick arq+Redis only if/when you (a) split the worker to a different machine, or (b) need scheduled retries and DLQs. You don't, yet.

Source: [davidmuraya — FastAPI Background Tasks vs ARQ](https://davidmuraya.com/blog/fastapi-background-tasks-arq-vs-built-in/), [Yamishift — FastAPI BG vs Celery vs Arq](https://medium.com/@komalbaparmar007/fastapi-background-tasks-vs-celery-vs-arq-picking-the-right-asynchronous-workhorse-b6e0478ecf4a).

### Why not raw `BackgroundTasks` either

`fastapi.BackgroundTasks` runs *after the response is sent*, in the same event loop, with no admission control. Two simultaneous uploads = two concurrent GPU jobs = OOM crash. You explicitly listed "single-job queue on the backend so concurrent requests don't crash the GPU" as a requirement; `BackgroundTasks` cannot give you that.

### The pattern (~50 lines)

```python
# app/jobs.py
import asyncio
from dataclasses import dataclass, field
from enum import Enum
from uuid import UUID, uuid4

class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"

@dataclass
class Job:
    id: UUID = field(default_factory=uuid4)
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0           # 0.0–1.0
    stage: str = "queued"           # "normalizing" | "transcribing" | "aligning" | "diarizing"
    result: dict | None = None
    error: str | None = None
    # An asyncio.Queue per job that the SSE endpoint subscribes to
    events: "asyncio.Queue[dict]" = field(default_factory=asyncio.Queue)

class JobManager:
    def __init__(self) -> None:
        self.jobs: dict[UUID, Job] = {}
        self.queue: asyncio.Queue[Job] = asyncio.Queue()
        self.gpu_lock = asyncio.Lock()
        self.worker_task: asyncio.Task | None = None

    async def submit(self, job: Job) -> None:
        self.jobs[job.id] = job
        await self.queue.put(job)

    async def worker_loop(self, run_pipeline) -> None:
        while True:
            job = await self.queue.get()
            async with self.gpu_lock:           # serialise GPU access
                try:
                    job.status = JobStatus.RUNNING
                    await run_pipeline(job)     # emits events into job.events
                    job.status = JobStatus.DONE
                except Exception as e:
                    job.status = JobStatus.FAILED
                    job.error = repr(e)
                finally:
                    await job.events.put({"event": "end"})
```

Wire it up in the lifespan:

```python
# app/main.py
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.jobs = JobManager()
    app.state.jobs.worker_task = asyncio.create_task(
        app.state.jobs.worker_loop(run_transcription_pipeline)
    )
    yield
    app.state.jobs.worker_task.cancel()

app = FastAPI(lifespan=lifespan)
```

### When to escalate to arq

If you ever (a) survive a `cloudflared` restart without losing in-flight jobs, (b) want retries with backoff, or (c) want job persistence across server reboots — switch to **arq 0.27+** (async-native, Redis-only). It's ~700 LoC, fits FastAPI naturally, and the migration is essentially "replace `await jobs.submit(job)` with `await arq_pool.enqueue_job('run_pipeline', job_id)`".

Source: [arq vs celery via davidmuraya](https://davidmuraya.com/blog/fastapi-background-tasks-arq-vs-built-in/).

Confidence: **HIGH**.

---

## 5. Public exposure: Cloudflare Tunnel — keep it, with eyes open

### Recommendation: **Cloudflare Tunnel (`cloudflared`) on the named-tunnel + custom subdomain pattern.** Keep it. The 100MB cap is real but solvable in §7 below.

### The hard limits you need to know (free plan, 2026)

| Limit | Value | Consequence | Mitigation |
|-------|-------|-------------|------------|
| Max request body size (proxied) | **100 MB** | Any single HTTP POST > 100MB → 413 Request Entity Too Large from CF edge, never reaches your backend. | **Chunked upload** (split file client-side, POST 95MB chunks, reassemble server-side) OR **direct-to-Supabase Storage** (file bypasses CF entirely). See §7. |
| WebSocket idle timeout | **100 seconds** | A WS sitting idle for 100s without bytes either way is closed. | Use SSE instead (no equivalent limit), or send a ping every 30s. |
| Proxy idle timeout (general) | **900s (15 min)** | Connection-level reuse window; not a per-request timeout. | Not a problem for our use case. |
| HTTP request duration | No documented hard cap on Free for SSE; Cloudflare states "no effective limit on SSE response duration" | An SSE stream open for an hour during a long transcription is fine. | Don't over-engineer. |
| Bandwidth | **Unlimited** | — | No mitigation needed. |
| Number of tunnels | Unlimited | — | — |

Sources: [Cloudflare community — 100MB tunnel limit](https://community.cloudflare.com/t/100mb-tunnel-limit/901339), [WebSockets — Cloudflare docs](https://developers.cloudflare.com/network/websockets/), [Cloudflare community — SSE 524 timeouts](https://community.cloudflare.com/t/are-server-sent-events-sse-supported-or-will-they-trigger-http-524-timeouts/499621), [Bypassing Cloudflare upload limit (Petrina)](https://tpetrina.com/til/2025-01-02-cloudflare-upload-limit), [Recca0120 — Cloudflare Tunnel in 2026](https://recca0120.github.io/en/2026/04/14/cloudflare-tunnel-2026/).

### Alternatives surveyed (and dismissed)

| Tool | Free file-upload cap | Free bandwidth | Free hostname | Verdict |
|------|----------------------|----------------|---------------|---------|
| **Cloudflare Tunnel** | 100 MB body (workaroundable) | **Unlimited** | Custom subdomain on your CF-managed domain | ✅ **Keep.** |
| ngrok free | No documented per-request cap, but **1 GB bandwidth/month**, 20k requests/month, 2h sessions, random `*.ngrok-free.app` URL with interstitial page | 1 GB/mo cap | Random subdomain | ❌ Bandwidth + interstitial kill it for portfolio use. |
| Tailscale Funnel | Beta; routes via Tailscale relay; not really designed for public anonymous traffic | Limited by Tailscale relay quota | Sub of `*.ts.net` | ❌ Wrong tool for "anyone on the internet drops in a file." |
| FRP (self-hosted) | None (no proxy in middle) | None | Bring your own VPS | ❌ Requires a VPS = recurring cost. Violates the constraint. |

Sources: [ngrok free plan limits](https://ngrok.com/docs/pricing-limits/free-plan-limits), [Tailscale Funnel docs](https://tailscale.com/kb/1223/funnel), [Pinggy — ngrok alternatives 2026](https://pinggy.io/blog/best_ngrok_alternatives/).

### One critical config note

In your `cloudflared` config (`~/.cloudflared/config.yml`), the ingress block accepts `http2Origin: true` and `connectTimeout` knobs that you might be tempted to tune. **Don't.** None of them lift the 100MB body limit — that limit is enforced at the **Cloudflare edge**, not in cloudflared itself. The only path to lift it is a paid plan (Pro = 200MB, Business = 500MB) or chunked uploads.

Confidence: **HIGH**.

---

## 6. Supabase integration — the Next.js / FastAPI split

### Recommendation: **Frontend writes user-owned data directly via `@supabase/ssr` + RLS. FastAPI verifies the user JWT via JWKS, then uses the `service_role` key only for backend-owned writes (job records, transcript artifacts produced by the GPU).**

### The architecture in one diagram

```
                 ┌──────────────────────────────────────────────────────────────┐
                 │ Browser                                                       │
                 │   - @supabase/supabase-js (client component)                 │
                 │   - sets/reads cookies, holds anon key                       │
                 └─────────────┬─────────────────────────────────┬──────────────┘
                               │                                 │
                               │ user-owned reads/writes         │ submit job (Bearer JWT)
                               │ (history, rename speaker)        │ stream progress (SSE)
                               │ + RLS                            │
                               ▼                                 ▼
                 ┌────────────────────────────┐    ┌──────────────────────────────┐
                 │ Supabase                   │    │ FastAPI (home GPU host)      │
                 │   - Postgres + RLS         │◄───┤ - verify JWT via JWKS (RS/ES)│
                 │   - Auth (issues ES256 JWT)│    │ - service_role key           │
                 │   - Storage                │    │ - whisperx pipeline          │
                 └────────────────────────────┘    └──────────────────────────────┘
```

### Frontend: `@supabase/ssr`

- **Package:** `@supabase/ssr` — the *only* supported pattern for Next.js 14+/15. `@supabase/auth-helpers-nextjs` is deprecated; do not use.
- **Pattern:** Two clients — a *server* client (`createServerClient`, used in Server Components, Route Handlers, Server Actions) and a *browser* client (`createBrowserClient`, used in Client Components). A middleware refreshes the session cookie on every request. Server Components can *read* but not *write* cookies; the docs canonical pattern is a try/catch in your `setAll` cookie handler — let middleware do the actual writing.
- **Versions (2026-04):** `@supabase/ssr ^0.7.0`, `@supabase/supabase-js ^2.x` (latest).

Sources: [@supabase/ssr — npm](https://www.npmjs.com/package/@supabase/ssr), [Supabase — SSR Auth Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs).

### Backend: JWT verification via JWKS

Supabase moved its JWT signing from a static HS256 shared secret to **asymmetric ES256 with rotating keys exposed at `/auth/v1/.well-known/jwks.json`**. Verify in FastAPI like this:

```python
# app/auth.py
import os, jwt
from jwt import PyJWKClient
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

JWKS_URL = f"{os.environ['SUPABASE_URL']}/auth/v1/.well-known/jwks.json"
PROJECT_REF = os.environ["SUPABASE_PROJECT_REF"]
_jwks = PyJWKClient(JWKS_URL, cache_keys=True, lifespan=3600)

bearer = HTTPBearer(auto_error=False)

async def current_user_optional(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict | None:
    if creds is None:
        return None  # anonymous user — allowed for /transcribe
    try:
        signing_key = _jwks.get_signing_key_from_jwt(creds.credentials).key
        claims = jwt.decode(
            creds.credentials,
            signing_key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            issuer=f"{os.environ['SUPABASE_URL']}/auth/v1",
        )
        return claims  # claims["sub"] is the user UUID
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
```

Pin `PyJWT[crypto]>=2.9.0,<3.0` (cryptography backend needed for ES256). Source: [Supabase — JWTs](https://supabase.com/docs/guides/auth/jwts), [objectgraph — Migrating Supabase JWT to JWKS](https://objectgraph.com/blog/migrating-supabase-jwt-jwks/), [zwx00 — Validating Supabase JWT in FastAPI](https://dev.to/zwx00/validating-a-supabase-jwt-locally-with-python-and-fastapi-59jf).

### What goes where

| Concern | Frontend (Next.js + @supabase/ssr) | FastAPI (supabase-py + service_role) |
|---------|-----------------------------------|--------------------------------------|
| Auth flows (sign in, sign out) | ✅ Yes — uses Supabase Auth UI / OTP / magic link | Never |
| Read user's own transcript history | ✅ Yes (RLS enforces `owner_id = auth.uid()`) | Never |
| Rename a speaker in saved transcript | ✅ Yes | Never |
| Submit a transcription job | Sends `POST /transcribe` to FastAPI with Bearer JWT | Receives, queues |
| Insert a `jobs` row | ❌ No | ✅ Yes (FastAPI inserts with `user_id` from JWT claims) |
| Insert finished `transcripts` row | ❌ No | ✅ Yes (FastAPI inserts when job completes) |
| Stream progress | Subscribes to FastAPI SSE | ✅ Emits SSE |

The `service_role` key bypasses RLS — it's a god-key. **Never** expose it to the browser. Only the FastAPI backend ever sees it.

### `supabase-py` specifics

- **Package:** `supabase` 2.x on PyPI (the `supabase-py` repo). Sync API by default; for async use the same `create_client` and prefer `await`-aware methods (it has been moving toward async; for v1 you can use it sync inside `run_in_threadpool` and not lose much).
- **Don't** use `supabase-py-async` (it's a community fork that's lagging behind the upstream async support).

Sources: [supabase/supabase-py](https://github.com/supabase/supabase-py), [supabase · PyPI](https://pypi.org/project/supabase/).

Confidence: **HIGH**.

---

## 7. File upload UX — the most important architectural decision

### The constraint collision

You said files might be **hundreds of MB**. The two free-tier ceilings are:

- **Cloudflare Tunnel free:** 100 MB max request body. Hardcoded at CF edge.
- **Supabase Storage free:** 50 MB max per file. Hardcoded.

Neither can be lifted on free. So you have three honest options:

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| **A. Direct browser → FastAPI through CF Tunnel** | Simple. No Supabase Storage needed. | Hard 100MB cap. Big files require client-side chunking. | ✅ **Use for anonymous users + signed-in users with files <95MB.** |
| **B. Browser → Supabase Storage (TUS resumable, signed URL), then FastAPI pulls from Supabase** | Bypasses CF Tunnel for the upload. Resumable. | 50MB-per-file cap on free Supabase Storage. Adds bandwidth egress to Supabase free quota (5GB/mo). | ❌ The 50MB file-size cap defeats the purpose. |
| **C. Chunked upload to FastAPI through CF Tunnel, server reassembles** | Bypasses 100MB cap entirely. Resumable possible. | More client code. ~95MB chunks. | ✅ **Use for files ≥95MB.** |

### Recommendation: **A + C, both via FastAPI. Skip Supabase Storage for the source media.**

Why not use Supabase Storage at all for the source?

- 50MB cap kills the use case.
- Source media is *transient* — once transcribed, you don't need it. Persisting it to Storage would also burn your 1GB Storage quota fast.
- Users get a worse experience: upload to Supabase, wait, then your FastAPI has to download it back over the public internet (or via Supabase's egress, which counts against the 5GB/mo bandwidth quota).

So: **FastAPI receives the file directly, transcribes, returns transcript, deletes file from disk.** Cloudflare bandwidth is unlimited; your home machine's disk is huge; your home upload bandwidth is the only real cost (and it's free at $0/month).

### Implementation: chunked-upload via TUS

- **Client:** [`tus-js-client`](https://github.com/tus/tus-js-client) (the reference implementation, ~16k stars). Configure `chunkSize: 90 * 1024 * 1024` (90MB to leave headroom under CF's 100MB cap).
- **Server:** [`tuspy`](https://pypi.org/project/tuspy/) is a client; for the server side use [`tuspyserver`](https://pypi.org/project/tuspyserver/) or roll your own minimal TUS endpoints (TUS-Resumable, Upload-Length, Upload-Offset). Chunked-upload servers in pure FastAPI are ~150 lines.
- **Alternative if you want zero TUS:** plain "split into N parts, POST each as `multipart/form-data` with `X-Chunk-Index`/`X-Chunk-Total` headers, server appends to a temp file, on the last chunk move into the job queue." Simpler than TUS, no resumability, fine for v1.

Sources: [Supabase — Resumable Uploads (TUS)](https://supabase.com/docs/guides/storage/uploads/resumable-uploads) (read for the TUS protocol shape; you're not using their endpoint though), [Petrina — Bypassing CF upload limit](https://tpetrina.com/til/2025-01-02-cloudflare-upload-limit), [Immich#22762 — chunked uploads to bypass 100MB](https://github.com/immich-app/immich/discussions/22762).

### File-size and duration cap (your stated requirement)

Pick concrete caps and enforce them on **both** ends:

```python
MAX_FILE_BYTES = 1_500_000_000   # 1.5 GB
MAX_DURATION_S = 4 * 3600        # 4 hours
```

- Frontend: refuse to upload before sending bytes (cheap UX win).
- Backend: re-validate after assembly using `ffprobe` to get duration; reject if over.

Confidence: **MEDIUM-HIGH**. The 100/50MB cap collision is the least obvious thing in this whole stack and you should re-validate the chunk-size headroom number against your specific CF account before shipping.

---

## 8. Frontend transcript editor

### Recommendation: **Build it yourself with shadcn primitives. Do NOT pull in Tiptap, Lexical, Slate, or ProseMirror.**

A diarized transcript is fundamentally different from a rich-text document. Its data model is:

```
Transcript = [Segment]
Segment = { id, speaker_id, start_ms, end_ms, words: [{ text, start_ms, end_ms }] }
Speaker = { id, label }   // label is mutable (rename UX)
```

Your editing operations are all **structural**, not formatting:

1. Rename a speaker globally (`speakers[id].label = "Maria"`).
2. Reassign one segment to a different speaker (`segment.speaker_id = X`).
3. Reassign all segments-with-this-speaker to a different speaker (the "apply to every instance" toggle).
4. Edit segment text inline (mishears).

None of this benefits from a rich-text editor. Rich-text editors give you bold/italic/lists/tables — and they aggressively try to **own** your document model, which means every speaker rename becomes a shoe-horn into ProseMirror nodes/marks. You end up writing more code, not less.

### The build-it-yourself recipe (~200–300 LoC)

- **State:** `useReducer` over the structured transcript JSON. Or Zustand for cross-component access.
- **Speaker label:** controlled `<Input>` from shadcn with optimistic update + Supabase upsert for signed-in users.
- **Inline text edit:** a `contentEditable` span per segment, `onBlur` writes back. Or, simpler, click-to-edit pops a textarea. shadcn's `<Popover>` + `<Textarea>` is enough.
- **Speaker reassignment:** shadcn `<DropdownMenu>` per segment showing speaker list + "Reassign all of <speaker>'s segments" item.
- **Clickable timestamps:** each segment has an `onClick` that calls `audioEl.currentTime = segment.start_ms / 1000`.
- **Keyboard a11y:** wrap segments in `react-aria` or just plain `tabIndex=0` + arrow-key handlers.

### When Tiptap would make sense (and why this isn't it)

Tiptap is the right call if you're building a *general-purpose* editor (Notion-style, blog post, Markdown). Lexical wins at scale (Meta uses it for FB comments). Slate wins for fully custom schemas. None of those constraints apply here.

Sources: [PkgPulse — Tiptap vs Lexical vs Slate vs Quill 2026](https://www.pkgpulse.com/blog/tiptap-vs-lexical-vs-slate-vs-quill-rich-text-editor-2026), [BuildPilot — Tiptap vs Lexical vs Plate 2026](https://trybuildpilot.com/609-tiptap-vs-lexical-vs-plate-editor-2026).

### Audio scrubber (optional, defer to phase 2)

If you want a waveform with the playhead synced to transcript scroll: **`wavesurfer.js` 7.x + `@wavesurfer/react`**. Don't build day 1; default to `<audio controls>` with `currentTime`-tied highlighting and ship.

Source: [wavesurfer.js docs](https://wavesurfer.xyz/).

Confidence: **MEDIUM**. Reasonable people would pick Tiptap. The argument for "roll your own" is stronger here than usual because the document is *structurally* different from prose and the editing surface is small.

---

## 9. Observability / progress reporting

### Recommendation: **Server-Sent Events via `sse-starlette`. One SSE endpoint per job that streams JSON events from the worker's `asyncio.Queue`.**

### Why SSE, not WebSocket, not polling

| Approach | Cloudflare Tunnel free | Code complexity | Bidirectional | Verdict |
|----------|------------------------|------------------|---------------|---------|
| **SSE** | **No effective duration limit on Cloudflare** (verified in CF community); native browser `EventSource`; reconnects automatically | Low — generator function, `yield` events | No (server→client only) | ✅ **Pick this.** Progress reporting is one-directional anyway. |
| WebSocket | 100s idle timeout — needs heartbeat ping every <100s; `cloudflared` adds its own gotchas | Medium — connection lifecycle, ping/pong | Yes | ❌ Overkill, more failure modes. |
| Polling | Always works | Low | No | ⚠️ Acceptable fallback. Adds latency. Only use if SSE proves flaky in your specific Tunnel config. |

Sources: [Cloudflare community — SSE no 524 timeout](https://community.cloudflare.com/t/are-server-sent-events-sse-supported-or-will-they-trigger-http-524-timeouts/499621), [Cloudflare WebSockets docs — 100s idle](https://developers.cloudflare.com/network/websockets/), [JetBI — Streaming in 2026](https://jetbi.com/blog/streaming-architecture-2026-beyond-websockets), [sse-starlette](https://pypi.org/project/sse-starlette/).

### Versions and packages

- **`sse-starlette ^2.x`** — the de facto FastAPI SSE library. Note: FastAPI 0.135+ ships a built-in `EventSourceResponse` at `fastapi.sse`, but `sse-starlette` is still more mature and widely used; pick one and stick.
- Pin `fastapi >= 0.115` (current stable as of 2026-04 is in the 0.115–0.135 line; check before locking).

### The endpoint shape

```python
from sse_starlette.sse import EventSourceResponse
from fastapi import APIRouter, Request

router = APIRouter()

@router.get("/jobs/{job_id}/events")
async def job_events(job_id: UUID, request: Request, jobs: JobManager = Depends(get_jobs)):
    job = jobs.jobs.get(job_id)
    if not job:
        raise HTTPException(404)

    async def event_stream():
        # Replay current state once on connect
        yield {"event": "snapshot", "data": json.dumps({
            "status": job.status, "progress": job.progress, "stage": job.stage
        })}
        while True:
            if await request.is_disconnected():
                break
            try:
                msg = await asyncio.wait_for(job.events.get(), timeout=15)
                yield {"event": msg["event"], "data": json.dumps(msg.get("data", {}))}
                if msg["event"] == "end":
                    break
            except asyncio.TimeoutError:
                yield {"event": "ping", "data": "{}"}    # keepalive

    return EventSourceResponse(event_stream())
```

### What to emit

Coarse, monotonic, deterministic:

```
{"event": "stage", "data": {"stage": "normalizing"}}
{"event": "stage", "data": {"stage": "transcribing", "progress": 0.0}}
{"event": "progress", "data": {"progress": 0.42}}    # WhisperX exposes batch index/total
{"event": "stage", "data": {"stage": "aligning", "progress": 0.0}}
{"event": "stage", "data": {"stage": "diarizing", "progress": 0.0}}
{"event": "result", "data": {"transcript_id": "..."}}
{"event": "end"}
```

For a real (non-fake) progress bar, use the audio duration as denominator and emit progress as `seconds_processed / total_seconds`. WhisperX's `transcribe()` doesn't natively callback per-batch, but you can monkey-patch or wrap the inner loop. As a pragmatic fallback, emit linear-interpolated progress between stage boundaries — the user requirement is "non-fake," meaning it should *advance* meaningfully, not necessarily reflect every percentage point of GPU work.

Confidence: **HIGH**.

---

## 10. Testing

### Recommendation

| Layer | Tool | Purpose |
|-------|------|---------|
| Backend unit/integration | **`pytest 8.x` + `pytest-asyncio 0.24+` + `httpx 0.28+` + `asgi-lifespan 2.x`** | Async-native test harness. `LifespanManager(app)` lets the JobManager actually start in tests. |
| Backend mocking | **`pytest-mock` + `respx`** (`respx` for HTTPX request stubs, useful when the FastAPI side calls Supabase) | Don't hit real Supabase in unit tests. |
| ASR quality | **`jiwer 4.x`** for WER/CER + a tiny golden-fixtures dir | See below. |
| Frontend E2E | **`Playwright 1.5x` (TS, with `@playwright/test`)** | Standard for Next.js. Use Vercel's preview URL for CI. |
| Frontend unit | **`vitest 2.x` + `@testing-library/react` + `jsdom`** | Skip Jest in 2026 — Vitest is faster and natively ESM. |

Sources: [FastAPI — Async Tests](https://fastapi.tiangolo.com/advanced/async-tests/), [TestDriven.io — FastAPI + pytest](https://testdriven.io/blog/fastapi-crud/), [jiwer — PyPI](https://pypi.org/project/jiwer/).

### Whisper-pipeline-specific testing

The trap: ASR is non-deterministic between CT2 versions, between FP16/FP32, and between batch sizes. Pin everything, accept ranges, and fail loud only on regressions.

**Golden-audio fixtures:**

- 3–5 short clips (10–30 seconds each), under `tests/fixtures/audio/`:
  - `clean_english_single_speaker.wav`
  - `noisy_english_single_speaker.wav`
  - `two_speakers_overlap.wav`
  - `non_english_french.wav` (or whatever your friend's typical content is)
  - `silence_with_one_word.wav` (smoke test for hallucination)
- Each with a `*.ref.txt` (human-validated reference transcript) and `*.ref.json` (with expected speaker count and approximate timestamps).

**Threshold testing pattern:**

```python
import pytest, jiwer
from pathlib import Path

@pytest.mark.parametrize("clip,max_wer,expected_speakers", [
    ("clean_english_single_speaker", 0.05, 1),
    ("noisy_english_single_speaker", 0.20, 1),
    ("two_speakers_overlap",         0.25, 2),
])
def test_pipeline_quality(clip, max_wer, expected_speakers, transcribe_pipeline):
    audio = Path("tests/fixtures/audio") / f"{clip}.wav"
    ref = (Path("tests/fixtures/audio") / f"{clip}.ref.txt").read_text()
    result = transcribe_pipeline(audio)
    hyp = " ".join(s["text"] for s in result["segments"])
    assert jiwer.wer(ref, hyp) <= max_wer
    speakers = {s["speaker"] for s in result["segments"] if s.get("speaker")}
    assert len(speakers) == expected_speakers
```

Mark these `@pytest.mark.gpu` and skip in CI by default (Vercel/GH Actions have no GPU). Run locally.

**For non-GPU CI**, mock the WhisperX pipeline (replace with a deterministic stub that returns a canned segments list) and only test the surrounding plumbing — auth, queueing, SSE, RLS. The actual ASR quality test is a manual/local gate, run before each release tag.

Confidence: **HIGH**.

---

## Recommended Stack — consolidated

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | 15.x (App Router) | Frontend framework | Locked. RSC + Server Actions are the right home for `@supabase/ssr`. |
| React | 19.x | UI runtime | Comes with Next 15. |
| Tailwind CSS | 4.x | Styling | Locked. CSS-first config in v4. |
| shadcn/ui | latest (April 2026 catalog) | Headless component primitives | Locked. Generated components, not a dependency — perfect for "small + tweakable." |
| TypeScript | 5.6+ | Frontend types | Standard. |
| FastAPI | ^0.115 (verify latest before locking) | HTTP framework | Locked. Async-native, OpenAPI for free. |
| Python | 3.11.x | Backend runtime | 3.11 is the sweet spot for Whisper/pyannote stability. 3.12/3.13 work but pyannote dependencies trail. |
| WhisperX | 3.8.5 | ASR + diarization pipeline | Bundles all three of (ASR, word alignment, diarization). |
| faster-whisper | 1.2.1 (transitive via WhisperX) | CTranslate2-backed Whisper | 4–6x speedup over reference Whisper. |
| ctranslate2 | 4.5+ | Inference engine | Transitive. Requires CUDA 12.3+/cuDNN 9. |
| pyannote.audio | 3.4.x (`>=3.3.2,<4`) | Speaker diarization | WhisperX 3.8.5 doesn't yet support pyannote 4. Pin upper bound. |
| torch | 2.4–2.6 (whatever pairs with your CUDA wheel) | DL framework | Match faster-whisper / WhisperX expectations. |
| ffmpeg | system binary, ≥6.0 | Audio/video decode + normalize | WhisperX shells to it; you'll also use it directly. |
| Supabase | hosted free tier | Postgres + Auth + Storage | Locked. |
| Cloudflare Tunnel | latest `cloudflared` | Public exposure of home backend | Locked. |

### Supporting Libraries

#### Backend (Python)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sse-starlette` | ^2.x | Server-Sent Events for FastAPI | Progress streaming endpoint. |
| `pyjwt[crypto]` | ^2.9 | JWT verification (ES256 via JWKS) | Verifying Supabase user tokens server-side. |
| `supabase` | ^2.x (the official `supabase-py`) | Supabase Python client | Service-role inserts/updates from the FastAPI side. |
| `httpx` | ^0.27 | HTTP client | Used by tests; also if FastAPI ever pulls anything from Supabase Storage. |
| `slowapi` | ^0.1.9 | Rate limiting | Per-IP limits on `/transcribe` (in-memory backend is fine — single instance). |
| `python-multipart` | ^0.0.9 | `multipart/form-data` parsing | Required by FastAPI for file uploads. |
| `jiwer` | ^4.0 | Word Error Rate calc | Test-only. |
| `pytest` / `pytest-asyncio` / `asgi-lifespan` | latest | Test harness | Required for full async testing with the lifespan-spawned worker. |
| `respx` | ^0.21 | HTTPX request mocking | Mocking outgoing HTTP in tests. |
| `ruff` | latest | Linter + formatter | Replaces black + isort + flake8. |
| `mypy` | ^1.11 | Type checker | Optional, but valuable for the auth/JWT path. |

#### Frontend (TypeScript)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/supabase-js` | ^2.x | Supabase JS client | All Supabase access from the browser. |
| `@supabase/ssr` | ^0.7 | Cookie-based auth helpers for Next.js | Server Components + Middleware. |
| `tus-js-client` | ^4.x | TUS resumable upload client | Files ≥95MB go via TUS to FastAPI. |
| `zustand` | ^5.x | Client state | Transcript editor state — pleasant API, no boilerplate. (Or just `useReducer` if scope stays tight.) |
| `react-aria` (or `@radix-ui/*` via shadcn) | latest | Keyboard/screen-reader a11y | Already coming via shadcn. |
| `wavesurfer.js` + `@wavesurfer/react` | wavesurfer 7.x, react wrapper latest | Audio waveform | **Phase 2** only. Skip for v1. |
| `swr` or `@tanstack/react-query` | TanStack Query ^5.x | Data fetching | TanStack Query has nicer SSE/polling integration. |
| `lucide-react` | latest | Icons | Default with shadcn. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `uv` | Python dependency / venv manager | Use over `pip`/`poetry` in 2026 — 10–100x faster, drop-in, the WhisperX repo itself uses it (`uv sync --all-extras`). |
| `pnpm` | Node package manager | Faster than npm, monorepo-friendly. Configure workspaces for `frontend/` if you split. |
| `Playwright` | E2E tests | `npx playwright install --with-deps`. |
| `Vitest` | Unit tests (frontend) | Replaces Jest. |
| `pre-commit` (Python) + `lint-staged` (JS) | Git hooks | Keep history clean for portfolio review. |
| `cloudflared` CLI | Tunnel client | Set up as a `systemd` service so it survives reboots. |

---

## Installation (copy-pasteable)

### Backend

```bash
# CUDA 12.3+ and cuDNN 9 must be installed at the system level first.
# Verify: nvidia-smi (CUDA) and nvcc --version.

uv venv --python 3.11
source .venv/bin/activate

# Core
uv pip install \
  "fastapi>=0.115,<0.140" \
  "uvicorn[standard]>=0.30" \
  "python-multipart>=0.0.9" \
  "sse-starlette>=2.0,<3.0" \
  "pyjwt[crypto]>=2.9,<3.0" \
  "supabase>=2.5,<3.0" \
  "httpx>=0.27,<1.0" \
  "slowapi>=0.1.9"

# Whisper pipeline (CUDA 12 + cuDNN 9 wheels)
uv pip install \
  "whisperx==3.8.5" \
  "pyannote.audio>=3.3.2,<4.0"

# Dev
uv pip install \
  "pytest>=8.0" "pytest-asyncio>=0.24" "asgi-lifespan>=2.1" \
  "respx>=0.21" "jiwer>=4.0" \
  "ruff>=0.6" "mypy>=1.11"

# System (Ubuntu/Debian example)
sudo apt-get install -y ffmpeg
```

### Frontend

```bash
cd frontend
pnpm create next-app@latest . --ts --tailwind --app --src-dir --import-alias "@/*"

pnpm add @supabase/supabase-js @supabase/ssr \
         tus-js-client \
         zustand \
         @tanstack/react-query \
         lucide-react

pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom \
            @playwright/test
pnpm exec playwright install --with-deps

# shadcn/ui
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button input dialog dropdown-menu textarea toast
```

---

## Alternatives Considered

| Recommended | Alternative | When the alternative is better |
|-------------|-------------|--------------------------------|
| WhisperX | `faster-whisper` alone | If you don't need diarization or word-level timestamps. (You do, so don't.) |
| WhisperX | `whisper.cpp` | If you needed to ship to a non-Python environment or run on CPU-only Macs. |
| `large-v3-turbo` | `large-v3` | When the user picks "Slow" preset OR audio is non-English/spontaneous. Default `large-v3` for the "Slow" tier. |
| pyannote 3.x | NVIDIA NeMo Sortformer | If you needed strictly no-token open models AND only 2-speaker scenarios (NeMo wins ~9% DER for 2-speaker). Not worth the integration cost for this app. |
| pyannote 3.x | pyannote 4 + Community-1 | When WhisperX 3.9 ships with pyannote-4 support. Track [whisperX#1300](https://github.com/m-bain/whisperX/issues/1300). Re-evaluate at first milestone retro. |
| `asyncio.Queue` worker | arq + Redis | When you split the worker to a different machine, or want job persistence across restarts. |
| `asyncio.Queue` worker | Celery | Never, for this app. Celery's value is multi-broker, multi-language, scale-out — none of which you have. |
| SSE | WebSocket | If you ever need bidirectional control (pause/cancel from client mid-job). For v1, send a separate `DELETE /jobs/{id}` REST call instead. |
| SSE | Polling | As a debug/fallback. Add a `?poll=1` query param that returns the latest event JSON synchronously. |
| Cloudflare Tunnel | Tailscale Funnel | Never, for public-anonymous-traffic. Tailscale Funnel is for trusted-friend-network sharing. |
| Cloudflare Tunnel | ngrok free | Never, given 1GB/mo bandwidth + interstitial. |
| Direct upload to FastAPI | Supabase Storage | When file is small (<50MB) AND user is signed in AND you want the file to persist past the job. For source media, no — it's transient. |
| Roll-your-own editor | Tiptap | When the editor needs to grow into general-purpose rich-text (markdown, mentions, embeds). Not the case here. |
| `<audio>` tag | wavesurfer.js | Phase 2, when waveform visualization becomes a feature people ask for. |
| `pytest` + `httpx` | `TestClient` (Starlette) | Never use `TestClient` for async lifespan-using apps — it deadlocks. `httpx.AsyncClient + LifespanManager` is the only correct pattern. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@supabase/auth-helpers-nextjs` | Officially deprecated. All bug-fixes go to `@supabase/ssr`. | `@supabase/ssr` |
| Static HS256 JWT shared-secret verification | Supabase migrating to ES256 + JWKS. New projects ship asymmetric by default. | `PyJWKClient` + ES256 |
| `pyannote-audio==4.x` (in 2026-04) | Breaks WhisperX 3.8.5; `use_auth_token` API changed. | Pin `pyannote.audio>=3.3.2,<4` until WhisperX 3.9. |
| `ctranslate2 4.5+` with cuDNN 8 | Fails to load CUDA backend. | `ctranslate2==4.4.0` (cuDNN 8) OR upgrade host to cuDNN 9. |
| `openai-whisper` (the reference impl) | 1x speed, no batching, no diarization. | `whisperx` (which uses `faster-whisper`). |
| `ffmpeg-python` (kkroening) | Stale (last meaningful release years ago). | Direct `subprocess.run(["ffmpeg", ...])`. |
| `pydub` for any operation > "decode and chunk" | Implicit ffmpeg shelling, surprises with large files. | Direct `subprocess`. |
| `fastapi.BackgroundTasks` for the GPU job | Runs in the request event loop with no admission control — concurrent requests will OOM the GPU. | The `asyncio.Queue` + `asyncio.Lock` pattern in §4. |
| `Celery` | Operational weight (broker, worker process, scheduler) for a single-host app with one GPU is pure overhead. | In-process `asyncio.Queue` worker. |
| `WebSocket` for progress | 100s idle timeout on Cloudflare Tunnel free; you'd need a heartbeat. SSE has no equivalent limit. | SSE via `sse-starlette`. |
| `ngrok` free tier (for production-portfolio use) | 1GB/mo bandwidth + 2h sessions + interstitial page on every browser hit. Looks unprofessional. | Cloudflare Tunnel. |
| Storing source media in Supabase Storage | 50MB/file cap (free) + burns bandwidth quota + transient by nature. | Direct upload to FastAPI; delete on disk after transcription completes. |
| Tiptap/Lexical/Slate for the transcript editor | Forces structured data into rich-text node model; 80% of the framework features go unused. | Plain shadcn primitives + custom state. |
| `Jest` | Slower than Vitest, awkward ESM. | `vitest`. |
| `TestClient` from Starlette | Deadlocks with `lifespan` + background asyncio tasks. | `httpx.AsyncClient` + `asgi-lifespan.LifespanManager`. |

---

## Stack Patterns by Variant

**If anonymous user uploads <95MB file:**
- Direct browser → FastAPI multipart POST → in-memory queue → SSE progress → JSON response (no Supabase touch).

**If signed-in user uploads <95MB file:**
- Same as above + FastAPI inserts a `transcripts` row keyed by `user_id` from JWT claims so the user sees it in their history.

**If user uploads ≥95MB file:**
- TUS resumable upload (chunked at 90MB) → FastAPI assembles → queue → SSE → JSON.

**If file is ≥1.5GB or duration >4h:**
- Reject at frontend before upload (size check) and at backend after `ffprobe` (duration check). Return 413/422 with a clear message.

**If host PC is offline:**
- Frontend gets a `503 Service Unavailable` (or, more likely, a connection error from CF Tunnel). Show a "the transcription server is offline — try again later" empty state. Do NOT queue jobs in the frontend; that's a complexity trap.

---

## Version Compatibility (the gotchas)

| Combination | Status | Notes |
|-------------|--------|-------|
| `whisperx==3.8.5` + `pyannote.audio>=4.0` | ❌ **Broken** as of 2026-04-27 | Track [whisperX#1240](https://github.com/m-bain/whisperX/issues/1240). Pin `pyannote.audio<4`. |
| `whisperx==3.8.5` + `faster-whisper<1.2.0` | ❌ **Broken** | WhisperX 3.8.2 was yanked specifically for this reason. |
| `ctranslate2>=4.5` + cuDNN 8 | ❌ **Broken** (will fail at runtime: "package was not compiled with CUDA support") | Either upgrade to cuDNN 9 or pin `ctranslate2==4.4.0`. |
| Next.js 15 + `@supabase/auth-helpers-nextjs` | ⚠️ Not supported | Auth-helpers is dead. Migrate to `@supabase/ssr`. |
| `@supabase/ssr` + Server Component cookie writes | ⚠️ Read-only in RSC | Must wrap `setAll` in try/catch and let middleware refresh sessions. |
| `whisperx` + Python 3.13 | ⚠️ Untested upstream | WhisperX declares `<3.14` but pyannote dependencies (notably `lightning`/`onnxruntime`) lag — use 3.11 for the stable path. |
| Cloudflare Tunnel + `multipart/form-data` >100MB | ❌ Hard 413 at the edge | Must chunk. |

---

## Sources

### High-confidence (Context7, official docs, official repos)

- [WhisperX GitHub repo](https://github.com/m-bain/whisperX) — installation, dependency expectations, HF token requirement
- [WhisperX 3.8.5 on PyPI](https://pypi.org/project/whisperx/) — version, Python range, release date 2026-04-01
- [faster-whisper 1.2.1 on PyPI](https://pypi.org/project/faster-whisper/) — CUDA/cuDNN matrix
- [SYSTRAN/faster-whisper#1086 — CUDA compatibility](https://github.com/SYSTRAN/faster-whisper/issues/1086) — CUDA 12.3+ / cuDNN 9 requirements
- [pyannote-audio 4.0.4 on PyPI](https://pypi.org/project/pyannote-audio/) — version + release date
- [pyannote/speaker-diarization-3.1 on HF](https://huggingface.co/pyannote/speaker-diarization-3.1) — model gating, two-model acceptance requirement
- [pyannote/speaker-diarization-community-1 on HF](https://huggingface.co/pyannote/speaker-diarization-community-1) — CC-BY-4.0 license, future direction
- [whisperX#1240 — pyannote v4 incompatibility](https://github.com/m-bain/whisperX/issues/1240)
- [whisperX#1241](https://github.com/m-bain/whisperX/issues/1241), [whisperX#1300](https://github.com/m-bain/whisperX/issues/1300) — open issues tracking pyannote 4 support
- [openai-whisper on PyPI](https://pypi.org/project/openai-whisper/) — `large-v3-turbo` notes (English-only fine-tuning)
- [Supabase Storage limits docs](https://supabase.com/docs/guides/storage/uploads/file-limits) — 50MB-per-file free-tier cap
- [Supabase JWTs docs](https://supabase.com/docs/guides/auth/jwts) — JWKS migration to ES256
- [Supabase SSR Auth Next.js docs](https://supabase.com/docs/guides/auth/server-side/nextjs) — canonical client patterns
- [@supabase/ssr on npm](https://www.npmjs.com/package/@supabase/ssr) — versions
- [Cloudflare WebSockets docs](https://developers.cloudflare.com/network/websockets/) — 100s idle timeout
- [Cloudflare connection limits docs](https://developers.cloudflare.com/fundamentals/reference/connection-limits/) — 900s proxy idle timeout
- [Cloudflare community — 100MB tunnel limit](https://community.cloudflare.com/t/100mb-tunnel-limit/901339) — confirms hard cap on free
- [ngrok free plan limits](https://ngrok.com/docs/pricing-limits/free-plan-limits) — 1GB/mo bandwidth, 20k req, 2h session
- [FastAPI Async Tests](https://fastapi.tiangolo.com/advanced/async-tests/), [FastAPI Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/) — official patterns
- [FastAPI SSE / sse-starlette docs](https://pypi.org/project/sse-starlette/) — current SSE library
- [jiwer on PyPI](https://pypi.org/project/jiwer/) — WER computation library

### Medium-confidence (verified secondary sources, multiple agreeing)

- [Modal — Choosing between Whisper variants](https://modal.com/blog/choosing-whisper-variants) — engineering-blog comparison of whisper variants
- [pcxio — large-v3 vs turbo](https://pcxio.com/whisper-large-v3-vs-whisper-large-v3-turbo-the-speed-revolution/) — VRAM/speed/accuracy comparison
- [La Javaness — pyannote vs NeMo](https://lajavaness.medium.com/comparing-state-of-the-art-speaker-diarization-frameworks-pyannote-vs-nemo-31a191c6300) — DER benchmarks
- [BrassTranscripts — diarization comparison 2026](https://brasstranscripts.com/blog/speaker-diarization-models-comparison)
- [JetBI — Streaming in 2026: SSE vs WebSockets](https://jetbi.com/blog/streaming-architecture-2026-beyond-websockets)
- [davidmuraya — FastAPI BG tasks vs ARQ](https://davidmuraya.com/blog/fastapi-background-tasks-arq-vs-built-in/)
- [Yamishift — FastAPI BG vs Celery vs Arq](https://medium.com/@komalbaparmar007/fastapi-background-tasks-vs-celery-vs-arq-picking-the-right-asynchronous-workhorse-b6e0478ecf4a)
- [Cloudflare community — SSE no 524](https://community.cloudflare.com/t/are-server-sent-events-sse-supported-or-will-they-trigger-http-524-timeouts/499621)
- [Petrina — Bypassing CF upload limit](https://tpetrina.com/til/2025-01-02-cloudflare-upload-limit)
- [Immich#22762 — chunked upload to bypass 100MB](https://github.com/immich-app/immich/discussions/22762)
- [zwx00 — Validating Supabase JWT in FastAPI](https://dev.to/zwx00/validating-a-supabase-jwt-locally-with-python-and-fastapi-59jf)
- [objectgraph — Migrating Supabase JWT to JWKS](https://objectgraph.com/blog/migrating-supabase-jwt-jwks/)
- [PkgPulse — Tiptap vs Lexical vs Slate vs Quill 2026](https://www.pkgpulse.com/blog/tiptap-vs-lexical-vs-slate-vs-quill-rich-text-editor-2026)
- [BuildPilot — Tiptap vs Lexical vs Plate 2026](https://trybuildpilot.com/609-tiptap-vs-lexical-vs-plate-editor-2026)
- [wavesurfer.js docs](https://wavesurfer.xyz/)

---

*Stack research for: free GPU-local Whisper transcription web app (Next.js + FastAPI + Supabase + Cloudflare Tunnel)*
*Researched: 2026-04-27*
