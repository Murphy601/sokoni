#!/usr/bin/env bash
# Link Sokoni WhatsApp to WAHA — pairing code (easiest) or scannable PNG QR.
# Run on the VM: bash scripts/waha-link-whatsapp.sh
set -euo pipefail

WAHA_URL="${WAHA_API_URL:-http://127.0.0.1:3000}"
WAHA_KEY="${WAHA_API_KEY:-sokoni-local-dev-key}"
SESSION="${WAHA_SESSION:-default}"
PHONE="${SOKONI_WA_PHONE:-254117422428}"
REPO="${SOKONI_REPO:-$HOME/sokoni}"
QR_OUT="${WAHA_QR_FILE:-$REPO/waha-qr.png}"

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
  curl -s -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" 2>/dev/null || echo "{}"
}

session_status() {
  json_field "$(session_json)" status
}

echo "==> WAHA at $WAHA_URL (session: $SESSION)"

if ! curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions" >/dev/null 2>&1; then
  echo "ERROR: WAHA is not running. Start it first:"
  echo "  bash scripts/deploy-waha.sh"
  exit 1
fi

if [ "${RESET_WAHA_SESSION:-}" = "1" ]; then
  echo "==> Resetting session (requires re-link)..."
  RESET_WAHA_SESSION=1 bash "$REPO/scripts/configure-waha-session.sh" || true
fi

STATUS="$(session_status)"

if [ -z "$STATUS" ]; then
  echo "==> No session yet — creating..."
  bash "$REPO/scripts/configure-waha-session.sh" || true
  STATUS="$(session_status)"
fi

echo "==> Current status: ${STATUS:-unknown}"

if [ "$STATUS" = "WORKING" ]; then
  ME="$(json_field "$(session_json)" me.id)"
  echo "==> Already linked${ME:+ as $ME}. WhatsApp should receive messages."
  exit 0
fi

if [ "$STATUS" = "FAILED" ] || [ "$STATUS" = "STOPPED" ]; then
  echo "==> Starting session from $STATUS..."
  curl -s -X POST -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION/start" >/dev/null || true
fi

echo "==> Waiting for SCAN_QR_CODE (pairing ready)..."
STATUS=""
for i in $(seq 1 40); do
  STATUS="$(session_status)"
  echo "  $i status=$STATUS"
  if [ "$STATUS" = "SCAN_QR_CODE" ] || [ "$STATUS" = "WORKING" ]; then
    break
  fi
  if [ "$STATUS" = "FAILED" ] && [ "$i" -ge 8 ]; then
    break
  fi
  sleep 2
done

if [ "$STATUS" = "WORKING" ]; then
  echo "==> Session became WORKING without re-link."
  exit 0
fi

if [ "$STATUS" != "SCAN_QR_CODE" ]; then
  echo ""
  echo "ERROR: Pairing not ready (status=$STATUS)."
  echo "       WhatsApp never reached SCAN_QR_CODE — usually WA Connection Failure."
  echo "       Check logs:"
  echo "         source scripts/lib/waha-common.sh && waha_print_recent_logs 40"
  echo "       Then retry after unlinking old devices on the phone:"
  echo "         RESET_WAHA_SESSION=1 bash scripts/waha-link-whatsapp.sh"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OPTION 1 — Pairing code (recommended, no QR scan)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "On phone (+$PHONE): WhatsApp → Settings → Linked devices"
echo "→ Link a device → Link with phone number instead"
echo ""

PAIR_JSON="$(curl -s -X POST \
  -H "X-Api-Key: $WAHA_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"phoneNumber\": \"$PHONE\"}" \
  "$WAHA_URL/api/$SESSION/auth/request-code" 2>/dev/null || echo "{}")"

CODE="$(json_field "$PAIR_JSON" code)"
if [ -n "$CODE" ]; then
  echo "  Enter this code on your phone:"
  echo ""
  echo "       $CODE"
  echo ""
else
  ERR="$(json_field "$PAIR_JSON" exception.message)"
  [ -z "$ERR" ] && ERR="$(json_field "$PAIR_JSON" message)"
  [ -z "$ERR" ] && ERR="$(json_field "$PAIR_JSON" error)"
  echo "  Pairing code failed: ${ERR:-unknown}"
  echo "  Raw: $PAIR_JSON"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OPTION 2 — Scannable QR (PNG file)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

TMP_QR="$(mktemp)"
HTTP_CODE="$(curl -s -o "$TMP_QR" -w "%{http_code}" \
  -H "X-Api-Key: $WAHA_KEY" \
  -H "Accept: image/png" \
  "$WAHA_URL/api/$SESSION/auth/qr?format=image" || true)"

if [ "$HTTP_CODE" = "200" ] && file "$TMP_QR" 2>/dev/null | grep -qi 'PNG\|image'; then
  mv "$TMP_QR" "$QR_OUT"
  echo "  Saved: $QR_OUT ($(wc -c < "$QR_OUT") bytes)"
  echo "  Download: scp USER@VM:$QR_OUT ."
else
  echo "  Could not fetch QR PNG (HTTP $HTTP_CODE)."
  echo "  Body: $(head -c 300 "$TMP_QR" 2>/dev/null || true)"
  rm -f "$TMP_QR"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  After linking, verify:"
echo "    curl -s -H \"X-Api-Key: $WAHA_KEY\" $WAHA_URL/api/sessions/$SESSION"
echo "  Expect: \"status\":\"WORKING\""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
