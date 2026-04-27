# Phase 1: Foundation — Research

**Researched:** 2026-04-27
**Domain:** Greenfield monorepo scaffolding for a free, self-hostable audio/video transcription web app on AMD/Vulkan + Supabase + Vercel + Cloudflare Quick Tunnel
**Confidence:** HIGH (versions verified against npm/PyPI/GitHub on 2026-04-27; locked decisions in upstream research; remaining LOW items called out)

## Summary

Phase 1 creates a wired-but-empty `transcribe/` monorepo where every piece of secret material is gitignored from the very first commit, the Supabase schema has RLS on every public table from the first migration, a Cloudflare Quick Tunnel proxies localhost:8000 to a `*.trycloudflare.com` URL, and Vercel auto-deploys the empty Next.js frontend from `main`. None of the transcription pipeline is built here — Phase 2 picks that up. Phase 1's job is to make the workshop safe before the work starts.

Almost every architectural axis is locked by upstream research (CONTEXT/SUMMARY/ARCHITECTURE/PITFALLS): stack, monorepo shape, RLS-from-first-migration, Quick Tunnel over named tunnel for v1, no `NEXT_PUBLIC_*` service-role key, etc. This research document zooms into the **2026-current implementation details** the project-level research deferred: cloudflared install on Ubuntu 26.04 in 2026, the literal SQL migration shape that satisfies SEC-01, gitleaks vs trufflehog choice (gitleaks wins), the Vulkan+whisper.cpp dep matrix that REPO-05 must document (even though Phase 1 doesn't build it), Vercel root-directory + env-var workflow for Quick Tunnel hostname churn, and the `.env.example` shape that documents every variable both apps need.

**Primary recommendation:** Two parallel directories (`frontend/` + `backend/` + `supabase/`) at the repo root — **NO pnpm workspace, NO turborepo, NO npm package.json at the root**. The two apps share zero runtime code (one is TS via pnpm, one is Python via uv); a workspace adds tooling tax with no payoff. Vercel's "Root Directory = `frontend`" feature is purpose-built for this layout. Use the `pre-commit` framework with `gitleaks` and a small custom `gitleaks.toml` adding rules for `hf_*`, `sb_secret_*`, JWT-ish tokens, and Supabase project URLs.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Monorepo layout & directory contracts | Repo root (versioned config) | — | Lives once at repo top; no app owns it |
| Frontend scaffolding (Next.js, Tailwind, shadcn) | `frontend/` | Vercel | All web work lives here; Vercel deploys it |
| Backend scaffolding (FastAPI, uv, ruff) | `backend/` | Dev's host machine | Code lives here; runs on local GPU box |
| Database schema & RLS policies | `supabase/migrations/` | Supabase Postgres | Schema is the contract between F/E + B/E |
| Realtime publication membership | `supabase/migrations/` | Supabase Realtime | Migration declares it; Supabase enforces it |
| Secret hygiene (gitignore + scanner) | Repo root (`.gitignore`, `.pre-commit-config.yaml`) | Local pre-commit hook | Must run BEFORE the secret reaches `git commit` |
| Public exposure (Quick Tunnel) | Dev host (systemd service or wrapper script) | Cloudflare edge | Tunnel client lives on the host; CF terminates TLS |
| Hostname capture (current `*.trycloudflare.com`) | Dev host (file written by tunnel wrapper) | Local-only file | Read by dev to update Vercel env var |
| Frontend deploy automation | Vercel Git integration | GitHub | Push to `main` → Vercel builds; no GitHub Actions needed |
| Frontend env vars (incl. `NEXT_PUBLIC_BACKEND_URL`) | Vercel project settings | — | Dashboard or `vercel env`; baked at build time |
| LICENSE | Repo root | — | One file, MIT |
| Pinned dep matrix (REPO-05) | `docs/DEPENDENCIES.md` (or README section) | — | Lives in tree; updated when versions move |
| `.env.example` (REPO-04) | Repo root (combined) OR per-app | — | Combined is simpler for a 2-app monorepo |

## Standard Stack

### Core (Phase 1 only — no transcription deps yet)

| Library / Tool | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| Node.js | 22.x LTS (already installed: 22.22.1) | JS runtime for frontend tooling [VERIFIED: `node --version`] | pnpm 10 requires Node 18+; Next.js 15 requires Node 18.18+; matches Vercel default |
| pnpm | 10.33.x | Frontend package manager [VERIFIED: `npm view pnpm version` = 10.33.2 on 2026-04-27] | Symlink store, monorepo-friendly, fast; Vercel auto-detects from `package.json#packageManager` |
| Next.js | 15.x (latest 16.2.4 also works) | Frontend framework [VERIFIED: `npm view next version` = 16.2.4] | Locked by STATE.md; Phase 1 ships an empty App Router app to confirm Vercel deploy works. **Note:** STATE/PROJECT.md says "Next.js 15"; 16 is now out — confirm with user whether to pin 15.x or move to 16 (see Open Questions) |
| TypeScript | 5.6+ | Type system | Locked in STATE.md |
| Tailwind CSS | 4.x | Styling | Locked in STATE.md |
| shadcn/ui | latest | Headless UI primitives | Locked; vendored not packaged |
| Python | 3.11.x (pin via `.python-version`) | Backend runtime [CITED: pyannote ≥3.3.2 + whisper.cpp Python bindings tested on 3.11; 3.13 untested] | Locked in STATE.md / SUMMARY.md |
| uv | 0.11.7 [VERIFIED: PyPI on 2026-04-27] | Python env + lockfile manager | Locked; auto-installs Python 3.11 via `.python-version` |
| FastAPI | 0.136.x [VERIFIED: PyPI on 2026-04-27] | Backend HTTP framework | Locked. STATE.md says "≥0.115" — 0.136 is current stable |
| uvicorn | 0.46.x [VERIFIED: PyPI on 2026-04-27] | ASGI server | Standard for FastAPI |
| pydantic-settings | 2.14.x [VERIFIED: PyPI on 2026-04-27] | Env-var loading | Standard for FastAPI 12-factor config |
| ruff | 0.15.x [VERIFIED: PyPI on 2026-04-27] | Linter + formatter | Locked in STATE.md; replaces black + isort + flake8 |
| pytest + pytest-asyncio + asgi-lifespan | latest | Backend tests | Locked in STATE.md; lifespan-aware testing |
| Supabase CLI | 2.90.0 [VERIFIED: GitHub releases redirect on 2026-04-27] | DB migrations + (optional) local stack | One installable binary; required for `supabase migration new`, `supabase db push` |
| `cloudflared` | 2026.3.0 [VERIFIED: GitHub releases redirect on 2026-04-27] | Cloudflare Tunnel client | Required for OPS-03 |
| gitleaks | 8.30.1 [VERIFIED: GitHub releases redirect on 2026-04-27] | Secret scanner (pre-commit + CI) | Industry default for pre-commit secret blocking [CITED: AppSecSanta 2026 comparison, Rafter benchmark] |
| pre-commit | latest (Python tool) | Hook framework | Standard wrapper around gitleaks/ruff hooks |

### Supporting (Phase 1 only)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vercel CLI | latest (`pnpm dlx vercel@latest`) | Optional: local `vercel link` + `vercel env` from CLI | If dev prefers CLI to dashboard for env-var updates |
| GitHub CLI (`gh`) | latest | Convenience for repo creation + Vercel link | Optional |
| `npm view` | n/a | Version verification only | When updating REPO-05 matrix |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain `frontend/` + `backend/` dirs | pnpm workspace at root | Workspace shines when sharing TS code between packages; here both apps are different languages — workspace = pure overhead [VERIFIED: ARCHITECTURE.md "Structure Rationale"] |
| pnpm workspace alone | + Turborepo | Turbo helps when 5+ packages need build orchestration & caching; 2 apps = no payoff [CITED: PkgPulse 2026, "Turborepo… 80% of value with 20% of complexity" — at 5+ packages] |
| pnpm workspace alone | + Nx | Nx is for enterprise polyglot repos with code generators; 2 apps = vast overkill |
| gitleaks | trufflehog | Trufflehog's killer feature is verification (live-API check) which adds network overhead; gitleaks is faster + simpler for pre-commit blocking [CITED: AppSecSanta 2026 comparison]. Use trufflehog for periodic full-history sweeps later (out of Phase 1 scope) |
| gitleaks | detect-secrets | detect-secrets shines for legacy codebases with existing leaked secrets (baseline file); we are greenfield → gitleaks fits better |
| Cloudflare Quick Tunnel | Named tunnel + custom domain | Named tunnel needs a registered domain (~$10/year); user has none. Locked in PROJECT.md |
| `cloudflared` via `apt` | binary download from GitHub | Apt repo gives auto-updates and cleaner uninstall; binary works but is manual. Apt repo is the official path on Ubuntu/Debian [CITED: pkg.cloudflare.com] |
| Combined `.env.example` at repo root | Per-app `frontend/.env.local.example` + `backend/.env.example` | Combined is simpler for a 2-app monorepo and matches REPO-04's wording ("env vars for both"); per-app matches each tool's expected location. **Recommended: do BOTH** — root file is canonical, per-app files are copies / pointers (see "Code Examples") |
| pyannote on CPU | Replace with NeMo, WhisperKit, etc. | Locked in SUMMARY.md amendment 2026-04-27. Out of scope to relitigate. |

### Installation (Phase 1 setup commands)

```bash
# pnpm via corepack (already installed via Node 22)
corepack enable
corepack prepare pnpm@10.33.2 --activate

# uv (Python tooling)
curl -LsSf https://astral.sh/uv/install.sh | sh

# cloudflared (Ubuntu 26.04 — official apt repo)
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
# NOTE: pkg.cloudflare.com officially supports up to 'noble' (24.04). Use 'noble' as a stable
# fallback for 26.04 'resolute' since the deb is statically linked Go.
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared noble main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared

# Supabase CLI (download .deb from GitHub releases — npm global install is unsupported)
# Find latest at https://github.com/supabase/cli/releases
SUPABASE_VERSION=2.90.0
curl -fsSL "https://github.com/supabase/cli/releases/download/v${SUPABASE_VERSION}/supabase_${SUPABASE_VERSION}_linux_amd64.deb" -o /tmp/supabase.deb
sudo dpkg -i /tmp/supabase.deb && rm /tmp/supabase.deb

# gitleaks (binary from GitHub releases)
GITLEAKS_VERSION=8.30.1
curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" | sudo tar -xz -C /usr/local/bin gitleaks

# pre-commit framework (via uv tool — no global pip needed)
uv tool install pre-commit
```

**Version verification:** All versions above verified against the registry / GitHub releases on 2026-04-27. Re-run `npm view <pkg> version` and `curl -sI https://github.com/<org>/<repo>/releases/latest | grep location` before pinning REPO-05 in case anything moved.

## Architecture Patterns

### System Architecture Diagram (Phase 1 deliverable surface)

```
                                   ┌──────────────────┐
                                   │  GitHub repo     │
                                   │  (this repo)     │
                                   │  branch: main    │
                                   └────────┬─────────┘
                                            │ git push origin main
              ┌─────────────────────────────┼─────────────────────────────┐
              │                             │                             │
              │  pre-commit hook (local)    │                             │
              │  - gitleaks scan staged     │                             │
              │  - ruff format/lint         │                             │
              │  - prettier (frontend)      │                             │
              │  blocks commit on hit       │                             │
              │                             ▼                             │
              │                  ┌──────────────────┐                     │
              │                  │   Vercel Git     │                     │
              │                  │   integration    │                     │
              │                  │  Root: frontend/ │                     │
              │                  └────────┬─────────┘                     │
              │                           │ pnpm install + next build     │
              │                           ▼                               │
              │                  ┌──────────────────┐                     │
              │                  │  Vercel deploy   │                     │
              │                  │  (empty Next.js) │                     │
              │                  │  reads env vars  │                     │
              │                  └────────┬─────────┘                     │
              │                           │ HTTPS                         │
              │                           ▼                               │
              │                       (browser)                           │
              │                           │ NEXT_PUBLIC_BACKEND_URL       │
              │                           │ (currently a *.trycloudflare) │
              │                           ▼                               │
              │                  ┌──────────────────┐                     │
              │                  │ Cloudflare edge  │                     │
              │                  │ (Quick Tunnel)   │                     │
              │                  └────────┬─────────┘                     │
              │                           │ outbound-only TCP from host   │
              │                           ▼                               │
              │  ┌────────────────────────────────────────────────┐       │
              │  │  Dev host machine (Ubuntu 26.04)               │       │
              │  │  - cloudflared (systemd user service)          │       │
              │  │     writes current URL → ~/.transcribe/        │       │
              │  │     tunnel-url (gitignored)                    │       │
              │  │  - FastAPI on 127.0.0.1:8000  (Phase 2)        │       │
              │  └────────────────────────────────────────────────┘       │
              │                                                           │
              │                       (browser, frontend & backend code)  │
              │                              │                            │
              │                              ▼                            │
              │  ┌────────────────────────────────────────────────┐       │
              │  │  Supabase project (free tier)                  │       │
              │  │  - Postgres (jobs, transcripts) — RLS ENABLED  │       │
              │  │  - publication supabase_realtime (jobs+trans.) │       │
              │  │  - Auth (Phase 4 wires it)                     │       │
              │  └────────────────────────────────────────────────┘       │
              │                              ▲                            │
              │                              │ supabase db push (manual)  │
              │                              │                            │
              │                  ┌──────────────────┐                     │
              │                  │ supabase/        │                     │
              │                  │ migrations/      │                     │
              │                  │ (in this repo)   │                     │
              │                  └──────────────────┘                     │
              └───────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
transcribe/                         # repo root
├── README.md                       # Phase 6 polishes; stub here
├── LICENSE                         # MIT (REPO-03)
├── .gitignore                      # already exists; extended in Phase 1
├── .env.example                    # combined for both apps (REPO-04)
├── .pre-commit-config.yaml         # gitleaks + ruff + prettier (SEC-05)
├── gitleaks.toml                   # custom rules for HF_*, sb_secret_*, etc.
├── .editorconfig                   # consistent whitespace across tools
├── docs/
│   └── DEPENDENCIES.md             # pinned dep matrix (REPO-05)
│
├── frontend/                       # Vercel root directory
│   ├── package.json                # name=transcribe-frontend, packageManager pin
│   ├── pnpm-lock.yaml              # committed
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── .env.local.example          # symlink or copy of relevant lines from root
│   ├── public/
│   ├── app/
│   │   ├── layout.tsx
│   │   └── page.tsx                # "Transcribe — Phase 1 alive" placeholder
│   └── lib/
│       └── env.ts                  # type-safe NEXT_PUBLIC_* + server env reader
│
├── backend/                        # uv project root
│   ├── pyproject.toml              # name=transcribe-backend, requires-python=">=3.11,<3.12"
│   ├── uv.lock                     # committed
│   ├── .python-version             # "3.11"
│   ├── .env.example                # symlink or copy of relevant lines from root
│   ├── README.md                   # how to run on the host machine
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                 # FastAPI() with /healthz only (Phase 2 fills it)
│   │   └── config.py               # pydantic-settings reading env vars
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── conftest.py
│   │   └── test_health.py          # asserts /healthz 200; first sanity test
│   └── scripts/
│       ├── tunnel.sh               # wraps cloudflared, captures URL
│       └── verify_env.py           # script for the validation gate
│
├── supabase/
│   ├── config.toml                 # `supabase init` output
│   ├── .gitignore                  # excludes .branches/, .temp/
│   └── migrations/
│       ├── 20260427000001_jobs_with_rls.sql
│       ├── 20260427000002_transcripts_with_rls.sql
│       └── 20260427000003_realtime_publication.sql
│
└── .planning/                      # GSD artifacts; already exists; not gitignored
```

### Pattern 1: Two-Apps-One-Repo (no workspace)

**What:** Sibling top-level dirs `frontend/` (its own pnpm project) and `backend/` (its own uv project). Each owns its lockfile, deps, and run commands. No `package.json` at the root. No `pnpm-workspace.yaml`. Vercel's Root Directory feature points at `frontend/`.
**When:** Two apps in different ecosystems (TS + Python) with no shared runtime code.
**Source:** ARCHITECTURE.md "Structure Rationale" + Vercel monorepo docs ([CITED: vercel.com/docs/monorepos]).

```
transcribe/
├── frontend/   # pnpm-managed; Vercel root directory
└── backend/    # uv-managed; runs on dev's host
```

### Pattern 2: RLS-from-First-Migration

**What:** Every `CREATE TABLE` in `supabase/migrations/` is followed in the **same file** by `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and by at least one explicit policy (or an explicit comment that no policies = deny-all is intentional). This is the only known prevention for the Lovable-incident class of leak [CITED: PITFALLS Pitfall 11; Supabase RLS docs].
**When:** Every public-schema table, always.

```sql
-- supabase/migrations/20260427000001_jobs_with_rls.sql
-- Phase 1 SEC-01: RLS is enabled in the SAME migration as table creation.

create extension if not exists "pgcrypto";

create table public.jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade,  -- nullable for anon
  anon_token          text,                                               -- random per-job for anon RLS
  storage_key         text,                                               -- nullable in v1 (TUS direct to FastAPI)
  source_filename     text not null,
  options             jsonb not null default '{}'::jsonb,
  status              text not null default 'queued'
                       check (status in ('queued','running','succeeded','failed','cancelled')),
  progress            smallint not null default 0
                       check (progress between 0 and 100),
  stage               text,
  error               text,
  transcript_payload  jsonb,                                              -- anon: held here; signed-in: also written to transcripts
  transcript_id       uuid,                                               -- FK added in transcripts migration
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz
);
create index jobs_status_created_idx on public.jobs (status, created_at);
create index jobs_user_idx on public.jobs (user_id) where user_id is not null;

