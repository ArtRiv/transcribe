# Transcribe

A free, self-hostable web app that turns long audio/video into editable, speaker-labeled transcripts using OpenAI's Whisper running locally on the developer's own GPU. Zero ongoing cost.

> **Status:** Phase 1 (Foundation) — scaffolding only; transcription pipeline arrives in Phase 2. See [`.planning/ROADMAP.md`](.planning/ROADMAP.md).

## What it is

Drop in a long audio or video file (meeting recording, interview, podcast). The browser uploads it in chunks (TUS) directly to a FastAPI backend running on the developer's home GPU; the backend transcribes via `whisper.cpp` with the Vulkan backend (works on AMD), then runs `pyannote.audio` 3.x on CPU to label speakers. The result is a structured transcript — text + timestamps + speaker labels — that you can edit in-browser (rename speakers globally, fix mishears, re-assign segments) and export as `.txt`, `.srt`, `.vtt`, `.md`, or `.json`. The frontend deploys to Vercel free; the backend runs on the dev's PC and is exposed via Cloudflare Quick Tunnel. The public URL works only while the host PC is awake — that's accepted, not a bug.

## Architecture

- **Frontend:** Next.js 16 + Tailwind 4 + shadcn/ui, deployed to Vercel free tier (auto-deploy on `main`).
- **Backend:** FastAPI on Python 3.11, runs locally on the dev's machine, exposed via Cloudflare Quick Tunnel.
- **Engine:** `whisper.cpp` with Vulkan backend (works on AMD RX 6600 8 GB) + `pyannote.audio` 3.x on CPU.
- **Data plane:** Supabase (Postgres + Auth + Realtime + Storage for transcript JSON only — never source media).
- **Public exposure:** Cloudflare Quick Tunnel (`*.trycloudflare.com`); hostname rotates on each tunnel restart (see "Tunnel restart workflow" below).

See [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) for the pinned dep matrix and [`CLAUDE.md`](CLAUDE.md) for architectural decisions.

## Repo layout

```
transcribe/
  frontend/       # Next.js 16 — deploys to Vercel
  backend/        # FastAPI + whisper.cpp + pyannote — runs on the dev's GPU
  supabase/       # Migrations + RLS-from-day-one
  docs/           # DEPENDENCIES.md (pinned dep matrix)
  .planning/      # GSD planning artifacts
  LICENSE         # MIT
  README.md       # this file
```

No `pnpm` workspace, no `turbo.json`, no root `package.json` — the two apps live in different ecosystems and share no runtime code; Vercel's "Root Directory = `frontend`" feature handles the layout cleanly.

## Self-hosting (high level — Phase 6 will expand)

Phase 1 only stands up the empty scaffolding. The full self-host walkthrough lives in Phase 6. For now:

1. Clone the repo.
2. Install host tooling: `pnpm` (via corepack), `uv` (via astral.sh installer), `cloudflared` (Cloudflare apt repo), `supabase` CLI, `gitleaks`, `pre-commit`. See [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md).
3. Copy `.env.example` to `.env`, populate with your Supabase + HF credentials, then `ln -sf $(pwd)/.env frontend/.env.local && ln -sf $(pwd)/.env backend/.env` (or maintain per-app env files separately).
4. **CRITICAL:** Run `pre-commit install` after cloning so the gitleaks hook actually runs (`.pre-commit-config.yaml` alone does nothing without `install`).
5. Apply Supabase migrations: `supabase db push --db-url "$SUPABASE_DB_URL"`.
6. Phase 2 will bring up `backend/` and the whisper.cpp build; Phase 3 will run `frontend/`.

## Tunnel restart workflow (REQUIRED reading — OPS-03)

The Cloudflare Quick Tunnel hostname (`*.trycloudflare.com`) **changes on every restart**. The frontend's `NEXT_PUBLIC_BACKEND_URL` is baked into the JS bundle at **build time** (Vercel limitation, not configurable). When the tunnel hostname changes, you must update Vercel and trigger a redeploy. Three commands:

```bash
# 1. After `cloudflared tunnel --url http://localhost:8000` has produced a new URL,
#    backend/scripts/tunnel.sh has captured it to ~/.transcribe/tunnel-url.
NEW_URL=$(cat ~/.transcribe/tunnel-url)

# 2. Replace the Vercel env var.
cd frontend
pnpm dlx vercel@latest env rm NEXT_PUBLIC_BACKEND_URL production --yes
echo "$NEW_URL" | pnpm dlx vercel@latest env add NEXT_PUBLIC_BACKEND_URL production

# 3. Trigger a redeploy (env-var change alone does NOT redeploy live site).
pnpm dlx vercel@latest redeploy --target production
```

In short: `vercel env rm NEXT_PUBLIC_BACKEND_URL`, then `vercel env add NEXT_PUBLIC_BACKEND_URL` with the new tunnel URL, then `vercel redeploy --target production`.

This costs ~1 minute per tunnel restart and is the price of using Quick Tunnel instead of a named tunnel + custom domain (the named-tunnel upgrade is deferred to v2 once a domain is registered). See [`.planning/research/SUMMARY.md`](.planning/research/SUMMARY.md) "Amendment 2026-04-27" for the decision rationale.

## License

[MIT](LICENSE) — chosen for compatibility with all upstream deps (Whisper, whisper.cpp, pyannote, Next.js, FastAPI all MIT/permissive).

## Status & Roadmap

See [`.planning/ROADMAP.md`](.planning/ROADMAP.md) — six-phase plan. Phase 1 (Foundation) is in progress; transcription pipeline (Phase 2) and frontend skeleton (Phase 3) are parallel lanes once Phase 1 closes.

