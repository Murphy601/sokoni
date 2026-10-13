#!/usr/bin/env bash
# Install the WAHA voice-calls app on session `default` (outgoing WhatsApp rings).
# Does NOT recreate the WAHA container (that drops the WhatsApp link).
#
# VM:
#   cd ~/sokoni && git pull
#   bash scripts/install-waha-voice-calls.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
export SOKONI_REPO="${SOKONI_REPO:-$REPO}"

ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"
if [[ -z "${WAHA_API_KEY:-}" && -f "$ENV_FILE" ]]; then
  WAHA_API_KEY="$(grep -E '^WAHA_API_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  export WAHA_API_KEY
fi
if [[ -z "${WAHA_SESSION:-}" && -f "$ENV_FILE" ]]; then
  WAHA_SESSION="$(grep -E '^WAHA_SESSION=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  export WAHA_SESSION
fi

# shellcheck source=lib/waha-common.sh
source "$SCRIPT_DIR/lib/waha-common.sh"
SESSION="${WAHA_SESSION}"
APP_ID="${WAHA_VOICE_CALLS_APP_ID:-voice-calls-${SESSION}}"

echo "==> WAHA $WAHA_URL session=$SESSION (voice-calls app)"

if ! curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions" >/dev/null 2>&1; then
  echo "ERROR: WAHA API is not reachable at $WAHA_URL"
  echo "       Start it first: bash scripts/deploy-waha.sh"
  exit 1
fi

STATUS="$(
  curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" 2>/dev/null \
    | python3 -c 'import sys,json
try:
  print(json.load(sys.stdin).get("status") or "")
except Exception:
  print("")' || true
)"
echo "==> Session status: ${STATUS:-unknown}"
if [ "$STATUS" != "WORKING" ]; then
  echo "WARN: session is not WORKING — link first: bash scripts/waha-link-whatsapp.sh"
fi

CID="$(waha_container_id)"
if [ -n "$CID" ]; then
  echo "==> Container: $CID"
  echo "==> Image: $(docker inspect -f '{{.Config.Image}}' "$CID" 2>/dev/null || echo unknown)"
  docker exec "$CID" env 2>/dev/null | grep -E '^WAHA_APPS_' || echo "==> WAHA_APPS_* not set in container (apps API may 404 until compose env is applied)"
fi

echo "==> Existing apps:"
APPS_JSON="$(curl -s -w '\n%{http_code}' -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/apps?session=$SESSION" || true)"
APPS_BODY="$(printf '%s' "$APPS_JSON" | sed '$d')"
APPS_CODE="$(printf '%s' "$APPS_JSON" | tail -1)"
echo "$APPS_BODY"
echo "==> GET /api/apps HTTP $APPS_CODE"

if [ "$APPS_CODE" = "404" ] || [ "$APPS_CODE" = "501" ]; then
  echo "ERROR: This WAHA build has no Apps API (typical of Core)."
  echo "       Outgoing rings need WAHA Plus + the voice-calls app."
  echo "       Ops agent already fails soft: it will send a voice note instead."
  echo "       Do not bounce WAHA unless you intend to re-link WhatsApp."
  exit 2
fi

if printf '%s' "$APPS_BODY" | grep -q '"app"[[:space:]]*:[[:space:]]*"calls"'; then
  echo "ERROR: The reject-only 'calls' app is already on this session."
  echo "       Remove it in the dashboard before installing voice-calls (they cannot share a session)."
  exit 3
fi

if printf '%s' "$APPS_BODY" | grep -q '"app"[[:space:]]*:[[:space:]]*"voice-calls"'; then
  echo "==> voice-calls is already installed on session $SESSION"
  exit 0
fi

echo "==> POST /api/apps voice-calls on session $SESSION"
RESP="$(curl -s -w '\n%{http_code}' -X POST \
  -H "X-Api-Key: $WAHA_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"app\":\"voice-calls\",\"session\":\"$SESSION\",\"enabled\":true,\"id\":\"$APP_ID\",\"config\":{}}" \
  "$WAHA_URL/api/apps" || true)"
BODY="$(printf '%s' "$RESP" | sed '$d')"
CODE="$(printf '%s' "$RESP" | tail -1)"
echo "$BODY"
echo "==> POST /api/apps HTTP $CODE"

if [ "$CODE" != "200" ] && [ "$CODE" != "201" ]; then
  if printf '%s' "$BODY" | grep -q 'chatwoot, calls, mcp'; then
    echo "This is WAHA Core ($WAHA_DEFAULT_IMAGE)."
    echo "Core apps are only: chatwoot, calls (reject inbound), mcp."
    echo "There is no outgoing-ring app on this image — do not install 'calls'."
    echo "Leave WAHA running (session WORKING). Do not recreate the container."
    echo "Ops agent: send_whatsapp_voice / send_video_note instead of a live call."
    echo "Real rings need WAHA Plus (devlikeapro/waha-plus) with a license."
    exit 5
  fi
  echo "ERROR: could not install voice-calls (HTTP $CODE)."
  echo "       Do not bounce WAHA unless you can re-link WhatsApp."
  exit 4
fi

echo "==> Installed. Confirm:"
curl -s -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/apps?session=$SESSION"
echo ""
echo "OK: voice-calls is on session $SESSION. place_whatsapp_call can ring known chats."
