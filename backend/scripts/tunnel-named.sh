#!/usr/bin/env bash
# backend/scripts/tunnel-named.sh
#
# Cloudflare **named tunnel** wrapper. Runs the persistent `transcribe` tunnel
# routed at https://api.fel.tec.br (set up via `cloudflared tunnel login` +
# `cloudflared tunnel create transcribe` + `cloudflared tunnel route dns ...`).
#
# Unlike the Quick Tunnel (backend/scripts/tunnel.sh), the public hostname is
# stable across restarts, so NEXT_PUBLIC_BACKEND_URL on Vercel only needs to
# be set once and never updated again.
#
# Production deployment uses the systemd user unit:
#   systemctl --user start transcribe-tunnel.service
# Use this script for interactive runs (debugging, log inspection, smoke tests).
#
# Pre-flight (named mode) requires:
#   - ~/.cloudflared/config.yml         (tunnel UUID + ingress)
#   - ~/.cloudflared/cert.pem           (origin cert from `cloudflared tunnel login`)
#   - ~/.cloudflared/<UUID>.json        (tunnel credentials from `tunnel create`)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/check_tunnel_preflight.sh" named

exec cloudflared tunnel run transcribe
