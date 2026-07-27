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

echo "==> WAHA at $WAHA_URL (session: $SESSION)"

if ! curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions" >/dev/null 2>&1; then
  echo "ERROR: WAHA is not running. Start it first:"
  echo "  bash scripts/deploy-waha.sh"
  exit 1
fi

if [ "${RESET_WAHA_SESSION:-}" = "1" ]; then
  echo "==> Resetting session (requires re-link)..."
  bash "$REPO/scripts/configure-waha-session.sh"
fi

SESSION_JSON="$(curl -sf -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION" 2>/dev/null || echo "{}")"
STATUS="$(json_field "$SESSION_JSON" status)"
echo "==> Current status: ${STATUS:-unknown}"

if [ "$STATUS" = "WORKING" ]; then
  ME="$(json_field "$SESSION_JSON" me.id)"
  echo "==> Already linked${ME:+ as $ME}. WhatsApp should receive messages."
  exit 0
fi

echo "==> Starting session..."
curl -sf -X POST -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL/api/sessions/$SESSION/start" >/dev/null 2>&1 || true
sleep 3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OPTION 1 — Pairing code (recommended, no QR scan)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "On phone (+$PHONE): WhatsApp → Settings → Linked devices"
echo "→ Link a device → Link with phone number instead"
echo ""

PAIR_JSON="$(curl -sf -X POST \
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
  echo "  Pairing code not available right now ($(json_field "$PAIR_JSON" message || echo 'try QR below'))"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OPTION 2 — Scannable QR (PNG file, not docker logs)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if curl -sf \
  -H "X-Api-Key: $WAHA_KEY" \
  -H "Accept: image/png" \
  "$WAHA_URL/api/$SESSION/auth/qr?format=image" \
  -o "$QR_OUT"; then
  echo "  Saved: $QR_OUT"
  echo ""
  echo "  Download to your PC, then open the image on your phone and scan:"
  echo "    scp daviemuiruri3888@sokoni-bot:$QR_OUT ."
  echo ""
  echo "  Or on your PC, SSH tunnel then open in browser:"
  echo "    ssh -L 3000:127.0.0.1:3000 daviemuiruri3888@sokoni-bot"
  echo "    http://localhost:3000/api/default/auth/qr?x-api-key=$WAHA_KEY"
  echo ""
  echo "  Or WAHA dashboard (after tunnel):"
  echo "    http://localhost:3000/dashboard  (admin / sokoni)"
else
  echo "  Could not fetch QR PNG — wait 5s and run this script again."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  After linking, verify:"
echo "    curl -s -H \"X-Api-Key: $WAHA_KEY\" $WAHA_URL/api/sessions/$SESSION"
echo "  Expect: \"status\":\"WORKING\""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
