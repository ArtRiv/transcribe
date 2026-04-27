#!/usr/bin/env bash
# backend/scripts/verify_phase1.sh
#
# One-command Phase 1 verification harness.
#
# Aggregates every probe declared in .planning/phases/01-foundation/01-VALIDATION.md
# for REPO-01, REPO-03, REPO-04, REPO-05, SEC-01, SEC-04, SEC-05, OPS-01, OPS-03.
#
# Usage:
#   bash backend/scripts/verify_phase1.sh           # full suite (~10s)
#   bash backend/scripts/verify_phase1.sh --quick   # fast subset (~1s; skips SQL + HTTP)
#
# Exit 0 = phase verifies; non-zero = number of probe failures.

set -uo pipefail
# NOTE: deliberately NOT `-e` — we want every probe to run; we count failures.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

QUICK=0
if [ "${1:-}" = "--quick" ]; then
  QUICK=1
fi

FAIL_COUNT=0
PASS_COUNT=0

# ── Color output ──────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_GREEN=$(printf '\033[32m'); C_RED=$(printf '\033[31m'); C_YELLOW=$(printf '\033[33m'); C_OFF=$(printf '\033[0m')
else
  C_GREEN=""; C_RED=""; C_YELLOW=""; C_OFF=""
fi

pass() { printf "  ${C_GREEN}\xE2\x9C\x93${C_OFF} %s\n" "$1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { printf "  ${C_RED}\xE2\x9C\x97${C_OFF} %s\n" "$1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
skip() { printf "  ${C_YELLOW}-${C_OFF} %s (skipped: %s)\n" "$1" "$2"; }
section() { printf "\n${C_GREEN}==${C_OFF} %s\n" "$1"; }

# ── REPO-01: monorepo layout (frontend/ + backend/ + supabase/) ──────────
section "REPO-01 — Monorepo layout"

if [ -d frontend ] && [ -d backend ] && [ -d supabase ]; then
  pass "frontend/, backend/, supabase/ exist"
else
  fail "expected frontend/, backend/, supabase/ at repo root"
fi

if [ -f frontend/package.json ] && grep -q '"next"' frontend/package.json; then
  pass "frontend/package.json declares next"
else
  fail "frontend/package.json missing or no 'next' dep"
fi

if [ -f backend/pyproject.toml ] && grep -q '^name = "transcribe-backend"$' backend/pyproject.toml; then
  pass "backend/pyproject.toml has transcribe-backend"
else
  fail "backend/pyproject.toml missing or wrong name"
fi

if [ -f supabase/config.toml ]; then
  pass "supabase/config.toml exists"
else
  fail "supabase/config.toml missing — run supabase init"
fi

# ── REPO-03: LICENSE ──────────────────────────────────────────────────────
section "REPO-03 — LICENSE"

if [ -f LICENSE ] && grep -q "^MIT License$" LICENSE && grep -q "Copyright (c) 2026 Arthur Felaco" LICENSE; then
  pass "LICENSE is MIT with 2026 Arthur Felaco copyright"
else
  fail "LICENSE missing or wrong content"
fi

# ── REPO-04: .env.example documents every var ─────────────────────────────
section "REPO-04 — .env.example completeness"

if [ -f .env.example ]; then
  for v in SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
           SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL HF_TOKEN \
           WHISPER_MODEL_PATH NEXT_PUBLIC_BACKEND_URL; do
    if grep -q "^${v}=" .env.example; then
      pass ".env.example has ${v}="
    else
      fail ".env.example missing ${v}="
    fi
  done
else
  fail ".env.example missing"
fi

# ── REPO-05: docs/DEPENDENCIES.md is post-pivot (Vulkan, no CUDA) ────────
section "REPO-05 — Pinned dep matrix (post-pivot)"

if [ -f docs/DEPENDENCIES.md ]; then
  grep -q "GGML_VULKAN" docs/DEPENDENCIES.md && pass "DEPENDENCIES.md mentions GGML_VULKAN" || fail "DEPENDENCIES.md missing GGML_VULKAN"
  grep -q "mesa-vulkan-drivers" docs/DEPENDENCIES.md && pass "DEPENDENCIES.md mentions mesa-vulkan-drivers" || fail "DEPENDENCIES.md missing mesa-vulkan-drivers"

  # CUDA-stack absence (allow only "superseded by/replaces/replaced" mentions)
  CUDA_LEAK=$(grep -E "ctranslate2|cuDNN|cu124|WhisperX" docs/DEPENDENCIES.md \
              | grep -vE "superseded|replaces|REPLACED|replaced" || true)
  if [ -z "$CUDA_LEAK" ]; then
    pass "DEPENDENCIES.md has no live CUDA-stack mentions"
  else
    fail "DEPENDENCIES.md still references CUDA stack: $CUDA_LEAK"
  fi
else
  fail "docs/DEPENDENCIES.md missing"
fi

# ── SEC-04: .gitignore covers .env* with !.env.example exception ─────────
section "SEC-04 — .gitignore secret patterns"

if grep -q "^\.env$" .gitignore && grep -q "^\.env\.\*$" .gitignore && grep -q "^!\.env\.example$" .gitignore; then
  pass ".gitignore: .env, .env.*, !.env.example all present"
else
  fail ".gitignore missing one of: .env / .env.* / !.env.example"
fi

# Note: 'supabase' was renamed to 'supabase.input' during Plan 05 to avoid collision
# with the new supabase/ CLI project directory (which is tracked).
for f in hf_token gpu supabase.input ubuntu_version; do
  if grep -q "^${f}$" .gitignore; then
    pass ".gitignore covers ${f}"
  else
    fail ".gitignore missing ${f}"
  fi
done

# backend/.env and frontend/.env.local must be gitignored
if git check-ignore --quiet backend/.env 2>/dev/null; then
  pass "backend/.env is gitignored"
else
  fail "backend/.env NOT gitignored (or doesn't exist)"
fi

if git check-ignore --quiet frontend/.env.local 2>/dev/null; then
  pass "frontend/.env.local is gitignored"
else
  fail "frontend/.env.local NOT gitignored (or doesn't exist)"
fi

# ── SEC-05: pre-commit hook installed AND blocks fake secrets ────────────
section "SEC-05 — Pre-commit secret scanner"

if [ -f .pre-commit-config.yaml ] && grep -q "gitleaks" .pre-commit-config.yaml; then
  pass ".pre-commit-config.yaml wires gitleaks"
else
  fail ".pre-commit-config.yaml missing or doesn't reference gitleaks"
fi

if [ -f gitleaks.toml ] && grep -q '^useDefault = true$' gitleaks.toml; then
  pass "gitleaks.toml extends defaults"
else
  fail "gitleaks.toml missing or doesn't extend defaults"
fi

if [ -f .git/hooks/pre-commit ] && grep -q "pre-commit" .git/hooks/pre-commit; then
  pass ".git/hooks/pre-commit installed"
else
  fail ".git/hooks/pre-commit not installed (run: pre-commit install)"
fi

# Working-tree dry-run: pre-commit must currently find no leaks
if pre-commit run gitleaks --all-files >/dev/null 2>&1; then
  pass "pre-commit gitleaks dry-run passes on the working tree"
else
  fail "pre-commit gitleaks finds leaks in the working tree (manual investigation)"
fi

# ── SEC-01: per-file invariant on migration files ────────────────────────
section "SEC-01 — RLS-from-first-migration (per-file invariant)"

JOBS_MIG=$(ls supabase/migrations/*_jobs_with_rls.sql 2>/dev/null | head -1)
TR_MIG=$(ls supabase/migrations/*_transcripts_with_rls.sql 2>/dev/null | head -1)
RT_MIG=$(ls supabase/migrations/*_realtime_publication.sql 2>/dev/null | head -1)

for spec in "jobs:$JOBS_MIG" "transcripts:$TR_MIG"; do
  table="${spec%%:*}"; file="${spec##*:}"
  if [ -n "$file" ] && [ -f "$file" ]; then
    if grep -qi "create table public.${table}" "$file" && grep -qi "enable row level security" "$file"; then
      pass "${file##*/}: CREATE TABLE + ENABLE RLS in same file"
    else
      fail "${file##*/}: missing CREATE TABLE or ENABLE RLS"
    fi
  else
    fail "migration file for ${table} not found"
  fi
done

if [ -n "$RT_MIG" ] && [ -f "$RT_MIG" ] \
   && grep -qi "alter publication supabase_realtime add table public.jobs" "$RT_MIG" \
   && grep -qi "alter publication supabase_realtime add table public.transcripts" "$RT_MIG"; then
  pass "realtime publication migration adds both tables"
else
  fail "realtime publication migration missing or incomplete"
fi

# ── OPS-03: tunnel.sh exists + URL captured ──────────────────────────────
section "OPS-03 — Quick Tunnel"

if [ -x backend/scripts/tunnel.sh ] && grep -q "trycloudflare.com" backend/scripts/tunnel.sh; then
  pass "backend/scripts/tunnel.sh exists, executable, references trycloudflare.com"
else
  fail "backend/scripts/tunnel.sh missing/not executable/wrong content"
fi

if [ -x backend/scripts/check_tunnel_preflight.sh ] && grep -q "config.yml" backend/scripts/check_tunnel_preflight.sh; then
  pass "preflight check exists"
else
  fail "check_tunnel_preflight.sh missing"
fi

if command -v cloudflared >/dev/null; then
  pass "cloudflared installed: $(cloudflared --version 2>&1 | head -1)"
else
  fail "cloudflared not installed"
fi

if [ -f "$HOME/.transcribe/tunnel-url" ] \
   && grep -qE "^https://[a-z0-9-]+\.trycloudflare\.com$" "$HOME/.transcribe/tunnel-url"; then
  pass "~/.transcribe/tunnel-url has captured URL: $(cat "$HOME/.transcribe/tunnel-url")"
else
  fail "~/.transcribe/tunnel-url missing or malformed"
fi

# ── README documents tunnel-restart workflow ─────────────────────────────
if [ -f README.md ] \
   && grep -q "vercel env rm NEXT_PUBLIC_BACKEND_URL" README.md \
   && grep -q "vercel env add NEXT_PUBLIC_BACKEND_URL" README.md \
   && grep -q "vercel redeploy" README.md; then
  pass "README documents the 3-command tunnel-restart workflow"
else
  fail "README missing tunnel-restart workflow"
fi

# ── --quick exits here ────────────────────────────────────────────────────
if [ "$QUICK" = "1" ]; then
  section "Quick run — skipped: SQL probes (SEC-01 db-side), HTTP probes (frontend build), Vercel CLI"
  skip "SEC-01 SQL probe" "--quick mode"
  skip "OPS-01 Vercel READY check" "--quick mode"
  skip "frontend pnpm build" "--quick mode"
  skip "backend pytest" "--quick mode"
  goto_summary=1
else
  goto_summary=0
fi

if [ "$goto_summary" = "0" ]; then
  # ── SEC-01 DB-side: SQL probes (require live Supabase access) ──────────
  section "SEC-01 — RLS enabled in live DB (SQL probes)"

  if [ -f backend/.env ]; then
    SUPABASE_DB_URL=$(grep "^SUPABASE_DB_URL=" backend/.env | cut -d= -f2-)
  else
    SUPABASE_DB_URL=""
  fi

  if [ -z "$SUPABASE_DB_URL" ]; then
    fail "SUPABASE_DB_URL not set in backend/.env — cannot run SQL probes"
  elif ! command -v psql >/dev/null; then
    # psql is optional; if absent, skip the SQL probes rather than fail the
    # whole gate. The per-file invariant probes above (SEC-01 grep) still
    # establish that the migrations declare RLS; the SQL probes are the
    # live-DB cross-check. Install postgresql-client to enable them:
    #   sudo apt install -y postgresql-client
    skip "SEC-01 SQL: 0 public tables with RLS off" "psql not installed (apt install postgresql-client)"
    skip "SEC-01 SQL: jobs + transcripts in public schema" "psql not installed"
    skip "SEC-01 SQL: jobs + transcripts in supabase_realtime publication" "psql not installed"
  else
    NO_RLS=$(psql "$SUPABASE_DB_URL" -tAc "select count(*) from pg_tables where schemaname='public' and rowsecurity=false;" 2>/dev/null || echo "?")
    if [ "$NO_RLS" = "0" ]; then
      pass "SQL: 0 public tables have RLS off"
    else
      fail "SQL: $NO_RLS public tables have RLS off (or DB unreachable)"
    fi

    TABLE_COUNT=$(psql "$SUPABASE_DB_URL" -tAc "select count(*) from pg_tables where schemaname='public' and tablename in ('jobs','transcripts');" 2>/dev/null || echo "?")
    if [ "$TABLE_COUNT" = "2" ]; then
      pass "SQL: jobs + transcripts both exist in public schema"
    else
      fail "SQL: expected 2 of (jobs,transcripts), got $TABLE_COUNT"
    fi

    PUB_COUNT=$(psql "$SUPABASE_DB_URL" -tAc "select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename in ('jobs','transcripts');" 2>/dev/null || echo "?")
    if [ "$PUB_COUNT" = "2" ]; then
      pass "SQL: jobs + transcripts both in supabase_realtime publication"
    else
      fail "SQL: expected 2 in publication, got $PUB_COUNT"
    fi
  fi

  # ── REPO-01: backend tests + frontend build still pass ─────────────────
  section "REPO-01 — toolchains still work"

  if (cd backend && uv run pytest -x >/dev/null 2>&1); then
    pass "backend: uv run pytest exits 0"
  else
    fail "backend: pytest fails (run 'cd backend && uv run pytest -x' to see)"
  fi

  if (cd backend && uv run ruff check . >/dev/null 2>&1); then
    pass "backend: ruff check clean"
  else
    fail "backend: ruff check fails"
  fi

  if (cd frontend && pnpm test --run >/dev/null 2>&1 || cd "$REPO_ROOT/frontend" && pnpm test >/dev/null 2>&1); then
    pass "frontend: pnpm test exits 0"
  else
    fail "frontend: pnpm test fails"
  fi

  # NOTE: pnpm build is heavy (~30s); skipped from default to keep total runtime ~10s.
  # Run manually with: (cd frontend && pnpm build)

  # ── OPS-01: Vercel deploy is READY ─────────────────────────────────────
  section "OPS-01 — Vercel auto-deploy"

  if (cd frontend && pnpm dlx vercel@latest --version >/dev/null 2>&1); then
    DEPLOY_STATE=$(cd frontend && pnpm dlx vercel@latest ls --prod 2>&1 | head -10 | grep -oiE "ready" | head -1 || echo "")
    if [ "$(echo "$DEPLOY_STATE" | tr 'A-Z' 'a-z')" = "ready" ]; then
      pass "Vercel: latest production deployment is READY"
    else
      fail "Vercel: latest production deployment is NOT in READY state (or not authed)"
    fi
  else
    skip "Vercel CLI check" "vercel CLI not available via pnpm dlx"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────
section "Summary"
printf "%d passed, %d failed\n" "$PASS_COUNT" "$FAIL_COUNT"

if [ "$FAIL_COUNT" -eq 0 ]; then
  printf "${C_GREEN}Phase 1 verification: PASS${C_OFF}\n"
else
  printf "${C_RED}Phase 1 verification: FAIL (%d probes)${C_OFF}\n" "$FAIL_COUNT"
fi

# ── Manual reminder ───────────────────────────────────────────────────────
cat <<'EOF'

──── Manual step (cannot be automated) ────
HuggingFace license accept (required for Phase 2 diarization):
  Visit while signed in to HuggingFace with the same account that owns HF_TOKEN:
    https://huggingface.co/pyannote/segmentation-3.0
    https://huggingface.co/pyannote/speaker-diarization-3.1
  Click "Agree and access repository" / "Accept" on each page.
  Until both are accepted, downloads return 403 (silently if you're not looking).
EOF

exit "$FAIL_COUNT"
