#!/usr/bin/env bash
# Ensure WAHA default session has NOWEB store (new sessions) + bot webhook.
# WAHA Core does NOT persist session config across container restarts — re-apply every deploy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
export SOKONI_REPO="${SOKONI_REPO:-$REPO}"
# shellcheck source=lib/waha-common.sh
source "$SCRIPT_DIR/lib/waha-common.sh"
WEBHOOK_URL="${BOT_WEBHOOK_URL:-http://host.docker.internal:3001/webhook}"
SESSION="${WAHA_SESSION}"
# Shared with bot WEBHOOK_HMAC_KEY — WAHA signs raw body (X-Webhook-Hmac / sha512).
if [[ -z "${WEBHOOK_HMAC_KEY:-}" && -z "${WAHA_WEBHOOK_HMAC_KEY:-}" && -f "$REPO/whatsapp-bot/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  # Only pull the HMAC key line(s) — avoid sourcing unrelated secrets into this shell unnecessarily.
  WEBHOOK_HMAC_KEY="$(grep -E '^(WEBHOOK_HMAC_KEY|WAHA_WEBHOOK_HMAC_KEY)=' "$REPO/whatsapp-bot/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  set +a
fi
WEBHOOK_HMAC_KEY="${WEBHOOK_HMAC_KEY:-${WAHA_WEBHOOK_HMAC_KEY:-}}"

# JSON fragment for webhooks[] entry (url + events + optional hmac).
webhook_config_json() {
  python3 -c "
import json, os
url = os.environ.get('WEBHOOK_URL', '')
key = (os.environ.get('WEBHOOK_HMAC_KEY') or '').strip()
entry = {'url': url, 'events': ['message.any']}
if key:
  entry['hmac'] = {'key': key}
print(json.dumps(entry))
" 
}

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

session_json() {
  curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" 2>/dev/null || echo ""
}

session_status() {
  json_field "$(session_json)" status
}

session_store_enabled() {
  json_field "$(session_json)" config.noweb.store.enabled
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
  if [[ -n "$WEBHOOK_HMAC_KEY" ]]; then
    echo "==> Webhook HMAC enabled (WEBHOOK_HMAC_KEY)"
  else
    echo "==> WARN: WEBHOOK_HMAC_KEY unset — bot /webhook will accept unsigned POSTs"
  fi
  local hook
  hook="$(WEBHOOK_URL="$WEBHOOK_URL" WEBHOOK_HMAC_KEY="$WEBHOOK_HMAC_KEY" webhook_config_json)"
  curl -sf -X POST \
    -H "X-Api-Key: $WAHA_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"$SESSION\",
      \"config\": {
        \"noweb\": { \"store\": { \"enabled\": true, \"fullSync\": false } },
        \"webhooks\": [$hook]
      }
    }" \
    "$WAHA_URL/api/sessions" | head -c 600
  echo ""
}

apply_session_config() {
  echo "==> Applying NOWEB store + webhook → $WEBHOOK_URL"
  if [[ -n "$WEBHOOK_HMAC_KEY" ]]; then
    echo "==> Webhook HMAC enabled (WEBHOOK_HMAC_KEY)"
  else
    echo "==> WARN: WEBHOOK_HMAC_KEY unset — bot /webhook will accept unsigned POSTs"
  fi
  local hook
  hook="$(WEBHOOK_URL="$WEBHOOK_URL" WEBHOOK_HMAC_KEY="$WEBHOOK_HMAC_KEY" webhook_config_json)"
  curl -sf -X PUT \
    -H "X-Api-Key: $WAHA_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"config\": {
        \"noweb\": { \"store\": { \"enabled\": true, \"fullSync\": false } },
        \"webhooks\": [$hook]
      }
    }" \
    "$WAHA_URL/api/sessions/$SESSION" >/dev/null
}

start_session() {
  curl -sf -X POST -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION/start" >/dev/null 2>&1 || true
}

stop_session() {
  curl -sf -X POST -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION/stop" >/dev/null 2>&1 || true
}

