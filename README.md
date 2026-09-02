# Transcribe

A free, self-hostable web app that turns long audio/video into editable, speaker-labeled transcripts using OpenAI's Whisper running locally on the developer's own GPU. Zero ongoing cost.

> **Status:** working end to end — resumable chunked upload, GPU transcription, speaker
> diarization, in-browser editing, and export. The webapp is deployed at
> <https://transcribe-ruby.vercel.app>; transcription runs only while a GPU host is awake
> and reachable, which is a property of the design rather than an outage.

## What it is

Drop in a long audio or video file (meeting recording, interview, podcast). The browser uploads it in chunks (TUS) directly to a FastAPI backend running on the developer's home GPU; the backend transcribes via `whisper.cpp` with the Vulkan backend (works on AMD), then runs `pyannote.audio` 3.x on CPU to label speakers. The result is a structured transcript — text + timestamps + speaker labels — that you can edit in-browser (rename speakers globally, fix mishears, re-assign segments) and export as `.txt`, `.srt`, `.vtt`, `.md`, or `.json`. The frontend deploys to Vercel free; the backend runs on the dev's PC and is exposed via a Cloudflare named tunnel on a custom domain (Quick Tunnel works as a fallback). The public URL works only while the host PC is awake — that's accepted, not a bug.

## Architecture

- **Frontend:** Next.js 16 + Tailwind 4 + shadcn/ui, deployed to Vercel free tier (auto-deploy on `main`).
- **Backend:** FastAPI on Python 3.11, runs locally on the dev's machine, exposed via Cloudflare Tunnel.
- **Engine:** `whisper.cpp` with Vulkan backend (works on AMD RX 6600 8 GB) + `pyannote.audio` 3.x on CPU.
- **Data plane:** Supabase (Postgres + Auth + Realtime + Storage for transcript JSON only — never source media).
- **Public exposure:** Cloudflare **named tunnel** on a custom domain (stable URL, set Vercel env once). Quick Tunnel (`*.trycloudflare.com`) remains as a fallback for hosts without a Cloudflare-managed domain. See "Public exposure (Cloudflare Tunnel)" below.

See [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) for the pinned dep matrix.

## Repo layout

```
transcribe/
  frontend/       # Next.js 16 — deploys to Vercel
  backend/        # FastAPI + whisper.cpp + pyannote — runs on the dev's GPU
  supabase/       # Migrations + RLS-from-day-one
  docs/           # DEPENDENCIES.md (pinned dep matrix)
  scripts/        # host setup helpers
  tools/          # TUS interop test page
  LICENSE         # MIT
  README.md       # this file
```

No `pnpm` workspace, no `turbo.json`, no root `package.json` — the two apps live in different ecosystems and share no runtime code; Vercel's "Root Directory = `frontend`" feature handles the layout cleanly.

## Self-hosting (high level)

The short version. Per-component detail is in the sections below.

1. Clone the repo.
2. Install host tooling: `pnpm` (via corepack), `uv` (via astral.sh installer), `cloudflared` (Cloudflare apt repo), `supabase` CLI, `gitleaks`, `pre-commit`. See [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md).
3. Copy `.env.example` to `.env`, populate with your Supabase + HF credentials, then `ln -sf $(pwd)/.env frontend/.env.local && ln -sf $(pwd)/.env backend/.env` (or maintain per-app env files separately).
4. **CRITICAL:** Run `pre-commit install` after cloning so the gitleaks hook actually runs (`.pre-commit-config.yaml` alone does nothing without `install`).
5. Apply Supabase migrations: `supabase db push --db-url "$SUPABASE_DB_URL"`.
6. Bring up `backend/` and build whisper.cpp — see "Backend: run + verify" below — then run `frontend/`.

## Public exposure (Cloudflare Tunnel)

The backend listens on `localhost:8000` and is exposed publicly through a Cloudflare Tunnel. Two modes are supported:

### Named tunnel — primary path (recommended)

Stable hostname on a domain you own (e.g. `https://api.fel.tec.br`). Set Vercel's `NEXT_PUBLIC_BACKEND_URL` **once** and never touch it again. Requires a domain whose DNS is hosted on Cloudflare (free). One-time setup:

```bash
# 1. Authorize this host with your Cloudflare account.
cloudflared tunnel login

# 2. Create the tunnel (writes credentials JSON to ~/.cloudflared/<UUID>.json).
cloudflared tunnel create transcribe

# 3. Route a hostname to the tunnel (creates a CNAME on Cloudflare DNS).
cloudflared tunnel route dns transcribe api.<your-domain>

# 4. Write ~/.cloudflared/config.yml with the tunnel UUID + ingress to localhost:8000.
#    (Template lives in backend/scripts/tunnel-named.sh comments.)

# 5. Set Vercel env once:
cd frontend
pnpm dlx vercel@latest env add NEXT_PUBLIC_BACKEND_URL production
# (paste: https://api.<your-domain>)
pnpm dlx vercel@latest redeploy --target production
```

Run interactively for debugging:
```bash
bash backend/scripts/tunnel-named.sh
```

Run as a systemd user service (auto-starts on login; survives reboots if linger is enabled):
```bash
systemctl --user enable --now transcribe-tunnel.service
sudo loginctl enable-linger "$USER"   # so the service persists when not logged in
```

The unit file lives at `~/.config/systemd/user/transcribe-tunnel.service` and runs `cloudflared tunnel run transcribe` with `Restart=on-failure`.

### Quick Tunnel — fallback (no custom domain)

