#!/usr/bin/env bash
# Runs every *.sql file in this directory against the local Supabase Postgres.
# Each test must use BEGIN; ... ROLLBACK; — no committed state escapes.
# [Cited: 04-RESEARCH.md §Validation Architecture, 04-PATTERNS.md "Supabase — RLS tests"]
set -euo pipefail

# Use SUPABASE_DB_URL if set; otherwise resolve via supabase CLI.
DB_URL="${SUPABASE_DB_URL:-}"
if [[ -z "$DB_URL" ]]; then
  DB_URL="$(supabase status --output json 2>/dev/null | jq -r '.DB_URL // empty')"
fi
if [[ -z "$DB_URL" ]]; then
  echo "ERROR: SUPABASE_DB_URL not set and 'supabase status' returned no DB_URL." >&2
  echo "       Run 'supabase start' first." >&2
  exit 2
fi

fail=0
shopt -s nullglob
for f in "$(dirname "$0")"/test_*.sql; do
  echo "→ $(basename "$f")"
  if ! psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" >/dev/null; then
    echo "  ✗ FAIL"
    fail=1
  else
    echo "  ✓"
  fi
done
exit $fail