-- SEC-01: enable RLS on the very same migration
alter table public.jobs enable row level security;

-- Default deny-all: no SELECT/INSERT/UPDATE/DELETE policies for clients.
-- The FastAPI service-role key bypasses RLS for backend writes.
-- Phase 4 will ADD targeted SELECT policies for signed-in users (auth.uid() = user_id)
-- and for anon users via X-Anon-Token header.
-- For Phase 1, "deny everything" is the correct posture.

comment on table public.jobs is
  'Phase 1: RLS enabled, no policies = full deny. Phase 4 adds owner + anon-token policies.';
```

```sql
-- supabase/migrations/20260427000002_transcripts_with_rls.sql
create table public.transcripts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  source_filename text not null,
  duration_sec    integer,
  language        text,
  model_used      text,
  diarized        boolean not null default false,
  payload         jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index transcripts_user_created_idx
  on public.transcripts (user_id, created_at desc);

alter table public.transcripts enable row level security;

-- Now wire the FK from jobs.transcript_id → transcripts.id
alter table public.jobs
  add constraint jobs_transcript_fk
  foreign key (transcript_id) references public.transcripts(id) on delete set null;

comment on table public.transcripts is
  'Phase 1: RLS enabled, no policies = full deny. Phase 4 adds owner-only policies.';
```

```sql
-- supabase/migrations/20260427000003_realtime_publication.sql
-- Add both tables to the supabase_realtime publication so Postgres Changes
-- broadcast to subscribed browsers (PROG-03 in Phase 2/3).
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.transcripts;
```

**Key insight:** Splitting "create table" and "enable RLS" across migrations is the bug pattern that produced the Lovable incident — the window between migrations leaves the table publicly accessible via the anon key. **One file per table, RLS in the same file, every time.** [CITED: byteiota.com/supabase-security-flaw-170-apps-exposed-by-missing-rls/]

### Pattern 3: Quick Tunnel With Hostname Capture

**What:** Run `cloudflared tunnel --url http://localhost:8000` as a backgrounded process; pipe stdout through `tee` and a small parser that extracts the `https://*.trycloudflare.com` URL into a known file. The dev (or a script) reads that file when updating Vercel.

**Source:** Cloudflare One docs [CITED: developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/]; URL is printed to stderr.

