#!/usr/bin/env bash
# SEC-06 audit: ensure SUPABASE_SERVICE_ROLE_KEY does not appear in any
# frontend file (Vercel must NEVER see this key).
#
# The service-role key is backend-only: it lives in backend/.env and is
# consumed only by FastAPI's supabase-py client. It must never appear in
# any file that Vercel builds, bundles, or reads.
#
# This script is run:
#   - Manually by the operator as part of the Phase 4 UAT runbook (04-UAT.md)
#   - As a gate before merging (CI hook, Phase 5)
#
# [Cited: CLAUDE.md §Secrets; 04-RESEARCH.md §Pitfall 7; 04-08 PLAN §must_haves]
set -euo pipefail

FRONTEND_DIR="${1:-frontend}"

echo "Auditing ${FRONTEND_DIR}/ for service-role key references..."

# Find non-comment, non-doc references. Excludes node_modules + .next build.
hits=$(grep -rn 'SUPABASE_SERVICE_ROLE_KEY\|service_role' \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.json' \
  --exclude-dir=node_modules --exclude-dir=.next \
  "${FRONTEND_DIR}/" 2>/dev/null \
  | grep -v -E '^[^:]*:[[:space:]]*(//|\*|#)' \
  | grep -v 'should NOT\|MUST NOT\|never\|forbidden\|perimeter\|audit\|service-role' \
  || true)

if [[ -n "$hits" ]]; then
  echo "FAIL: service-role references found in ${FRONTEND_DIR}/:"
  echo "$hits"
  exit 1
fi

echo "OK: no service-role key references in ${FRONTEND_DIR}/"
exit 0