restart_session() {
  curl -sf -X POST -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION/restart" >/dev/null 2>&1 || true
}

reset_session() {
  echo "==> RESET: deleting session '$SESSION' (WhatsApp re-link required)"
  curl -sf -X DELETE -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" >/dev/null 2>&1 || true
  sleep 2
  create_session
}

print_waha_logs() {
  waha_print_recent_logs 30
}

recover_failed_session() {
  echo "==> Session FAILED — trying restart..."
  restart_session
  sleep 5
  if [ "$(session_status)" = "WORKING" ]; then
    echo "==> Session recovered after restart"
    return 0
  fi

  echo "==> Restart failed — stop + re-apply NOWEB store config..."
  stop_session
  sleep 2
  apply_session_config || true
  sleep 4
  local status
  status="$(session_status)"
  if [ "$status" = "WORKING" ] || [ "$status" = "STARTING" ] || [ "$status" = "SCAN_QR_CODE" ]; then
    return 0
  fi

  echo "==> Session still $status — recreating (WhatsApp re-link required)..."
  reset_session
  return 1
}

wait_session_working() {
  local i status
  for i in $(seq 1 45); do
    status="$(session_status)"
    if [ "$status" = "WORKING" ]; then
      echo "==> Session WORKING — WhatsApp send/receive ready"
      return 0
    fi
    if [ "$status" = "SCAN_QR_CODE" ]; then
      echo ""
      echo "ERROR: WhatsApp needs pairing — bot cannot reply until linked."
      echo "       Run: bash scripts/waha-link-whatsapp.sh"
      return 1
    fi
    if [ "$status" = "FAILED" ] && [ "$i" -eq 8 ]; then
      recover_failed_session || true
    fi
    if [ "$i" -le 3 ] || [ $((i % 5)) -eq 0 ]; then
      echo "==> Waiting for session WORKING (status=${status:-unknown}, ${i}/45)..."
    fi
    sleep 2
  done
  status="$(session_status)"
  echo ""
  echo "ERROR: WAHA session not WORKING (status=${status:-unknown}) — WhatsApp replies will fail."
  echo "       NOWEB store must be enabled on every container restart (WAHA Core)."
  echo "       Fix: bash scripts/waha-link-whatsapp.sh"
  echo "       Or full reset: RESET_WAHA_SESSION=1 bash scripts/configure-waha-session.sh"
  print_waha_logs
  return 1
}

wait_waha

if [ "${RESET_WAHA_SESSION:-}" = "1" ]; then
  reset_session
  echo "==> Starting freshly created session..."
  start_session
  sleep 2
  echo "==> Reset complete (status=$(session_status)). Pairing required — do not wait for WORKING."
  echo "==> Final session:"
  curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" | head -c 500
  echo ""
  exit 0
fi

STATUS="$(session_status)"
STORE="$(session_store_enabled)"

if [ -z "$STATUS" ]; then
  create_session
  echo "==> Starting new session..."
  start_session
else
  echo "==> Session '$SESSION': status=$STATUS noweb.store.enabled=${STORE:-false}"
  apply_session_config
  STATUS="$(session_status)"
  STORE="$(session_store_enabled)"
  echo "==> After config apply: status=$STATUS noweb.store.enabled=${STORE:-false}"

  case "$STATUS" in
    WORKING)
      echo "==> Session WORKING"
      ;;
    FAILED)
      recover_failed_session || true
      ;;
    STOPPED)
      echo "==> Starting session..."
      start_session
      ;;
    SCAN_QR_CODE)
      echo "==> WhatsApp needs pairing — run: bash scripts/waha-link-whatsapp.sh"
      ;;
    STARTING)
      echo "==> Session starting..."
      ;;
  esac
fi

WAHA_SESSION_OK=0
wait_session_working && WAHA_SESSION_OK=1 || WAHA_SESSION_OK=0

echo "==> Final session:"
curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" | head -c 500
echo ""

if [ "$WAHA_SESSION_OK" -ne 1 ]; then
  exit 1
fi