```bash
#!/usr/bin/env bash
# backend/scripts/tunnel.sh
set -euo pipefail

TUNNEL_LOG="${HOME}/.transcribe/tunnel.log"
TUNNEL_URL_FILE="${HOME}/.transcribe/tunnel-url"
mkdir -p "$(dirname "$TUNNEL_LOG")"

# cloudflared writes the URL to stderr like:
#   |  https://random-words.trycloudflare.com                    |
# Capture both streams; tee to log; parse out the URL.
cloudflared tunnel --url http://localhost:8000 --no-autoupdate 2>&1 \
  | tee "$TUNNEL_LOG" \
  | while IFS= read -r line; do
      echo "$line"
      if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
        echo "${BASH_REMATCH[1]}" > "$TUNNEL_URL_FILE"
        echo "[tunnel.sh] captured URL → $TUNNEL_URL_FILE"
      fi
    done
```

**Critical Quick Tunnel constraints (REVISED in this research, MUST be respected):**
- 200 in-flight request limit; over-limit returns 429 [CITED: developers.cloudflare.com Quick Tunnels docs]
- **Quick Tunnels do NOT support Server-Sent Events** — confirms the locked decision to use Supabase Realtime for progress (cloudflared #1449) [CITED: github.com/cloudflare/cloudflared/issues/1449]
- Quick Tunnels do **NOT** read `~/.cloudflared/config.yml` — if a config file exists there, the quick-tunnel command refuses to start [CITED: developers.cloudflare.com/.../trycloudflare/]
- Hostname rotates on every restart — captured-URL file is gitignored; dev manually updates Vercel after each restart (OPS-03 documented workflow)

**Optional systemd user service** for auto-start (capture-aware version):

```ini
# ~/.config/systemd/user/transcribe-tunnel.service
[Unit]
Description=Transcribe Cloudflare Quick Tunnel
After=network-online.target

[Service]
Type=simple
ExecStart=%h/Code/transcribe/backend/scripts/tunnel.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Enable with `systemctl --user enable --now transcribe-tunnel.service`.

### Pattern 4: gitleaks via pre-commit Framework + Custom TOML

**What:** Use the `pre-commit` framework (the Python tool) with the upstream `gitleaks` hook plus a project-local `gitleaks.toml` that adds custom rules for the specific high-entropy strings this project handles.

**Source:** gitleaks docs [CITED: github.com/gitleaks/gitleaks].

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.30.1
    hooks:
      - id: gitleaks
        args: ["--config=gitleaks.toml"]

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.15.12
    hooks:
      - id: ruff-format
        files: ^backend/
      - id: ruff-check
        args: ["--fix"]
        files: ^backend/

  - repo: https://github.com/pre-commit/mirrors-prettier
    rev: v4.0.0-alpha.8
    hooks:
      - id: prettier
        files: ^frontend/
        types_or: [javascript, jsx, ts, tsx, css, json, markdown]
```

```toml
# gitleaks.toml — extends defaults, adds project-specific rules
[extend]
useDefault = true

[[rules]]
id = "huggingface-token"
description = "Hugging Face access token (hf_...)"
regex = '''hf_[A-Za-z0-9]{34,}'''
tags = ["huggingface", "token"]

[[rules]]
id = "supabase-secret-key"
description = "Supabase secret-key key (sb_secret_...)"
regex = '''sb_secret_[A-Za-z0-9]{32,}'''
tags = ["supabase", "secret"]

[[rules]]
id = "supabase-publishable-key"
description = "Supabase publishable key (sb_publishable_...) — flag in case it ends up somewhere unexpected"
regex = '''sb_publishable_[A-Za-z0-9]{32,}'''
tags = ["supabase", "publishable"]

[[rules]]
id = "supabase-legacy-jwt"
description = "Legacy Supabase service-role / anon key (3-segment JWT starting with eyJ...)"
regex = '''eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'''
tags = ["jwt", "supabase"]

[[rules]]
id = "supabase-project-url"
description = "Supabase project URL (helps catch *.supabase.co references in committed configs)"
regex = '''https?://[a-z0-9]{20}\.supabase\.co'''
tags = ["supabase", "url"]

[[rules]]
id = "cloudflare-api-token"
description = "Cloudflare API token"
regex = '''[A-Za-z0-9_-]{40}'''
secretGroup = 0
entropy = 4.0
tags = ["cloudflare", "token"]
# Note: Cloudflare tokens are 40 chars of arbitrary alphabet — high false-positive rate.
# Enable only if user accepts the noise; consider keyword-anchored rule instead.

[allowlist]
description = "Allow placeholders in .env.example"
paths = [
  '''\.env\.example$''',
  '''gitleaks\.toml$''',  # don't scan our own rules file
]
```

**Notes on the rules above:**
- `hf_*` — verified format from HF docs (34+ alphanumeric chars after the prefix)
- `sb_secret_*` and `sb_publishable_*` — Supabase's new key format (the user has both, per PROJECT.md)
- The legacy JWT `eyJ...` rule catches any 3-segment JWT — broad but rarely false-positives in source repos
- Cloudflare tokens have no fixed prefix — enable cautiously
- gitleaks default rules already catch AWS, Stripe, GitHub, GCP, Slack, etc. — `useDefault = true` keeps them all

### Pattern 5: `.env.example` shape

**What:** A single `.env.example` at repo root that documents every variable, grouped by which app reads it. Per-app symlinks (or copies) so `pnpm dev` and `uv run` find their respective `.env.local` and `.env`.

```bash
# .env.example
# ────────────────────────────────────────────────────────────────────
# Transcribe — environment variables
#
# Copy this file to .env at repo root, fill in real values, then:
#   ln -sf $(pwd)/.env frontend/.env.local
#   ln -sf $(pwd)/.env backend/.env
# (or maintain per-app .env files separately if you prefer)
#
# .env* is gitignored; this .env.example is the only env file in git.
# ────────────────────────────────────────────────────────────────────

# ── Supabase (both apps) ──────────────────────────────────────────────
# From your Supabase project's API Settings page.
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co  # frontend mirror — same value as SUPABASE_URL

# Publishable / anon key — safe to expose in NEXT_PUBLIC_*.
# Looks like: sb_publishable_...  or legacy eyJ...
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Secret / service-role key — NEVER put this in NEXT_PUBLIC_*, NEVER ship to Vercel.
# This belongs ONLY on the backend host (FastAPI machine).
# Looks like: sb_secret_...  or legacy eyJ...
SUPABASE_SERVICE_ROLE_KEY=

# Direct Postgres connection (backend only — used by `supabase db push` and any
# direct-connection SQL ops). Get from Supabase → Database → Connection string → "URI".
# Format: postgresql://postgres:[PASSWORD]@db.YOUR_PROJECT_REF.supabase.co:5432/postgres
SUPABASE_DB_URL=

# ── Hugging Face (backend only — Phase 2 onward) ──────────────────────
# Required by pyannote.audio for diarization model download.
# YOU MUST also visit and accept the licenses on:
#   https://huggingface.co/pyannote/segmentation-3.0
#   https://huggingface.co/pyannote/speaker-diarization-3.1
# while signed in with the same HF account that owns this token, or downloads return 403.
# Token format: hf_<34+ chars>
HF_TOKEN=

# ── whisper.cpp model files (backend only — Phase 2 onward) ───────────
# Absolute path to the GGUF model that whisper-cli loads at startup.
# Recommended starter: ggml-medium.bin or ggml-large-v3-turbo.bin (download from
#   https://huggingface.co/ggerganov/whisper.cpp).
# Pin SHA-256 in docs/DEPENDENCIES.md for reproducibility.
WHISPER_MODEL_PATH=/home/YOUR_USER/Code/transcribe/backend/models/ggml-medium.bin

# Path to the whisper.cpp build directory (so the backend can invoke whisper-cli).
# Phase 2 will set this; Phase 1 just documents it.
WHISPER_CPP_BUILD_DIR=/home/YOUR_USER/Code/whisper.cpp/build

# ── Backend HTTP / tunnel (backend only) ──────────────────────────────
BACKEND_HOST=127.0.0.1   # bind to localhost only — cloudflared connects here
BACKEND_PORT=8000

# ── Frontend → Backend wiring ─────────────────────────────────────────
# Update this AFTER each `cloudflared tunnel --url http://localhost:8000` restart.
# The current value is captured in ~/.transcribe/tunnel-url by scripts/tunnel.sh.
# Then run:  vercel env rm NEXT_PUBLIC_BACKEND_URL production
#            vercel env add NEXT_PUBLIC_BACKEND_URL production
#            vercel redeploy --target production
NEXT_PUBLIC_BACKEND_URL=https://CHANGES-EVERY-RESTART.trycloudflare.com

# ── Local dev only ────────────────────────────────────────────────────
NODE_ENV=development
LOG_LEVEL=info
```

**Comment style:** Section dividers with Unicode box-drawing keep `.env.example` skim-friendly. Each variable gets a one-line "what it is" + "where to get it" hint. Critical security notes (e.g., "NEVER put this in NEXT_PUBLIC_*") use ALL-CAPS for emphasis.

### Pattern 6: Vercel Project Setup with Root Directory + Env Vars

**What:** Vercel reads the repo, but the Next.js app lives at `frontend/`. Set "Root Directory = frontend" in the Vercel project settings. Vercel then runs `pnpm install` and `next build` inside that directory only.

**Source:** Vercel monorepo docs [CITED: vercel.com/docs/monorepos]; "Help needed: Configuring root directory" [CITED: community.vercel.com/t/help-needed-configuring-root-directory/7436].

**Recommended setup flow (one-time, dashboard or CLI):**

```bash
# Option A — CLI (recommended; can be re-run):
cd /home/arthur/Code/transcribe/frontend
pnpm dlx vercel@latest link              # creates .vercel/project.json (gitignored)
pnpm dlx vercel@latest env add NEXT_PUBLIC_SUPABASE_URL production
pnpm dlx vercel@latest env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
pnpm dlx vercel@latest env add NEXT_PUBLIC_BACKEND_URL production
pnpm dlx vercel@latest --prod            # first prod deploy

# Option B — Dashboard:
#   Project Settings → General → Root Directory = "frontend"
#   Project Settings → Environment Variables → add NEXT_PUBLIC_*
#   Connect GitHub repo → enable "Auto-deploy on push to main"
```

**Quick Tunnel hostname rotation workflow** (OPS-03 deliverable):

```bash
# After each `cloudflared tunnel --url ...` restart:
NEW_URL=$(cat ~/.transcribe/tunnel-url)
cd /home/arthur/Code/transcribe/frontend
pnpm dlx vercel@latest env rm NEXT_PUBLIC_BACKEND_URL production --yes
echo "$NEW_URL" | pnpm dlx vercel@latest env add NEXT_PUBLIC_BACKEND_URL production
pnpm dlx vercel@latest redeploy --target production
```

**Critical:** `NEXT_PUBLIC_*` values are inlined into the JS bundle at **build time** [CITED: github.com/vercel/next.js/discussions/87229]. There is no way to make `NEXT_PUBLIC_BACKEND_URL` "live" without redeploy. The runtime-injection workaround (read on the server, push into a `<script>` tag) exists but is not justified for v1 — the documented redeploy step is fine for portfolio scope.

### Pattern 7: `uv` Project Layout for FastAPI

**What:** `uv init --package backend` produces a clean Python project with `pyproject.toml`, `.python-version`, and `app/`-style layout. Pin Python 3.11 via `.python-version` AND `requires-python` AND `[tool.uv].python` for belt-and-suspenders.

**Source:** Astral uv docs [CITED: docs.astral.sh/uv/guides/integration/fastapi/].

```toml
# backend/pyproject.toml
[project]
name = "transcribe-backend"
version = "0.1.0"
description = "FastAPI backend for the Transcribe app — runs whisper.cpp + pyannote on the dev's GPU host"
readme = "README.md"
requires-python = ">=3.11,<3.12"
dependencies = [
    "fastapi[standard]>=0.136.0",
    "pydantic-settings>=2.14.0",
    # Phase 2 will add: pyannote.audio, supabase, slowapi, etc.
]

[dependency-groups]
dev = [
    "pytest>=8.4",
    "pytest-asyncio>=0.24",
    "asgi-lifespan>=2.1",
    "httpx>=0.28",  # for ASGI test client
    "ruff>=0.15.12",
]

[tool.uv]
# Pin Python 3.11 specifically — uv will download it if missing.
python = "3.11"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "UP", "B", "SIM", "RUF"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

```
# backend/.python-version
3.11
```

**Why both pin sites:** `.python-version` is read by `uv` and by `pyenv` if installed; `requires-python` is enforced at install time and surfaced in `uv.lock`; `[tool.uv].python` makes `uv sync` always pick 3.11 without needing the `.python-version` file. Three pins, one truth.

### Anti-Patterns to Avoid (Phase 1 specific)

- **Single root `package.json` to "tie things together"** — Pulls Vercel into ambiguous build behavior; conflicts with `pnpm-workspace.yaml`; offers no real benefit for two-app cases. Don't.
- **`supabase init` writing to repo root** — Creates a `.gitignore` that conflicts with the existing one and a top-level `supabase` directory. Verify the layout post-init; merge `.gitignore` lines manually, do not let `supabase init` overwrite the existing one.
- **Splitting `CREATE TABLE` and `ENABLE ROW LEVEL SECURITY` across migrations** — Same as Lovable. One file per table, both statements together.
- **Keeping a `~/.cloudflared/config.yml` while running Quick Tunnels** — Quick Tunnels refuse to start if a config file exists [CITED: developers.cloudflare.com/.../trycloudflare/]. If named tunnels were ever set up before on this host, move the config aside.
- **Adding a turbo.json in Phase 1** — Adds a build-orchestration tool we don't need; signals over-engineering on a portfolio repo. Add when (if) a third app appears.
- **Running gitleaks ONLY in CI, not pre-commit** — A leaked secret blocked at CI is already in the Git tree on a feature branch; rotation is still required. Pre-commit is the only place to actually prevent the leak.
- **Letting Vercel auto-detect the framework root** — In a monorepo, "I detected Next.js" + "no Root Directory set" produces unpredictable build behavior. Always explicitly set Root Directory = `frontend`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pre-commit hook framework | A custom `.git/hooks/pre-commit` shell script | `pre-commit` framework + `gitleaks` hook | Standard, version-pinned, recoverable on every clone via `pre-commit install` |
| Secret pattern matching | Hand-written grep regexes | `gitleaks` | 150+ default rules, entropy detection, allowlists, well-tested edge cases |
| Cloudflare Tunnel client | Custom SSH/ngrok-style tunneling | `cloudflared` | Official Cloudflare client; only path that gives free TLS + DDoS edge |
| Postgres migrations runner | Hand-written SQL apply scripts | `supabase` CLI | Manages migration ordering, schema_migrations table, remote sync |
| Python env management | venv + pip + requirements.txt | `uv` | Locked in STATE.md; faster, lockfile-native, manages Python versions |
| Frontend build pipeline | Custom webpack/esbuild config | `next build` (Vercel-native) | Vercel auto-detects and runs it |
| Frontend deploy script | Custom GitHub Actions workflow | Vercel Git integration | Free, zero-config, preview deploys included |
| Pinned Python version probe | Hand-written check | `.python-version` file (uv reads it) | One mechanism, three integration points |
| Stack version checking | `cat package.json | jq` scripts | `npm view <pkg> version` + `pip show` / `uv tree` | Standard tools; no glue code |

**Key insight:** Phase 1 is a scaffolding phase — every "should I script this myself?" temptation is the wrong answer. Use the boring, official tooling for each concern.

## Runtime State Inventory

> **Skipped — this is a greenfield phase.** No existing data, no live services, no OS-registered state, no installed packages to migrate. The only "stored state" is the gitignored input files at repo root (`hf_token`, `gpu`, `supabase`, `ubuntu_version`) which are read once during Phase 1 to populate `.env.example` placeholders and may be deleted after.

## Common Pitfalls

### Pitfall 1: RLS off because someone wrote a "create table" migration without RLS
**What goes wrong:** Public-anon-key-readable production tables. The Lovable incident in early 2025 exposed 170+ apps via this exact mistake [CITED: byteiota.com/supabase-security-flaw-170-apps-exposed-by-missing-rls/].
**Why it happens:** RLS is OFF by default for tables created via SQL migrations (only the dashboard Table Editor enables it automatically) [CITED: supabase.com/docs/guides/database/postgres/row-level-security].
**How to avoid:** Convention enforced by validation: every public table migration must include `ENABLE ROW LEVEL SECURITY` in the same file; Phase 5 adds a CI gate for this (SEC-02). Phase 1 enforces it manually + documents the convention in CLAUDE.md.
**Warning signs:** Supabase dashboard's RLS linter flags `rls_disabled_in_public`; manual SQL probe `select count(*) from pg_tables where schemaname='public' and rowsecurity=false` returns > 0.

### Pitfall 2: Quick Tunnel + a stale `~/.cloudflared/config.yml`
**What goes wrong:** `cloudflared tunnel --url http://localhost:8000` errors immediately with a confusing config-not-allowed message.
**Why it happens:** Quick Tunnels are mutually exclusive with named-tunnel config files [CITED: developers.cloudflare.com/.../trycloudflare/].
**How to avoid:** Phase 1 setup script checks `~/.cloudflared/config.yml`; if present, prompts dev to move it aside (`mv ~/.cloudflared/config.yml ~/.cloudflared/config.yml.bak`).
**Warning signs:** `cloudflared` exits within ~1 second on first run on a host that previously ran a named tunnel.

### Pitfall 3: `.env` slipping in via a tool that doesn't respect `.gitignore`
**What goes wrong:** `vercel link` writes `.vercel/` (which contains the project ID, OK to share, BUT can drift). `supabase login` writes credentials to `~/.supabase/`. Pre-existing files at repo root (`hf_token`, `supabase`, etc.) are protected by current `.gitignore` — but a future `cp supabase frontend/secrets.json` is not.
**Why it happens:** Devs assume `.gitignore` covers "anything sensitive."
**How to avoid:** (a) `.gitignore` already protects the four input files; (b) gitleaks pre-commit catches the contents even if the path is allowed; (c) `.gitignore` adds `.vercel/` (Vercel CLI artifact) and `.supabase/` (CLI cache).
**Warning signs:** `git status` shows new files in `.vercel/`, `.supabase/`, or any non-tracked directory after running official tooling.

### Pitfall 4: `NEXT_PUBLIC_BACKEND_URL` baked at build time, can't update without redeploy
**What goes wrong:** Dev restarts the tunnel, gets a new `*.trycloudflare.com` URL, updates the Vercel env var, but the live site keeps using the old URL.
**Why it happens:** `NEXT_PUBLIC_*` is a literal-string substitution at `next build` time [CITED: github.com/vercel/next.js/discussions/87229]. Setting the env var only affects the **next** build.
**How to avoid:** README + CLAUDE.md document the workflow: tunnel restart → `vercel env rm` + `vercel env add` + `vercel redeploy --target production`. Three commands, one minute. Accept this cost; it's why the user picked Quick Tunnel as v1 and named-tunnel as v2.
**Warning signs:** Browser network tab shows requests going to a `*.trycloudflare.com` URL that no longer resolves.

### Pitfall 5: Vercel "framework not detected" on monorepo
**What goes wrong:** Vercel imports the repo, sees no top-level `package.json`, refuses to deploy with "No Next.js version detected."
**Why it happens:** Vercel's Root Directory defaults to repo root; without an explicit setting, monorepo apps are invisible [CITED: community.vercel.com/t/vercel-no-next-js-version-detected-for-next-js-app-in-pnpm-monorepo/18750].
**How to avoid:** Set Root Directory = `frontend` BEFORE the first deploy. If using CLI: `vercel link` from inside `frontend/` and accept the prompt to scope this Vercel project to that subdirectory.
**Warning signs:** Build log immediately fails with framework-detection error; first deploy never produces a URL.

### Pitfall 6: Vulkan dep matrix wrong even though Phase 1 doesn't compile whisper.cpp
**What goes wrong:** REPO-05 ships with CUDA-era pins (cuDNN 9, ctranslate2 4.5+), Phase 2 tries to follow them, hits AMD-incompatibility wall.
**Why it happens:** REQUIREMENTS.md REPO-05 was written before the AMD pivot and still mentions "CUDA / cuDNN / torch / ctranslate2" — the pivot supersedes those, but REPO-05 hasn't been textually updated yet (per the question's parenthetical "REVISED").
**How to avoid:** Phase 1 plans must explicitly write the **post-pivot** matrix: whisper.cpp build flags + Vulkan SDK packages + pyannote (CPU) + Python 3.11 + Node 22. The bracket-CUDA list is REPLACED, not extended. (See "Vulkan Stack Matrix for REPO-05" section below.)
**Warning signs:** Phase 2 plan tries to `pip install ctranslate2`.