Use only when you don't have a Cloudflare-managed domain on this host. The hostname (`*.trycloudflare.com`) **rotates on every restart**, so `NEXT_PUBLIC_BACKEND_URL` (baked into the Vercel JS bundle at build time) must be re-pointed and the frontend redeployed each time:

```bash
# 1. Start the rotating tunnel (script captures the URL to ~/.transcribe/tunnel-url).
bash backend/scripts/tunnel.sh

# 2. After the new URL is captured, repoint Vercel and redeploy:
NEW_URL=$(cat ~/.transcribe/tunnel-url)
cd frontend
pnpm dlx vercel@latest env rm NEXT_PUBLIC_BACKEND_URL production --yes
echo "$NEW_URL" | pnpm dlx vercel@latest env add NEXT_PUBLIC_BACKEND_URL production
pnpm dlx vercel@latest redeploy --target production
```

Pre-flight will refuse Quick Tunnel mode while a named-tunnel `~/.cloudflared/config.yml` exists (Cloudflare's own constraint, not ours). Move it aside first if you really need the fallback:
```bash
mv ~/.cloudflared/config.yml ~/.cloudflared/config.yml.bak
```

Quick Tunnel was the default until a Cloudflare-managed domain was available.

## License

[MIT](LICENSE) — chosen for compatibility with all upstream deps (Whisper, whisper.cpp, pyannote, Next.js, FastAPI all MIT/permissive).

## Backend: run + verify

The FastAPI backend runs locally on the developer's GPU host. It carries the full transcription pipeline: whisper.cpp + Vulkan ASR, pyannote-CPU diarization, a single-job queue, TUS chunked upload, and Supabase Realtime progress.

**Single-command start (OPS-02):**

```bash
cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The lifespan probes Vulkan, loads pyannote, sweeps orphaned uploads, then accepts traffic.

> **Phase 2 self-test note — leave Supabase env unset.** During Phase 2, the worker writes job/transcript rows to Supabase only when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are populated, but `POST /jobs` has no auth and therefore no `user_id` to attach. With those env vars set, the final `transcripts` INSERT fails the schema's `user_id NOT NULL` constraint (the pipeline still runs end-to-end through `merging` — only persistence fails). Phase 4 wires Supabase JWT and supplies `user_id` from the auth token; until then, run Phase 2 with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` **unset** in the runtime shell. The progress writer's lazy client constructor returns `None` when either is empty and all writes silently no-op — exactly the documented Phase 2 behavior.

**Public exposure** (Cloudflare Tunnel — full setup details in "Public exposure (Cloudflare Tunnel)" above):

```bash
# Named tunnel (recommended — stable URL, set Vercel env once):
systemctl --user start transcribe-tunnel.service     # background, persistent
# or, interactively:
bash backend/scripts/tunnel-named.sh

# Quick Tunnel fallback (no custom domain — URL rotates on every restart):
bash backend/scripts/tunnel.sh
```

For the Quick Tunnel fallback, the rotating hostname is captured in `~/.transcribe/tunnel-url` and `NEXT_PUBLIC_BACKEND_URL` must be repointed in Vercel + redeployed on every restart. The named tunnel sidesteps this entirely.

**Verification:**

```bash
bash backend/scripts/verify_phase2.sh --quick   # ~30s, mock-engine + filesystem probes (CI-friendly)
bash backend/scripts/verify_phase2.sh           # full: + real ffmpeg + pipeline unit tests + gpu transcribe
```

The full mode runs gpu-marked tests if a Vulkan device + `HF_TOKEN` are present; skips cleanly otherwise.

**Soak test** (operator-driven; ~15-30 min, GPU required):

```bash
cd backend && uv run pytest tests/test_soak.py -m "gpu and slow" -x -s
```

Asserts ±5% drift on VRAM (sysfs) AND host RSS (psutil USS) across 20 jobs. This is the falsifiable acceptance criterion for the entire phase — if it passes, the backend can sustain long sessions on the home GPU; if it fails, there's a leak to investigate.

**TUS interop with the live tunnel** (manual, ~5 min, Chrome):

```bash
open "tools/tus_interop_test.html?endpoint=$(cat ~/.transcribe/tunnel-url)/uploads"
```

Pick a 100-200 MB media file and confirm 2 PATCHes (90 MB + remainder) + final HEAD complete.

**Self-host requirements** (Ubuntu 26.04 + AMD Vulkan-capable GPU):

```bash
bash backend/scripts/install_phase2_prereqs.sh   # apt: ffmpeg, vulkan-tools, cmake, postgresql-client, glslc
bash backend/scripts/build_whisper_cpp.sh        # clone + cmake -DGGML_VULKAN=1 (5-10 min)
bash backend/scripts/download_models.sh          # ~3.5 GB GGML weights with SHA-256 verification
cd backend && uv sync                            # Python deps (pyannote, torch CPU, supabase, jiwer, psutil)
```

See [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) for pinned versions + commit SHAs.

## Status

Working end to end: resumable chunked upload, transcription on the GPU host, speaker
diarization, in-browser editing, and export to `.txt`, `.srt`, `.vtt`, `.md` and `.json`.
The webapp is deployed on Vercel; the work happens on a machine you own, so the hosted
UI transcribes only while a host is awake and reachable.

The packaged, no-Python way to run that host is
[`transcribe-engine`](https://github.com/artriv/transcribe-engine) — the same whisper.cpp
and pyannote stack as `backend/`, bundled into one tray-icon binary per OS.

