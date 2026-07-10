#!/usr/bin/env bash
# Quick Sokoni bot + WAHA health check (run on VM).
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
WAHA_KEY="${WAHA_API_KEY:-sokoni-local-dev-key}"
echo "=== Sokoni health check ==="

echo ""
echo "1) Bot process (pm2)"
if pm2 describe sokoni-bot >/dev/null 2>&1; then
  pm2 describe sokoni-bot | sed -n '/status/p;/uptime/p;/restarts/p' | head -6
else
  echo "ERROR: sokoni-bot not in pm2 — run: bash scripts/deploy-bot.sh"
fi

echo ""
echo "2) Bot HTTP (local)"
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
  SESSION_JSON="$(curl -sf -H "X-Api-Key: $WAHA_KEY" "http://127.0.0.1:3000/api/sessions/default" 2>/dev/null || echo "")"
  if [ -z "$SESSION_JSON" ]; then
    echo "ERROR: cannot read WAHA session — run: bash scripts/configure-waha-session.sh"
  else
    printf '%s' "$SESSION_JSON" | python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)
  cfg = d.get('config') or {}
  hooks = cfg.get('webhooks') or []
  store = (cfg.get('noweb') or {}).get('store') or {}
  print('status:', d.get('status'))
  print('engine:', (d.get('engine') or {}).get('engine'))
  print('noweb.store.enabled:', store.get('enabled'))
  if hooks:
    print('webhook:', hooks[0].get('url'))
  else:
    print('webhook: MISSING')
except Exception as e:
  print('WARN: parse error', e)
" 2>/dev/null || echo "$SESSION_JSON" | head -c 400
    echo ""
    STATUS="$(printf '%s' "$SESSION_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")"
    if [ "$STATUS" != "WORKING" ]; then
      echo "ERROR: session not WORKING (status=$STATUS) — scan QR or run configure-waha-session.sh"
    fi
  fi
fi

echo ""
echo "5) Public bot URL"
curl -sf "https://bot.sokonimall.com/health" && echo "" || echo "WARN: public health check failed"

echo ""
echo "Done. If any ERROR above, fix before testing WhatsApp."
echo "Quick fix: cd ~/sokoni && git pull && bash scripts/deploy-waha.sh && bash scripts/deploy-bot.sh"