### Pitfall 7: `supabase db push` failing because direct-connection password isn't separate from API password
**What goes wrong:** `supabase db push` prompts for the database password, dev pastes the service-role key, fails with auth error.
**Why it happens:** The Postgres direct-connection password is a separate secret (in Project Settings → Database) from the anon/service-role API keys. Many devs conflate them on first encounter.
**How to avoid:** `.env.example` notes that `SUPABASE_DB_URL` already embeds the password (the connection string from the dashboard); calling `supabase db push --db-url "$SUPABASE_DB_URL"` skips the prompt entirely [CITED: supabase.com/docs/guides/database/connecting-to-postgres].
**Warning signs:** Repeated "password authentication failed for user 'postgres'" on `supabase db push`.

### Pitfall 8: pre-commit hooks "succeed" silently because they were never installed
**What goes wrong:** Dev creates `.pre-commit-config.yaml`, commits it, never runs `pre-commit install`, secrets sail through.
**Why it happens:** `.pre-commit-config.yaml` is a config file, not an active hook. The `pre-commit install` command writes the actual `.git/hooks/pre-commit` script.
**How to avoid:** Phase 1 plan includes `pre-commit install` as an explicit task; the validation gate for SEC-05 attempts a real "commit a fake secret" test (in a throwaway branch) and asserts the commit is blocked.
**Warning signs:** `git commit` runs with no output from gitleaks; `.git/hooks/pre-commit` does not exist or is the default sample.

