#!/usr/bin/env bash
# Ensure WAHA default session has NOWEB store (new sessions) + bot webhook.
set -euo pipefail

WAHA_URL="${WAHA_API_URL:-http://127.0.0.1:3000}"
WAHA_KEY="${WAHA_API_KEY:-sokoni-local-dev-key}"
WEBHOOK_URL="${BOT_WEBHOOK_URL:-http://host.docker.internal:3001/webhook}"
SESSION="${WAHA_SESSION:-default}"

json_field() {
  local json="$1" field="$2"
  printf '%s' "$json" | python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  for k in '$field'.split('.'):
    d=d.get(k) if isinstance(d,dict) else None
  print('' if d is None else d)
except Exception:
  print('')" 2>/dev/null || echo ""
}

wait_waha() {
  local i
  for i in $(seq 1 30); do
    if curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: WAHA API not ready at $WAHA_URL"
  exit 1
}

create_session() {
  echo "==> Creating WAHA session '$SESSION' (NOWEB store + webhook → $WEBHOOK_URL)"
  curl -sf -X POST \
    -H "X-Api-Key: $WAHA_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"$SESSION\",
      \"config\": {
        \"noweb\": { \"store\": { \"enabled\": true, \"fullSync\": false } },
        \"webhooks\": [{ \"url\": \"$WEBHOOK_URL\", \"events\": [\"message.any\"] }]
      }
    }" \
    "$WAHA_URL/api/sessions" | head -c 600
  echo ""
}

update_webhook() {
  echo "==> Updating webhook → $WEBHOOK_URL"
  curl -sf -X PUT \
    -H "X-Api-Key: $WAHA_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"config\":{\"webhooks\":[{\"url\":\"$WEBHOOK_URL\",\"events\":[\"message.any\"]}]}}" \
    "$WAHA_URL/api/sessions/$SESSION" >/dev/null
}

reset_session() {
  echo "==> RESET: deleting session '$SESSION' (you will need to scan QR again)"
  curl -sf -X DELETE -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" >/dev/null 2>&1 || true
  sleep 2
  create_session
}

wait_waha

if [ "${RESET_WAHA_SESSION:-}" = "1" ]; then
  reset_session
else
  SESSION_JSON="$(curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" 2>/dev/null || echo "")"
  STATUS="$(json_field "$SESSION_JSON" status)"
  STORE="$(json_field "$SESSION_JSON" config.noweb.store.enabled)"

  if [ -z "$STATUS" ]; then
    create_session
  else
    echo "==> Session '$SESSION': status=$STATUS noweb.store.enabled=${STORE:-false}"
    update_webhook

    if [ "$STORE" != "True" ] && [ "$STORE" != "true" ]; then
      echo "WARN: NOWEB store is OFF — media/download APIs fail until session is recreated."
      echo "      Fix (requires new QR scan): RESET_WAHA_SESSION=1 bash scripts/configure-waha-session.sh"
    fi

    case "$STATUS" in
      STOPPED|FAILED)
        echo "==> Starting session..."
        curl -sf -X POST -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION/start" >/dev/null || true
        ;;
      SCAN_QR_CODE)
        echo "==> Scan QR — do NOT use docker logs (ASCII is not scannable)."
        echo "    Run: bash scripts/waha-link-whatsapp.sh"
        echo "    Or pairing code + PNG QR saved to ~/sokoni/waha-qr.png"
        ;;
      WORKING)
        echo "==> Session WORKING"
        ;;
    esac
  fi
fi

wait_session_working() {
  local i status
  for i in $(seq 1 45); do
    SESSION_JSON="$(curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" 2>/dev/null || echo "")"
    status="$(json_field "$SESSION_JSON" status)"
    if [ "$status" = "WORKING" ]; then
      echo "==> Session WORKING — WhatsApp send/receive ready"
      return 0
    fi
    if [ "$status" = "SCAN_QR_CODE" ]; then
      echo "ERROR: WhatsApp session needs pairing — bot cannot reply until linked."
      echo "       Run: bash scripts/waha-link-whatsapp.sh"
      return 1
    fi
    if [ "$i" -le 3 ] || [ $((i % 5)) -eq 0 ]; then
      echo "==> Waiting for session WORKING (status=${status:-unknown}, ${i}/45)..."
    fi
    sleep 2
  done
  status="$(json_field "$(curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" 2>/dev/null || echo "")" status)"
  echo "WARN: Session still not WORKING (status=${status:-unknown}) — WhatsApp replies may fail."
  echo "      Run: bash scripts/waha-link-whatsapp.sh"
  return 1
}

wait_session_working || true

echo "==> Final session:"
curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" | head -c 500
echo ""
