#!/usr/bin/env bash
# Smoke-test Daraja STK push using whatsapp-bot/.env (production).
# Usage:
#   bash scripts/test-daraja-stk.sh 2547XXXXXXXX
# Optional amount: AMOUNT_KES=1 bash scripts/test-daraja-stk.sh 2547XXXXXXXX
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"
PHONE="${1:-}"
AMOUNT="${AMOUNT_KES:-1}"

if [ -z "$PHONE" ]; then
  echo "Usage: bash scripts/test-daraja-stk.sh 2547XXXXXXXX" >&2
  exit 1
fi

env_get() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | sed -E "s/^${key}=//" | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//' | tr -d '[:space:]'
}

KEY="$(env_get MPESA_CONSUMER_KEY)"
SECRET="$(env_get MPESA_CONSUMER_SECRET)"
PASSKEY="$(env_get MPESA_PASSKEY)"
SHORTCODE="$(env_get MPESA_SHORTCODE)"
PARTY_B="$(env_get MPESA_PARTY_B)"
TILL="$(env_get MPESA_TILL_NUMBER)"
TX="$(env_get MPESA_TRANSACTION_TYPE)"
CALLBACK="$(env_get MPESA_CALLBACK_URL)"
ENV_NAME="$(env_get MPESA_ENV | tr '[:upper:]' '[:lower:]')"

PARTY_B="${PARTY_B:-$TILL}"
TX="${TX:-CustomerBuyGoodsOnline}"
CALLBACK="${CALLBACK:-https://bot.sokonimall.com/api/payments/daraja/callback}"

if [ "$ENV_NAME" = "sandbox" ]; then
  HOST="https://sandbox.safaricom.co.ke"
else
  HOST="https://api.safaricom.co.ke"
fi

PHONE="$(printf '%s' "$PHONE" | tr -d '[:space:]')"
case "$PHONE" in
  0*) PHONE="254${PHONE:1}" ;;
  7*|1*) PHONE="254${PHONE}" ;;
esac

echo "Host: $HOST"
echo "SHORTCODE(BusinessShortCode)=$SHORTCODE  PARTY_B=$PARTY_B  TILL=$TILL  TX=$TX"
echo "Phone=$PHONE Amount=$AMOUNT Callback=$CALLBACK"
echo

echo "==> OAuth"
TOKEN_JSON="$(curl -sS -u "${KEY}:${SECRET}" "${HOST}/oauth/v1/generate?grant_type=client_credentials")"
echo "$TOKEN_JSON" | head -c 200; echo
TOKEN="$(printf '%s' "$TOKEN_JSON" | sed -n 's/.*"access_token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -z "$TOKEN" ]; then
  echo "FAIL: no access_token" >&2
  exit 1
fi

TS="$(TZ=Africa/Nairobi date +%Y%m%d%H%M%S)"
PASSWORD="$(printf '%s' "${SHORTCODE}${PASSKEY}${TS}" | openssl base64 -A)"

BODY="$(cat <<JSON
{
  "BusinessShortCode": "${SHORTCODE}",
  "Password": "${PASSWORD}",
  "Timestamp": "${TS}",
  "TransactionType": "${TX}",
  "Amount": ${AMOUNT},
  "PartyA": "${PHONE}",
  "PartyB": "${PARTY_B}",
  "PhoneNumber": "${PHONE}",
  "CallBackURL": "${CALLBACK}",
  "AccountReference": "SKNTEST",
  "TransactionDesc": "Sokoni test"
}
JSON
)"

echo
echo "==> STK processrequest"
echo "$BODY" | sed 's/"Password": "[^"]*"/"Password": "***"/'
echo
RESP="$(curl -sS -w '\nHTTP:%{http_code}' -X POST "${HOST}/mpesa/stkpush/v1/processrequest" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$BODY")"
echo "$RESP"
echo

if printf '%s' "$RESP" | grep -q '"ResponseCode"[[:space:]]*:[[:space:]]*"0"'; then
  echo "OK — STK accepted. Check the phone for PIN prompt."
  exit 0
fi

echo "FAIL — STK rejected. Read errorMessage / ResponseDescription above." >&2
echo "If 'Agent number and Store number do not match': try PARTY_B=4421485 (merchant store) instead of till." >&2
exit 1