## Code Examples

Verified patterns assembled from official sources cited above.

### Operation: Initialize Supabase project locally + first migration

```bash
cd /home/arthur/Code/transcribe
supabase init                      # creates supabase/config.toml + supabase/.gitignore

# Create the three migrations with timestamped filenames (CLI generates the timestamp)
supabase migration new jobs_with_rls
supabase migration new transcripts_with_rls
supabase migration new realtime_publication

# Edit each generated file under supabase/migrations/ to contain the SQL from Pattern 2 above

# Push to the remote project (requires SUPABASE_DB_URL in .env)
supabase db push --db-url "$SUPABASE_DB_URL"

# Verify RLS is on (manual probe; Phase 5 adds CI for this)
psql "$SUPABASE_DB_URL" -c "select schemaname, tablename, rowsecurity from pg_tables where schemaname='public';"
# expected: jobs and transcripts both show rowsecurity = t
```

### Operation: Stand up the Quick Tunnel + capture URL

```bash
# Foreground (Phase 1 verification):
cd /home/arthur/Code/transcribe
mkdir -p ~/.transcribe
backend/scripts/tunnel.sh
# Wait ~3s, look at ~/.transcribe/tunnel-url

# Background (operational):
nohup backend/scripts/tunnel.sh > /dev/null 2>&1 &
sleep 3 && cat ~/.transcribe/tunnel-url
# https://random-words.trycloudflare.com
```

### Operation: First Vercel deploy

```bash
cd /home/arthur/Code/transcribe/frontend
pnpm install                                      # creates pnpm-lock.yaml
pnpm dlx create-next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*"  # if app/ doesn't exist yet
# OR a slimmer manual init: pnpm init + pnpm add next react react-dom + create app/page.tsx

pnpm dlx vercel@latest link                        # interactive: pick scope, name "transcribe"
pnpm dlx vercel@latest env add NEXT_PUBLIC_SUPABASE_URL production
pnpm dlx vercel@latest env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
pnpm dlx vercel@latest env add NEXT_PUBLIC_BACKEND_URL production  # current tunnel URL
pnpm dlx vercel@latest --prod                      # first deploy
# Then in dashboard: Settings → Git → connect GitHub repo, enable auto-deploy on main
```

### Operation: Initialize the backend with uv

```bash
cd /home/arthur/Code/transcribe
uv init --package backend           # creates backend/pyproject.toml + .python-version + src/ stub
cd backend
# Replace pyproject.toml with the one from Pattern 7
uv add "fastapi[standard]>=0.136" "pydantic-settings>=2.14"
uv add --dev pytest pytest-asyncio asgi-lifespan httpx ruff
uv sync                             # creates uv.lock
uv run uvicorn app.main:app --reload --port 8000   # smoke test
```

### Operation: Verify pre-commit blocks a fake secret

```bash
cd /home/arthur/Code/transcribe
pre-commit install                  # writes .git/hooks/pre-commit

# Try to commit a file containing a high-entropy fake HF token
echo "leak_test=hf_$(openssl rand -hex 17)" > /tmp/secret_test.txt
git add /tmp/secret_test.txt 2>/dev/null  # actually staged from /tmp won't work — use repo-internal:
echo "leak_test=hf_$(openssl rand -hex 17)" > .leak-test.tmp
git add .leak-test.tmp
git commit -m "should be blocked"
# expected: pre-commit hook fails with gitleaks finding; commit refused
rm .leak-test.tmp && git restore --staged .leak-test.tmp 2>/dev/null
```

## Vulkan Stack Matrix for REPO-05 (Phase 1 documents, Phase 2 builds)

This is the table that REPO-05 must contain, **post-pivot**. Phase 1 only documents these versions; Phase 2 actually compiles whisper.cpp.

