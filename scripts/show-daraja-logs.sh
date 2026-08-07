#!/usr/bin/env bash
# Show recent Daraja / STK lines from pm2 logs.
set -euo pipefail
OUT="${HOME}/.pm2/logs/sokoni-bot-out.log"
ERR="${HOME}/.pm2/logs/sokoni-bot-error.log"
echo "==> Recent Daraja / STK (out)"
[ -f "$OUT" ] && grep -iE '\[daraja\]|STK push|start M-Pesa' "$OUT" | tail -30 || echo "(none)"
echo
echo "==> Recent Daraja / STK (error)"
[ -f "$ERR" ] && grep -iE '\[daraja\]|STK push|start M-Pesa' "$ERR" | tail -30 || echo "(none)"
echo
echo "Expected STK mapping: BusinessShortCode=3439153 PartyB=4775847 CustomerBuyGoodsOnline"
