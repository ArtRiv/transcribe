#!/usr/bin/env bash
# backend/scripts/tunnel.sh
#
# Cloudflare Quick Tunnel wrapper.
# Runs `cloudflared tunnel --url http://localhost:8000` and captures the
# rotating *.trycloudflare.com URL into ~/.transcribe/tunnel-url.
#
# The captured URL is read by the dev when updating Vercel:
#   vercel env rm NEXT_PUBLIC_BACKEND_URL production --yes
#   echo "$(cat ~/.transcribe/tunnel-url)" | vercel env add NEXT_PUBLIC_BACKEND_URL production
#   vercel redeploy --target production
#
# See .planning/phases/01-foundation/01-RESEARCH.md "Pattern 3" and the
# README "Tunnel restart workflow" section.
#
# Phase 1: run interactively for the smoke test (10s).
# Phase 2: a systemd user unit (~/.config/systemd/user/transcribe-tunnel.service)
# may be added once /healthz on port 8000 is the steady-state target.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"

# Pre-flight: refuse if ~/.cloudflared/config.yml exists (Pitfall 2).
"$SCRIPT_DIR/check_tunnel_preflight.sh"

TUNNEL_LOG="${HOME}/.transcribe/tunnel.log"
TUNNEL_URL_FILE="${HOME}/.transcribe/tunnel-url"
mkdir -p "$(dirname "$TUNNEL_LOG")"

# cloudflared writes the URL to stderr like:
#   |  https://random-words.trycloudflare.com                    |
# Capture both streams; tee to log; parse out the URL into TUNNEL_URL_FILE.
cloudflared tunnel --url "http://localhost:${BACKEND_PORT}" --no-autoupdate 2>&1 \
  | tee "$TUNNEL_LOG" \
  | while IFS= read -r line; do
      echo "$line"
      if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
        echo "${BASH_REMATCH[1]}" > "$TUNNEL_URL_FILE"
        echo "[tunnel.sh] captured URL → $TUNNEL_URL_FILE"
      fi
    done