| Layer | Package / Build flag | Version pin | Source / Verification |
|-------|---------------------|-------------|----------------------|
| Mesa Vulkan driver | `mesa-vulkan-drivers` | apt-distributed (Ubuntu 26.04: typically 26.x) | [VERIFIED: `apt-cache search mesa-vulkan-drivers` shows package present] |
| Vulkan runtime loader | `libvulkan1` | apt-distributed | [CITED: ArchWiki Vulkan / Mesa3D RADV] |
| Vulkan headers + dev | `libvulkan-dev` | 1.4.341.0-1 (Ubuntu 26.04) | [VERIFIED: `apt-cache madison libvulkan-dev`] |
| Vulkan tools (`vulkaninfo`) | `vulkan-tools` | 1.4.341.0+dfsg1-1 | [VERIFIED: `apt-cache madison vulkan-tools`] |
| GLSL shader compiler (runtime) | `glslang-tools` | apt-distributed | [CITED: vulkan-tutorial.com Development_environment] |
| Shaderc compiler (build-time) | `libshaderc-dev` | apt-distributed | Required for runtime shader compilation in some whisper.cpp flows |
| 32-bit Vulkan (skip) | `libvulkan1:i386` | not needed | Only if running 32-bit games / Wine |
| **NOT** the proprietary AMD driver | `amdgpu-pro` | **DO NOT INSTALL** | Locked in CLAUDE.md / SUMMARY.md amendment — Mesa RADV outperforms AMDVLK on RDNA2 [CITED: wccftech.com/linux-gamers-should-stick-with-mesas-radv-drivers...] |
| whisper.cpp source | `git clone https://github.com/ggml-org/whisper.cpp` | tag `v1.8.4` [VERIFIED: GitHub releases] | Pin a tag, not `master`, to keep Phase 2 reproducible |
| whisper.cpp build flag (ASR backend) | `-DGGML_VULKAN=ON -DGGML_HIPBLAS=OFF -DGGML_HIP=OFF -DGGML_CUDA=OFF` | n/a | [CITED: ggml-org/whisper.cpp README; Discussion #3536]. Locked-in pivot decision: Vulkan, not HIP. **Tradeoff note:** community evidence ([CITED: HIPBLAS success story #1491]) suggests HIP may outperform Vulkan on RDNA2 by ~7x; the pivot picks Vulkan because it works on **any** GPU and avoids ROCm install pain. Phase 2 spike should benchmark both — see Open Questions. |
| whisper.cpp build flag (release) | `-DCMAKE_BUILD_TYPE=Release` | n/a | Standard |
| whisper.cpp build dependency | `cmake` ≥ 3.20, `build-essential`, `git` | apt | Sanity packages |
| whisper.cpp model file | `ggml-medium.bin` (~1.5 GB) and/or `ggml-large-v3-turbo.bin` (~1.6 GB) | pin SHA-256 | Download from [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp); pin the file hash in REPO-05 |
| pyannote.audio | `pyannote.audio>=3.3.2,<4` | locked in STATE.md | [CITED: WhisperX issues #1240, #1300 — pyannote 4 incompatible with the rest of the stack] |
| pyannote device | CPU (`torch.device("cpu")`) | locked | RX 6600 has no CUDA; pyannote 3 supports CPU |
| Python | 3.11.x (`>=3.11,<3.12`) | locked | [CITED: pyannote testing matrix; whisper.cpp Python bindings] |
| Node | 22.x LTS | locked | Vercel default; pnpm 10 minimum |
| ffmpeg | ≥ 6.0 (system binary) | apt | Required for audio normalization (Phase 2) |

**Build command (literal — for REPO-05 reference; not run in Phase 1):**

```bash
sudo apt install -y build-essential cmake git \
  mesa-vulkan-drivers libvulkan1 libvulkan-dev vulkan-tools glslang-tools libshaderc-dev

git clone --branch v1.8.4 --depth 1 https://github.com/ggml-org/whisper.cpp ~/Code/whisper.cpp
cd ~/Code/whisper.cpp
cmake -B build -DGGML_VULKAN=ON -DGGML_HIPBLAS=OFF -DGGML_HIP=OFF -DGGML_CUDA=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build build -j --config Release
# verify: build/bin/whisper-cli --help

# Vulkan device check:
vulkaninfo --summary
# expected output line: driverName = radv ; deviceName = AMD Radeon RX 6600 (RADV NAVI23)
```

## State of the Art

| Old Approach | Current Approach (2026) | When Changed | Impact |
|--------------|------------------------|--------------|--------|
| `cloudflared` via manual `.deb` download | Official apt repo `pkg.cloudflare.com` | Long-stable; old GPG keys deprecated **2026-04-30** | Use new GPG key URL [CITED: pkg.cloudflare.com 2026 deprecation notice] |
| `pip install -r requirements.txt` | `uv add` + `uv.lock` | uv stable since 2024 | Faster installs, deterministic lockfile, manages Python version |
| `npm install -g supabase` | `.deb` from GitHub releases (or `npx supabase` per-project) | Global npm install explicitly unsupported [CITED: supabase/cli#4496] | Single binary install via apt-style |
| `@supabase/auth-helpers-nextjs` | `@supabase/ssr` 0.10.x | Auth helpers deprecated since Next 14 | Locked in STATE.md |
| Supabase legacy `eyJ...` JWT keys | `sb_publishable_*` + `sb_secret_*` format | Migration ongoing through 2025-2026 | User has the new format already; gitleaks rules cover both |
| Custom `.git/hooks/pre-commit` shell scripts | `pre-commit` framework + hooks repos | Standard since ~2020; only mention because some old guides still show shell hooks | One config file, version-pinned, recoverable |
| WhisperX / faster-whisper / ctranslate2 (CUDA) | whisper.cpp + Vulkan / pyannote on CPU | 2026-04-27 pivot in this project | Locked in SUMMARY.md amendment |
| Cloudflare named tunnel (custom domain) | Cloudflare Quick Tunnel (`trycloudflare.com`) for v1 | 2026-04-27 pivot in this project | Locked; named tunnel deferred to v2 |

**Deprecated / outdated:**
- pkg.cloudflare.com **old** GPG key (`cloudflare.gpg` without "-main" suffix): removed 2026-04-30. Use `cloudflare-main.gpg`.
- `supabase init` flag `--with-intellij-settings`: removed in CLI 2.x — ignore old tutorials suggesting it.

## Project Constraints (from CLAUDE.md)

CLAUDE.md is informational, not directive — it links to the planning docs. The genuine directives that bind Phase 1:

1. **Conventional Commits** required (`feat:`, `fix:`, `docs:`, `chore:`). The `main` branch must read cleanly to a portfolio reviewer.
2. **Never commit `.env*`** (only `.env.example`). Pre-commit secret scanner runs before every commit.
3. **Service-role Supabase key never in `NEXT_PUBLIC_*`, Vercel env, or any committed file.**
4. **Python:** `uv` for env + lockfile; `ruff` for lint + format; type hints on public APIs.
5. **TypeScript:** Strict mode; ESLint or Biome.
6. **DB:** RLS `ENABLE`d in the same migration as `CREATE TABLE`. CI gate is Phase 5; convention enforced now.
7. **GSD workflow:** Use `/gsd-execute-phase` for planned phase work — do not edit files outside the workflow.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Cloudflare apt repo's `noble` (Ubuntu 24.04) channel installs cleanly on Ubuntu 26.04 (`resolute`) | Standard Stack → Installation | LOW — the cloudflared binary is statically-linked Go and is known to work across Ubuntu versions; if it fails, fallback is direct .deb download from GitHub releases. **Verify during Phase 1 wave 0.** |
| A2 | Supabase apt/`.deb` install is the cleanest path on Ubuntu (vs. `npx supabase` per-project) | Standard Stack → Installation | LOW — both work. `.deb` is recommended because the Supabase CLI is system-wide tooling not a project dependency. If `.deb` fails, `npx supabase` fallback is one command. |
| A3 | Quick Tunnel writes URL to **stderr** in a parseable form | Pattern 3 (tunnel.sh) | MEDIUM — script captures both streams (`2>&1`) so format change doesn't break URL extraction, but the regex assumes `https://*.trycloudflare.com` shape (which is documented stable). Validation gate runs the script and asserts file is populated. |
| A4 | The user is fine with the legacy `eyJ...` JWT format AND the new `sb_publishable_*` / `sb_secret_*` format both being present in their captured Supabase data | gitleaks rules | LOW — rules cover both. The user provided the keys at PROJECT.md sign-off; whichever format is in the file is what gets gated. |
| A5 | `supabase db push` against the user's project will succeed without additional Supabase CLI auth (e.g., `supabase login`) when given `--db-url` directly | Code Examples | MEDIUM — `--db-url` documented as bypassing the linked-project requirement. If it doesn't, `supabase login` is a one-time interactive step the dev runs. Validation gate catches this on first migration push. |
| A6 | The user wants Next.js 15 specifically (not Next.js 16 which is now stable) | Standard Stack → Core | MEDIUM — STATE.md says "Next.js 15 (App Router)". Asking the user before pinning is cheaper than guessing. **See Open Questions.** |
| A7 | gitleaks 8.30.x's default rule set already covers OpenAI keys, GitHub PATs, AWS, Stripe, GCP — no extension needed for those | gitleaks.toml | LOW — gitleaks bundles 150+ default rules; spot-check shows all the major providers covered. |
| A8 | Combined `.env.example` at repo root is preferred over per-app — but per-app symlinks to it are fine | Pattern 5 | LOW — both styles work; recommendation is "do both" for ergonomic compatibility with each tool's expected location. |
| A9 | Vulkan backend on RDNA2 RX 6600 actually performs adequately for whisper.cpp (vs. HIP being meaningfully faster) | Vulkan Stack Matrix | MEDIUM — HIP backend has community evidence of 7x speedup on AMD [CITED: HIPBLAS success story #1491]; Vulkan is portable but unproven for this exact card. **The locked decision is Vulkan; Phase 2 is responsible for the actual benchmark spike.** Phase 1 only documents what's needed; switching backend later is a Phase 2 decision, not a Phase 1 blocker. |
| A10 | The user accepts MIT license without a dual-license discussion | License Choice section | LOW — REPO-03 says "MIT or Apache-2.0"; MIT is the simpler default and matches Whisper, whisper.cpp, and pyannote.audio (all MIT). |

**Tagged claims requiring user confirmation before plan-lock:**
- A6 (Next.js 15 vs 16 pin) — the only one with material downstream impact in Phase 1 itself.

## License Choice (REPO-03)

**Recommendation: MIT.** Verified license alignment of all upstream deps:
- OpenAI Whisper (the model + reference impl): MIT [CITED: github.com/openai/whisper LICENSE]
- whisper.cpp (the C++ port we use): MIT [CITED: github.com/ggml-org/whisper.cpp]
- pyannote.audio (the diarization library): MIT [CITED: github.com/pyannote/pyannote-audio LICENSE — "always remain open-source MIT" per project communication]
- pyannote model weights (`segmentation-3.0`, `speaker-diarization-3.1`): MIT (per HF model page LICENSE files)
- Next.js, FastAPI, Supabase JS, Tailwind, shadcn: all MIT or BSD-style permissive
- ffmpeg: LGPL/GPL-2 depending on build — but we **invoke** ffmpeg as a binary, not link to it; this does not affect our chosen license

**Why MIT over Apache-2.0:**
- Whisper, whisper.cpp, and pyannote are all MIT — staying MIT minimizes any "license-compat" surprises a portfolio reviewer might ask about.
- Apache-2.0 adds a patent-grant clause, useful for projects with patentable IP; this project has none.
- MIT is one short paragraph; Apache-2.0 is a 9-section legal text. For a portfolio repo, less ceremony reads better.

**Why not MPL-2.0 / Unlicense:**
- MPL-2.0 is file-level copyleft — an unusual choice for app code; no upstream forces it on us.
- Unlicense / CC0 / WTFPL are problematic legally in some jurisdictions (Germany, etc.); MIT is the unambiguous "permissive" default.

**File:** drop the standard MIT text into `LICENSE` at repo root. Year: `Copyright (c) 2026 Arthur Felaco`.

## Open Questions

1. **Next.js 15 vs 16?**
   - What we know: STATE.md says "Next.js 15 (App Router)". Next.js 16 is current stable as of 2026-04-27.
   - What's unclear: Is "15" a hard pin (e.g., for some compat reason in research) or a "current at time of writing" reference?
   - Recommendation: **Ask the user during plan/discuss.** Defaulting to 16 if no objection — `@supabase/ssr` 0.10.x and Tailwind 4 both support Next 16; no known blocker.

2. **Whisper.cpp Vulkan backend vs HIP backend on RX 6600**
   - What we know: Pivot decision (SUMMARY.md amendment) chose Vulkan because it works on any GPU and avoids ROCm install pain.
   - What's unclear: Community reports suggest HIP is meaningfully faster on RDNA2 (7x in one report).
   - Recommendation: Phase 1 documents Vulkan path (per locked decision). **Phase 2 is responsible for a benchmark spike** that compares Vulkan vs HIP runtime; if HIP wins decisively, Phase 2 may revise. Phase 1 should NOT relitigate.

3. **Per-app `.env.local.example` files vs single root `.env.example`**
   - What we know: Both work; tools have native expectations (Next.js wants `frontend/.env.local`, FastAPI/uv reads `backend/.env`).
   - What's unclear: User preference.
   - Recommendation: **Do both.** Root `.env.example` is canonical (matches REPO-04 wording "every required env variable for both"); per-app symlinks point to it for tool ergonomics. If symlinks are awkward on the user's setup, copy-instead-of-symlink also works.

4. **Should planning artifacts (`.planning/`) be public on the portfolio repo?**
   - What we know: Currently NOT in `.gitignore`. Visible to anyone who clones.
   - What's unclear: Does the user want the GSD planning trail public (transparency, "look how I plan"), or scrubbed (cleaner repo)?
   - Recommendation: **Defer to Phase 6 (Portfolio Polish).** Phase 1 doesn't need to decide; current "committed" state is fine for now.

5. **Optional: scrub the gitignored `hf_token`/`gpu`/`supabase`/`ubuntu_version` files at repo root after `.env.example` populated**
   - What we know: Files are gitignored but they're loose secrets in the working tree.
   - What's unclear: Does user want them deleted after Phase 1 setup, or kept as a "source of truth" cache?
   - Recommendation: Phase 1 plan reads them once → populates `.env` → asks user whether to delete or keep. Deletion is safer; keep is friendlier.

6. **Cloudflare apt repo on Ubuntu 26.04 ('resolute')**
   - What we know: Cloudflare officially supports up to `noble` (24.04). 26.04 not listed.
   - What's unclear: Whether the `noble` channel will install cleanly on `resolute` (likely yes — `cloudflared` is a static Go binary).
   - Recommendation: Phase 1 wave 0 verifies `noble` install works on 26.04; if not, fallback is `dpkg -i` of the .deb downloaded directly from GitHub releases.

## Environment Availability

Probed on 2026-04-27 against the user's Ubuntu 26.04 machine.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Frontend (Next.js, pnpm) | ✓ | 22.22.1 | — |
| npm | Bootstrap pnpm | ✓ | 9.2.0 | — |
| Python 3.x | uv runs without it; but for sanity | ✓ | 3.14.4 system; uv installs 3.11 separately | uv handles this |
| git | Repo + pre-commit | ✓ | 2.53.0 | — |
| make | whisper.cpp build (Phase 2 only) | ✓ | 4.4.1 | — |
| pnpm | Frontend pkg manager | ✗ | — | `corepack enable && corepack prepare pnpm@10.33.2 --activate` |
| uv | Backend pkg manager | ✗ | — | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| cloudflared | OPS-03 tunnel | ✗ | — | apt repo (preferred) or .deb from GitHub |
| supabase CLI | Migrations | ✗ | — | .deb from GitHub releases |
| gitleaks | SEC-05 secret scanning | ✗ | — | Binary from GitHub releases (`/usr/local/bin`) |
| pre-commit (Python) | SEC-05 hook framework | ✗ | — | `uv tool install pre-commit` |
| vulkaninfo | Phase 2 GPU check (Phase 1 documents only) | ✗ | — | `apt install vulkan-tools` (Phase 2 setup) |
| cmake | Phase 2 whisper.cpp build | ✗ | — | `apt install cmake` (Phase 2) |
| ffmpeg | Phase 2 audio normalization | ✗ | — | `apt install ffmpeg` (Phase 2) |
| docker | NOT required (we don't ship Docker) | ✗ | — | — |
| gh (GitHub CLI) | Convenience for repo creation | ✗ | — | Use git remote directly; gh optional |
| vercel CLI | Optional — env-var management | ✗ | — | `pnpm dlx vercel@latest` (no install needed; npx-equivalent) |

**Missing dependencies with no fallback:** None — every Phase 1 tool has a documented install path.

**Missing dependencies with fallback (all Phase 1 must install):**
- pnpm, uv, cloudflared, supabase CLI, gitleaks, pre-commit — all part of the Phase 1 setup tasks.

**Note:** Phase 1 uses Python 3.11 (managed by uv); the system Python 3.14 is not used for backend code. This is intentional — uv keeps the project Python independent of the system one.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Backend test framework | pytest 8.4+ + pytest-asyncio 0.24+ + asgi-lifespan 2.1+ + httpx 0.28+ |
| Frontend test framework | (Phase 3 introduces Vitest; Phase 1 has no frontend tests beyond a build smoke check) |
| Backend config file | `backend/pyproject.toml` `[tool.pytest.ini_options]` |
| Quick run command (backend) | `cd backend && uv run pytest -x` |
| Full suite command (backend) | `cd backend && uv run pytest` |
| Frontend build smoke | `cd frontend && pnpm build` |
| Migration sanity probe | `psql "$SUPABASE_DB_URL" -c "select tablename, rowsecurity from pg_tables where schemaname='public';"` |
| Pre-commit dry-run | `pre-commit run --all-files` |

### Phase Requirements → Test Map

For Phase 1, "tests" are mostly probes that assert state-of-the-world (file exists, RLS is on, env loads correctly). True unit tests are scarce because we're scaffolding, not building behavior.

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REPO-01 | Monorepo has `frontend/`, `backend/`, `supabase/` dirs | Filesystem probe | `test -d frontend && test -d backend && test -d supabase && echo OK` | ❌ Wave 0 |
| REPO-03 | LICENSE file present at repo root | Filesystem probe | `test -f LICENSE && grep -q "MIT License" LICENSE && echo OK` | ❌ Wave 0 |
| REPO-04 | `.env.example` exists and lists every required var | Smoke check | `for v in SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL HF_TOKEN WHISPER_MODEL_PATH NEXT_PUBLIC_BACKEND_URL; do grep -q "^${v}=" .env.example \|\| { echo "MISSING $v"; exit 1; }; done; echo OK` | ❌ Wave 0 |
| REPO-05 | Pinned dep matrix documented post-pivot | Smoke check | `grep -q "GGML_VULKAN" docs/DEPENDENCIES.md && grep -q "mesa-vulkan-drivers" docs/DEPENDENCIES.md && ! grep -q "ctranslate2" docs/DEPENDENCIES.md && echo OK` (asserts pivot stack present, CUDA stack absent) | ❌ Wave 0 |
| SEC-01 | Every public table has RLS enabled in same migration as CREATE TABLE | SQL probe + grep | `for f in supabase/migrations/*.sql; do grep -q "create table public" "$f" && grep -q "enable row level security" "$f" \|\| { echo "FAIL $f"; exit 1; }; done; echo OK` (per-file invariant) AND `psql "$SUPABASE_DB_URL" -c "select count(*) from pg_tables where schemaname='public' and rowsecurity=false;"` returns 0 | ❌ Wave 0 |
| SEC-04 | `.gitignore` excludes `.env*` with `!.env.example` allowed | Grep probe | `grep -q "^.env" .gitignore && grep -q "^!.env.example" .gitignore && echo OK` | ✅ (already present in current .gitignore) |
| SEC-05 | Pre-commit secret scanner blocks high-entropy commits | Hook dry-run | `cd /tmp && git init test-scan && cd test-scan && cp /home/arthur/Code/transcribe/.pre-commit-config.yaml . && cp /home/arthur/Code/transcribe/gitleaks.toml . && pre-commit install && echo "hf_$(openssl rand -hex 17)" > leak.txt && git add . && ! git commit -m "should be blocked" 2>&1 \| grep -q "gitleaks" && echo OK` | ❌ Wave 0 |
| OPS-01 | Push to `main` triggers Vercel auto-deploy | Manual probe + CLI check | `pnpm dlx vercel@latest ls --scope=YOUR_TEAM` shows latest deployment within 5 min of last push; matches latest commit SHA | ❌ Wave 0 (manual gate) |
| OPS-03 | Quick Tunnel hostname captured to local file after restart | Filesystem + content probe | `backend/scripts/tunnel.sh &` then `sleep 5 && test -s ~/.transcribe/tunnel-url && grep -qE "^https://[a-z0-9-]+\.trycloudflare\.com$" ~/.transcribe/tunnel-url && echo OK` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** Run the specific probe(s) for the requirement(s) the commit advances. Quick ones (filesystem checks) take milliseconds.
- **Per wave merge:** Run all probes above as a checklist (`scripts/verify_phase1.sh` is a Phase 1 deliverable that runs them all).
- **Phase gate:** All probes pass; manual confirmation that Vercel auto-deploy fires on a real `git push origin main`; manual confirmation that pre-commit blocks a real fake-secret commit.

### Wave 0 Gaps

- [ ] `backend/tests/conftest.py` — minimal fixture for ASGI lifespan + AsyncClient (Phase 2 will lean on this; Phase 1 can ship a stub)
- [ ] `backend/tests/test_health.py` — single `async def test_healthz_returns_200` against the placeholder FastAPI app
- [ ] `scripts/verify_phase1.sh` — runs all probes from the table above; one-command Phase 1 gate
- [ ] `backend/scripts/tunnel.sh` — script from Pattern 3 above
- [ ] `backend/scripts/verify_env.py` — reads `.env`, asserts every variable listed in `.env.example` is set (or explicitly `=`-with-empty for "set me later")
- [ ] Test suite framework install: `cd backend && uv add --dev pytest pytest-asyncio asgi-lifespan httpx` (one command)
- [ ] No frontend tests in Phase 1 — Vitest arrives in Phase 3

## Security Domain

**`security_enforcement: true`** in `.planning/config.json`, ASVS level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Documented in research/ARCHITECTURE.md + this RESEARCH.md |
| V2 Authentication | no (in Phase 1) | Phase 4 wires Supabase magic-link auth |
| V3 Session Management | no (in Phase 1) | Phase 4 |
| V4 Access Control | yes (database layer) | RLS-from-first-migration; default deny-all (Pattern 2) |
| V5 Input Validation | no (no inputs yet) | Phase 2/3 |
| V6 Cryptography | no (no app crypto yet) | TLS handled by Cloudflare edge + Supabase; we add no crypto |
| V7 Error Handling | partial | FastAPI default error handlers fine for Phase 1; structured logging in Phase 2 |
| V8 Data Protection | yes | `.gitignore` + gitleaks pre-commit (SEC-04, SEC-05) |
| V9 Communications | yes | All traffic via TLS — Vercel + Supabase + Cloudflare edge enforce it; no plaintext anywhere |
| V10 Malicious Code | no | (no third-party-code-execution surface in Phase 1) |
| V11 Business Logic | no | (no business logic yet) |
| V12 Files & Resources | partial | Source-media file handling is Phase 2; Phase 1 ensures `.env*` and host-machine config files are gitignored |
| V13 API | no (no API endpoints yet) | Phase 2 |
| V14 Configuration | yes | `pydantic-settings` for backend env validation; Vercel project settings for frontend env; `.env.example` documents every var |

### Known Threat Patterns for {Phase 1 stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret committed to public repo | Information Disclosure | gitleaks pre-commit + `.gitignore` `.env*` + GitHub secret scanning |
| Public anon key + RLS off → full table leak (Lovable incident) | Information Disclosure | RLS in same migration as CREATE TABLE (SEC-01) + Phase 5 CI gate (SEC-02) |
| Service-role key shipped to Vercel/browser | Elevation of Privilege | Convention: never `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`; gitleaks rule on the key prefix |
| Tunnel-token / Cloudflare credentials leak | Spoofing | `cloudflared/` and `~/.cloudflared/` in `.gitignore`; only Quick Tunnel = no persistent credentials anyway |
| Stale `~/.cloudflared/config.yml` blocking Quick Tunnel | DoS (self-inflicted) | Phase 1 setup checks for and surfaces existence of the file |
| Forgetting `pre-commit install` after clone | Information Disclosure (deferred) | README documents the one-time install step; CONTRIBUTING.md (Phase 6) reinforces |

## Sources

### Primary (HIGH confidence)

- [pkg.cloudflare.com](https://pkg.cloudflare.com/) — official cloudflared apt repo + 2026-04-30 GPG key migration notice
- [github.com/cloudflare/cloudflared](https://github.com/cloudflare/cloudflared) — release notes, install instructions
- [Cloudflare Quick Tunnels docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) — 200 req/s cap, no SSE, no config.yml allowed
- [cloudflared issue #1449 — SSE buffering on Quick Tunnel](https://github.com/cloudflare/cloudflared/issues/1449) — confirms locked progress-channel decision
- [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — off-by-default for SQL-created tables, deny-all without policies
- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations) — `supabase migration new`, filename format
- [Supabase CLI on GitHub](https://github.com/supabase/cli) — release v2.90.0, .deb installer
- [Supabase: install methods](https://supabase.com/docs/guides/local-development/cli/getting-started) — npm global is unsupported
- [supabase/cli #4496 — npm global install unsupported](https://github.com/supabase/cli/issues/4496) — explicit confirmation
- [gitleaks GitHub repo](https://github.com/gitleaks/gitleaks) — current v8.30.1, pre-commit hook config, custom rules format
- [astral.sh/uv FastAPI integration](https://docs.astral.sh/uv/guides/integration/fastapi/) — recommended layout, Python pinning
- [astral.sh/uv project init](https://docs.astral.sh/uv/concepts/projects/init/) — `uv init --package`, `[tool.uv]` sections
- [Vercel monorepo docs](https://vercel.com/docs/monorepos) — Root Directory feature, monorepo patterns
- [Vercel CLI redeploy](https://vercel.com/docs/cli/redeploy) — `vercel redeploy --target production` after env change
- [Vercel CLI env](https://vercel.com/docs/cli/env) — `vercel env add` / `rm`
- [Vercel environment variables](https://vercel.com/docs/environment-variables) — env-var changes only affect new deployments
- [Next.js #87229 — runtime env vars discussion](https://github.com/vercel/next.js/discussions/87229) — confirms `NEXT_PUBLIC_*` is build-time
- [whisper.cpp on GitHub](https://github.com/ggml-org/whisper.cpp) — current v1.8.4, Vulkan/HIP build flags
- [whisper.cpp Discussion #3536 — Building with Vulkan SDK](https://github.com/ggml-org/whisper.cpp/discussions/3536) — exact cmake invocation
- [pyannote-audio LICENSE on GitHub](https://github.com/pyannote/pyannote-audio/blob/main/LICENSE) — MIT confirmed
- [pyannote/speaker-diarization-3.1 model card](https://huggingface.co/pyannote/speaker-diarization-3.1) — gating, license
- [openai/whisper LICENSE](https://github.com/openai/whisper/blob/main/LICENSE) — MIT
- [PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, research/SUMMARY.md, research/ARCHITECTURE.md, research/PITFALLS.md, CLAUDE.md] — internal locked decisions

### Secondary (MEDIUM confidence)

- [AppSecSanta — Gitleaks vs TruffleHog 2026](https://appsecsanta.com/sast-tools/gitleaks-vs-trufflehog) — comparison, recommendation
- [Rafter — secret scanning tools comparison](https://rafter.so/blog/secrets/secret-scanning-tools-comparison) — pre-commit framework guidance
- [PkgPulse — Turborepo vs Nx vs Moon 2026](https://www.pkgpulse.com/guides/turborepo-vs-nx-vs-moon-build-tools-2026) — when to add a build orchestrator
- [Medium (Osama) — pnpm Workspaces 2026 monorepo](https://medium.com/@oxm/how-i-built-a-professional-full-stack-monorepo-with-next-js-node-js-and-pnpm-workspaces-2026-1b8f5ac66bf9) — pnpm-workspace shape (we deliberately don't follow it)
- [Medium (ABHI) — Whisper on AMD GPU 2026](https://medium.com/@abhshk/running-gpu-accelerated-whisper-on-an-amd-gpu-no-nvidia-required-e27ea20b2ccd) — RX 6600 + AMD setup notes
- [llama.cpp Discussion #9491 — RX 6600 Vulkan guide](https://github.com/ggml-org/llama.cpp/discussions/9491) — community RX 6600 + Vulkan recipe
- [whisper.cpp Discussion #1491 — HIPBLAS success story](https://github.com/ggml-org/whisper.cpp/discussions/1491) — HIP performance evidence (informs Open Question 2)
- [Mesa3D RADV docs](https://docs.mesa3d.org/drivers/radv.html) — driver name, vulkaninfo expected output
- [byteiota — Supabase RLS / Lovable incident](https://byteiota.com/supabase-security-flaw-170-apps-exposed-by-missing-rls/) — historical RLS-off incident

### Tertiary (LOW confidence — flagged for validation)

- Cloudflare apt repo working on Ubuntu 26.04 'resolute' specifically — `noble` channel assumed compatible (binary is static Go); validate during Phase 1 wave 0.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified against npm/PyPI/GitHub on 2026-04-27
- Architecture (monorepo shape, RLS pattern, Quick Tunnel pattern): HIGH — sourced from upstream research + official docs
- License choice: HIGH — all upstream deps verified MIT
- Vulkan dep matrix: MEDIUM — Vulkan-vs-HIP performance question deliberately deferred to Phase 2 spike; documenting Vulkan path per locked decision
- Quick Tunnel hostname capture script: MEDIUM — bash regex on stderr is the standard approach but not officially blessed; validation gate exercises it
- Phase 1 ASVS coverage: HIGH — V4 (RLS) and V8 (secrets) thoroughly addressed; later categories deferred to phases that introduce them

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (30 days for stable items); cloudflared apt-key migration note expires 2026-04-30 (use new key URL)

---

# RESEARCH COMPLETE

**Phase:** 1 - Foundation
**Confidence:** HIGH

### Key Findings (one per question)

1. **Monorepo:** Plain sibling dirs (`frontend/` + `backend/` + `supabase/`), **NO** pnpm workspace, **NO** turbo, **NO** root `package.json`. Vercel's "Root Directory = `frontend`" cleanly handles this layout.
2. **cloudflared on Ubuntu 26.04:** Official apt repo `pkg.cloudflare.com` (use `noble` channel as fallback for `resolute`; new GPG key required after 2026-04-30). Hostname capture via a bash wrapper that pipes stderr through a `tee` + regex extractor into `~/.transcribe/tunnel-url`. Optional systemd user unit for auto-restart.
3. **Supabase RLS-from-day-one:** Three migration files, one per table + one for the realtime publication. Each table file has `CREATE TABLE` followed in the **same file** by `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with no policies (deny-all default; Phase 4 adds owner policies).
4. **Pre-commit secret scanning:** **gitleaks 8.30.1** wins over trufflehog/detect-secrets for this use case. Use the `pre-commit` framework with a custom `gitleaks.toml` adding rules for `hf_*`, `sb_secret_*`, `sb_publishable_*`, legacy `eyJ...` JWTs, and `*.supabase.co` URLs. Default rules cover GitHub/AWS/Stripe/etc.
5. **Vulkan SDK:** `mesa-vulkan-drivers` + `libvulkan-dev` + `vulkan-tools` + `glslang-tools` + `libshaderc-dev` (apt). Verify with `vulkaninfo --summary` (expect `driverName = radv`). whisper.cpp build: `cmake -B build -DGGML_VULKAN=ON -DGGML_HIPBLAS=OFF -DGGML_HIP=OFF -DGGML_CUDA=OFF && cmake --build build -j --config Release`. Phase 1 only documents these in `docs/DEPENDENCIES.md`; Phase 2 builds.
6. **Vercel auto-deploy:** GitHub integration is still cleanest. Set Root Directory = `frontend`. `NEXT_PUBLIC_*` is **build-time only** — no live update path; tunnel restart workflow is `vercel env rm` + `vercel env add` + `vercel redeploy --target production`. Three commands, documented in README.
7. **`.env.example`:** Single canonical file at repo root with section dividers (Supabase, HF, whisper.cpp, backend HTTP, frontend wiring). Per-app symlinks (or copies) so each tool finds its expected location. Every var has a one-line "what it is" + "where to get it".
8. **License:** **MIT.** All upstream deps (Whisper, whisper.cpp, pyannote.audio, the model weights, Next/FastAPI/Supabase) are MIT — choosing MIT minimizes any reviewer "license-compat?" question.
9. **uv layout:** `uv init --package backend`, then `pyproject.toml` with `[project]` `requires-python = ">=3.11,<3.12"`, `[tool.uv].python = "3.11"`, and `.python-version` = `3.11`. App-style layout (`app/main.py`, `app/config.py`); Phase 2 expands.
10. **Validation architecture:** Mostly probes (filesystem, SQL, grep, dry-run hook), not unit tests. RLS SQL probe + secret-blocked dry-run + tunnel-URL file existence + Vercel deploy CLI check make a complete Phase 1 gate. One `scripts/verify_phase1.sh` runs them all.

### Open Questions Left for the Planner

- **OQ-1 (high impact):** Pin Next.js 15 (per STATE.md) or upgrade to Next.js 16 (current stable, no known compat issues)? Ask user during plan/discuss.
- **OQ-2 (deferred to Phase 2):** Vulkan vs HIP backend for whisper.cpp on RX 6600 — community evidence suggests HIP is meaningfully faster, but the locked pivot is Vulkan. Phase 1 documents Vulkan; Phase 2 benchmarks both.
- **OQ-3 (low impact):** Single root `.env.example` vs per-app — recommendation is "do both" but user preference welcome.
- **OQ-4 (deferred to Phase 6):** Should `.planning/` be gitignored on the public repo, or kept as a transparency artifact?
- **OQ-5 (low impact):** Delete or keep the gitignored `hf_token` / `gpu` / `supabase` / `ubuntu_version` input files at repo root after `.env.example` is populated?
- **OQ-6 (low impact, validate during wave 0):** Cloudflare apt repo `noble` channel on Ubuntu 26.04 'resolute' — likely fine (static Go binary), validate during install.

### File Created

`/home/arthur/Code/transcribe/.planning/phases/01-foundation/01-RESEARCH.md`
