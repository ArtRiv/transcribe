# Transcribe

## What This Is

A free, self-hostable web app that turns long audio/video into editable, speaker-labeled transcripts using OpenAI's Whisper (locally, on the developer's own GPU). Built primarily so a friend can read instead of listen to long work recordings, and as a public Python/Next.js portfolio piece — so the running URL is public and anyone can drop in a file when the host machine is online.

## Core Value

Turn long, skim-hostile audio/video into accurate, speaker-labeled, editable transcripts with **zero ongoing cost** to operate.

If hosting cost ever creeps in, the project has failed its premise. Everything else (UX polish, edit features, output formats) is negotiable in service of that constraint.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

**Core flow:**
- [ ] User opens the site and sees a clean, centered upload control
- [ ] User uploads an audio or video file (common formats — backend normalizes via ffmpeg)
- [ ] User picks a quality preset (Fast / Average / Slow → maps to Whisper model size) before submitting
- [ ] User can toggle diarization on/off and set speaker count (auto-detect or fixed N) in an advanced options modal
- [ ] User can pick the spoken language explicitly, or let Whisper auto-detect
- [ ] Backend transcribes the file end-to-end and returns a structured transcript (text + timestamps + speaker labels)
- [ ] Frontend shows the transcript with speakers labeled and timestamps visible
- [ ] User can rename a speaker globally (e.g., "Speaker 3" → "Maria") and apply across the whole transcript
- [ ] User can re-assign a segment from one speaker to another, with an "apply to every instance" option
- [ ] User can edit transcript text inline (fix mishears / typos)
- [ ] User can download the result as `.txt`, `.srt`, `.vtt`, and `.json` (json carries timestamps + speaker labels for re-import)
- [ ] Frontend shows progress feedback during transcription (at minimum a non-fake progress bar; ETA is nice-to-have)

**Auth & history (optional sign-in):**
- [ ] Anonymous users can transcribe and edit, no account required
- [ ] Users can sign in via Supabase auth
- [ ] Signed-in users have a "history" view of their past transcriptions
- [ ] Signed-in users can re-open a past transcript and continue editing
- [ ] Anonymous transcripts are not persisted server-side beyond the active session

**Public-URL safety (when running):**
- [ ] Per-IP rate limit on transcription submissions
- [ ] Hard cap on uploaded file size and/or duration
- [ ] Single-job queue on the backend so concurrent requests don't crash the GPU

**Operational shape:**
- [ ] Backend runs locally on the developer's machine, exposed publicly via Cloudflare Tunnel
- [ ] Frontend deploys to Vercel free tier and points at the tunneled backend URL
- [ ] Whole thing must run on $0/month recurring (Cloudflare Tunnel free, Vercel free, Supabase free, GPU is the developer's own hardware)

**Repo & delivery:**
- [ ] Frontend and backend live in this single `transcribe` repo (monorepo)
- [ ] Repo is public with a clean, readable commit history suitable for portfolio review
- [ ] Top-level README explains what it is, how it runs, and how to self-host

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Paid GPU hosting** — Hard "free" constraint; if the URL needs the dev's PC to be on, that's accepted
- **Real-time / streaming transcription** — Use case is uploaded files, not live mic/meeting capture
- **Translation** — Whisper can translate to English; out of scope for v1, transcription only
- **Multi-tenant team features** (orgs, sharing transcripts between users) — Single-user model only
- **Mobile native apps** — Web only
- **Speaker fingerprinting across files** — Diarization is per-file; "this is Maria" doesn't carry between uploads
- **Always-on availability** — The public URL only works while the host PC is awake; that's accepted
- **Transcript collaboration** (multiple editors on one transcript) — Single-editor only
- **OpenAI Whisper API as a fallback** — Adds per-minute cost; violates the free constraint
- **Custom Whisper fine-tuning / domain-adaptation** — Vanilla Whisper / WhisperX models only

## Context

- The friend's work involves consuming long audio/video deliverables; reading is much faster than listening, which is the original pain point.
- Existing transcription sites are paywalled or have crippled free tiers — that's the gap this project fills.
- The developer has already prototyped Whisper locally on their own GPU and was satisfied with quality.
- **GPU is AMD Radeon RX 6600 (8 GB VRAM) on Ubuntu 26.04 LTS** — this rules out the CUDA-based stack. Transcription runs via **whisper.cpp with the Vulkan backend** (works on AMD); diarization via **pyannote on CPU** (slower but reliable; ~5–10 min for a 90-min file).
- Public-repo + portfolio framing means: clean commits, sensible folder layout, a real README, and code that holds up to a reviewer skimming it.
- The developer can supply API keys, sample audio, Whisper docs, etc. when needed — happy to be asked.

## Constraints

- **Cost**: Zero recurring monetary cost — no paid GPU hosts, no per-minute API fees, no paid SaaS dependencies. Free tiers (Vercel, Supabase, Cloudflare) are fine.
- **Compute**: AMD Radeon RX 6600 (8 GB VRAM, RDNA2) on Ubuntu 26.04 LTS. Transcription via whisper.cpp + Vulkan; diarization via pyannote on CPU. CUDA-based engines (WhisperX, faster-whisper, ctranslate2) are NOT available on this hardware.
- **Availability**: Public URL is up only while the host PC is on — explicitly acceptable, not a bug.
- **Stack (frontend)**: Next.js + Shadcn UI + Tailwind. Locked.
- **Stack (backend)**: Python + FastAPI (orchestration) + whisper.cpp (transcription) + pyannote-audio (diarization on CPU). Locked.
- **Data layer**: Supabase (Postgres + auth + storage where useful). Locked.
- **Repo**: Single public monorepo named `transcribe` with frontend and backend side-by-side. Clean, reviewable git history.
- **Tunneling**: Cloudflare **Quick Tunnel** (`trycloudflare.com`) for v1 — accept hostname churn on tunnel restart (Vercel env var update + redeploy each time). Named tunnel + custom domain deferred until a domain is registered.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **whisper.cpp + Vulkan for transcription, pyannote on CPU for diarization** (AMD pivot) | RX 6600 is AMD/RDNA2 → no CUDA → WhisperX/faster-whisper/ctranslate2 all unavailable. whisper.cpp's Vulkan backend works on any GPU; pyannote on CPU is slower but reliable | ✓ Locked 2026-04-27 |
| Backend on local GPU + Cloudflare Quick Tunnel (`trycloudflare.com`); frontend on Vercel | Only path to "$0/month"; user has no domain yet → Quick Tunnel is the free path. Hostname churn on restart is accepted; we'll document the env-var/redeploy step | ✓ Locked 2026-04-27 |
| Optional auth (Supabase) — anonymous can transcribe; sign-in unlocks history | Lowest friction for portfolio drive-by visitors and the friend, history feature gives auth a real reason to exist | — Pending |
| Soft-gate public access (per-IP rate limit + file-size cap + single-job queue) | Public URL means strangers can hit the GPU; need basic abuse protection without forcing sign-in | — Pending |
| Editor scope = diarization fixes + inline text correction | User explicitly asked for diarization-merge UX; free-text fixes are a small extension that materially improves output quality | — Pending |
| Multi-language with auto-detect + user override | Friend's content language is open-ended; Whisper handles 99 languages, auto-detect is a one-line model arg | — Pending |
| Output formats: `.txt`, `.srt`, `.vtt`, `.json` | Covers reading, video subtitling, and re-import; "Suggest" answer + portfolio framing → ship the full set | — Pending |
| Monorepo over split repos | One portfolio artifact reads better than two; deploy paths still independent (Vercel for `frontend/`, local for `backend/`) | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-27 after initialization*
