#!/usr/bin/env bash
# Quick Sokoni bot + WAHA health check (run on VM).
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
echo "=== Sokoni health check ==="

echo ""
echo "1) Bot process (pm2)"
if pm2 describe sokoni-bot >/dev/null 2>&1; then
  pm2 describe sokoni-bot | sed -n '/status/p;/uptime/p;/restarts/p' | head -6
else
  echo "ERROR: sokoni-bot not in pm2 — run: bash scripts/deploy-bot.sh"
fi

echo ""
echo "2) Bot HTTP"
curl -sf "http://127.0.0.1:3001/health" && echo "" || echo "ERROR: bot not responding on :3001"

echo ""
echo "3) WAHA container"
WAHA_CID="$(docker ps -qf 'ancestor=devlikeapro/waha:latest' | head -1 || true)"
if [ -z "$WAHA_CID" ]; then
  echo "ERROR: WAHA not running — run: bash scripts/deploy-waha.sh"
else
  echo "OK: $WAHA_CID"
  docker exec "$WAHA_CID" env | grep -E '^WHATSAPP_' | sort || true
fi

echo ""
echo "4) WAHA session"
if [ -n "${WAHA_CID:-}" ]; then
  KEY="${WAHA_API_KEY:-sokoni-local-dev-key}"
  curl -sf -H "X-Api-Key: $KEY" "http://127.0.0.1:3000/api/sessions/default" | head -c 400 || echo "WARN: cannot read WAHA session"
  echo ""
fi

echo ""
echo "5) Public bot URL"
curl -sf "https://bot.sokonimall.com/health" && echo "" || echo "WARN: public health check failed"

echo ""
echo "Done. If any ERROR above, fix before testing WhatsApp."
