#!/usr/bin/env bash
# backend/scripts/check_tunnel_preflight.sh
#
# Quick Tunnels (`cloudflared tunnel --url ...`) refuse to start if a
# ~/.cloudflared/config.yml exists. This is documented behavior, not a bug
# (https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
#
# If you previously set up a named tunnel on this host, move the config
# aside before running tunnel.sh:
#   mv ~/.cloudflared/config.yml ~/.cloudflared/config.yml.bak
#
# See .planning/phases/01-foundation/01-RESEARCH.md "Pitfall 2".

set -euo pipefail

if [ -f "$HOME/.cloudflared/config.yml" ]; then
  echo "ERROR: ~/.cloudflared/config.yml exists — Quick Tunnel will refuse to start." >&2
  echo "Move it aside first:" >&2
  echo "  mv ~/.cloudflared/config.yml ~/.cloudflared/config.yml.bak" >&2
  echo "Then re-run tunnel.sh." >&2
  exit 1
fi

if ! command -v cloudflared >/dev/null; then
  echo "ERROR: cloudflared not installed. Install via:" >&2
  echo "  sudo apt install -y cloudflared" >&2
  echo "(see docs/DEPENDENCIES.md and 01-RESEARCH.md 'Standard Stack')" >&2
  exit 1
fi

echo "Pre-flight checks passed (no ~/.cloudflared/config.yml; cloudflared installed)."
