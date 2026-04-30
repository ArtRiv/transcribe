#!/usr/bin/env bash
# backend/scripts/check_tunnel_preflight.sh
#
# Pre-flight checks for both Cloudflare tunnel modes.
#
# Usage:
#   check_tunnel_preflight.sh           # default: quick (no config.yml allowed)
#   check_tunnel_preflight.sh quick     # Quick Tunnel (*.trycloudflare.com)
#   check_tunnel_preflight.sh named     # named tunnel (custom hostname)
#
# Quick Tunnels refuse to start if ~/.cloudflared/config.yml exists — this is
# documented behavior, not a bug:
#   https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
# Named tunnels REQUIRE that config.yml plus a credentials JSON and the origin
# cert produced by `cloudflared tunnel login`.

set -euo pipefail

MODE="${1:-quick}"

if ! command -v cloudflared >/dev/null; then
  echo "ERROR: cloudflared not installed. Install via:" >&2
  echo "  sudo apt install -y cloudflared" >&2
  echo "(see docs/DEPENDENCIES.md and 01-RESEARCH.md 'Standard Stack')" >&2
  exit 1
fi

case "$MODE" in
  quick)
    if [ -f "$HOME/.cloudflared/config.yml" ]; then
      echo "ERROR: ~/.cloudflared/config.yml exists — Quick Tunnel will refuse to start." >&2
      echo "Either:" >&2
      echo "  - Run the named tunnel instead:  bash backend/scripts/tunnel-named.sh" >&2
      echo "  - Or move the config aside:      mv ~/.cloudflared/config.yml ~/.cloudflared/config.yml.bak" >&2
      exit 1
    fi
    echo "Pre-flight checks passed (quick mode: no ~/.cloudflared/config.yml; cloudflared installed)."
    ;;
  named)
    MISSING=()
    [ -f "$HOME/.cloudflared/config.yml" ] || MISSING+=("~/.cloudflared/config.yml")
    [ -f "$HOME/.cloudflared/cert.pem" ]   || MISSING+=("~/.cloudflared/cert.pem (run: cloudflared tunnel login)")
    # At least one credentials file must exist (named "<UUID>.json").
    shopt -s nullglob
    CREDS=("$HOME"/.cloudflared/*.json)
    shopt -u nullglob
    [ "${#CREDS[@]}" -gt 0 ] || MISSING+=("~/.cloudflared/<tunnel-uuid>.json (run: cloudflared tunnel create <name>)")

    if [ "${#MISSING[@]}" -gt 0 ]; then
      echo "ERROR: named-tunnel pre-flight failed. Missing:" >&2
      for m in "${MISSING[@]}"; do echo "  - $m" >&2; done
      echo "" >&2
      echo "Set up a named tunnel with:" >&2
      echo "  cloudflared tunnel login" >&2
      echo "  cloudflared tunnel create <name>" >&2
      echo "  cloudflared tunnel route dns <name> <subdomain.example.com>" >&2
      echo "  # then write ~/.cloudflared/config.yml" >&2
      exit 1
    fi
    echo "Pre-flight checks passed (named mode: config.yml + cert.pem + credentials present; cloudflared installed)."
    ;;
  *)
    echo "ERROR: unknown MODE '$MODE'. Expected 'quick' or 'named'." >&2
    exit 2
    ;;
esac
