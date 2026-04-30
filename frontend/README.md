# Transcribe — Frontend

Next.js 16 (App Router) + React 19 + Tailwind 4 + TypeScript. Deploys to Vercel free tier.

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Available scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`.

## Environment

Copy `.env.example` to `.env.local` and fill in the values. The Phase 1 vars
(`NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) are required for the real backend. The Phase 3
mock vars below let you run the full UI without any backend.

## Phase 3 — Mock Backend

The frontend can run end-to-end without a backend by setting `NEXT_PUBLIC_USE_MOCKS=1`:

```bash
# In frontend/.env.local
NEXT_PUBLIC_USE_MOCKS=1

# Then:
pnpm dev
# Open http://localhost:3000
```

With mocks on, MSW intercepts `POST /jobs`, the TUS upload protocol, and `/healthz`
/ `/readyz`; a hand-rolled Realtime stub emits scripted stage transitions on a
timer. The full landing → processing → editor flow runs in ~19 seconds against
the mocked transcript at `frontend/lib/mock/data.ts` (3 speakers, 18 segments).

To test failure paths:

```bash
# CORE-09 — fail mid-stage
NEXT_PUBLIC_MOCK_FAIL_AT_STAGE=transcribing pnpm dev

# PROG-04 — show "queued — 2 jobs ahead of you"
NEXT_PUBLIC_MOCK_JOBS_AHEAD=2 pnpm dev
```

Production builds drop the mock code via dynamic-import gating + `process.env.NODE_ENV`
short-circuits (verified by Plan 03-07 acceptance: `grep .next/server` returns 0
mock refs).

## Architecture (Phase 3)

- `app/page.tsx` — landing → processing state machine (`useReducer`, 9 actions)
- `app/job/[id]/page.tsx` — Server Component that awaits async `params`
- `app/job/[id]/editor-client.tsx` — Client Component: useReducer + Realtime + audio + autosave
- `components/transcribe/*` — landing, processing, editor surfaces
- `components/ui/*` — 13 reusable primitives styled via `@theme` tokens
- `lib/editor/*` — reducer, Zustand File store, debounced autosave/restore, exporters
- `lib/job/*`, `lib/tus/*`, `lib/supabase/*` — service layer (multipart vs TUS, Realtime)
- `lib/mock/*` — MSW handlers, mock Realtime stub (dev-only)

See `.planning/phases/03-frontend-skeleton/` for the full design contract:
`03-CONTEXT.md` (locked decisions), `03-UI-SPEC.md` (visual + interaction spec),
`03-RESEARCH.md` (patterns + pitfalls), `03-VALIDATION.md` (REQ-ID → test map),
`03-UAT.md` (manual UAT runbook).

## Tests

```bash
pnpm test        # vitest run (CI mode)
pnpm test:watch  # interactive
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm build       # next build
```

All four MUST exit 0 before merging a phase.

## Deploy

Push to a feature branch → Vercel auto-deploys a preview URL. Vercel env vars must
mirror `.env.example` minus the mock vars (production must not set
`NEXT_PUBLIC_USE_MOCKS=1`).
