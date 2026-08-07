#!/usr/bin/env bash
# Show recent Daraja / STK lines from pm2 logs (single-line friendly).
# Usage: bash scripts/show-daraja-logs.sh
set -euo pipefail

OUT="${HOME}/.pm2/logs/sokoni-bot-out.log"
ERR="${HOME}/.pm2/logs/sokoni-bot-error.log"

echo "==> Recent Daraja / STK (out)"
if [ -f "$OUT" ]; then
  grep -iE '\[daraja\]|STK push|Couldn.t start M-Pesa|Could not start M-Pesa|start M-Pesa' "$OUT" | tail -30 || echo "(none)"
else
  echo "(missing $OUT)"
fi

echo
echo "==> Recent Daraja / STK (error)"
if [ -f "$ERR" ]; then
  grep -iE '\[daraja\]|STK push|Couldn.t start M-Pesa|Could not start M-Pesa|start M-Pesa' "$ERR" | tail -30 || echo "(none)"
else
  echo "(missing $ERR)"
fi

echo
echo "==> Tip: try *pay* on WhatsApp once, then re-run this script."
echo "    Open M-Pesa Org Portal → Identity → Till and confirm store till vs shortcode 3439153."
