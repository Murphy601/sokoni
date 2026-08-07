#!/usr/bin/env bash
# Smoke-test Daraja OAuth on the bot VM (production).
# Usage: bash scripts/test-daraja-oauth.sh
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

env_get() {
  local key="$1"
  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | sed -E "s/^${key}=//" | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

KEY="$(env_get MPESA_CONSUMER_KEY)"
SECRET="$(env_get MPESA_CONSUMER_SECRET)"
PASSKEY="$(env_get MPESA_PASSKEY)"
SHORTCODE="$(env_get MPESA_SHORTCODE)"
ENV_NAME="$(env_get MPESA_ENV | tr '[:upper:]' '[:lower:]')"

KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
SECRET="$(printf '%s' "$SECRET" | tr -d '[:space:]')"

if [ "$ENV_NAME" = "prod" ] || [ "$ENV_NAME" = "production" ] || [ -z "$ENV_NAME" ]; then
  HOST="https://api.safaricom.co.ke"
else
  HOST="https://sandbox.safaricom.co.ke"
fi

KEY_FP="$(printf '%s' "$KEY" | sha256sum | cut -c1-16)"
SECRET_FP="$(printf '%s' "$SECRET" | sha256sum | cut -c1-16)"

echo "Env file: $ENV_FILE"
echo "Host: $HOST"
echo "Key length: ${#KEY}  Secret length: ${#SECRET}  Passkey length: ${#PASSKEY}  Shortcode: ${SHORTCODE:-unset}"
echo "Key fingerprint (sha256…16): $KEY_FP"
echo "Secret fingerprint (sha256…16): $SECRET_FP"

if [ "${#KEY}" -lt 32 ] || [ "${#SECRET}" -lt 32 ]; then
  echo "ERROR: Consumer Key/Secret in .env look wrong (Key len=${#KEY}, Secret len=${#SECRET})." >&2
  echo "  If you see len 22, you pasted the instruction text paste-from-portal-copy." >&2
  echo "  Use portal Copy → file: bash scripts/apply-daraja-keys-from-file.sh /tmp/daraja-keys.txt" >&2
  exit 1
fi

URL="${HOST}/oauth/v1/generate?grant_type=client_credentials"
echo "Requesting access_token…"
echo "URL: $URL"

HDR="$(mktemp)"
BODY_FILE="$(mktemp)"
CODE="$(curl -sS -D "$HDR" -o "$BODY_FILE" -w '%{http_code}' -X GET \
  -u "${KEY}:${SECRET}" \
  -H 'Accept: application/json' \
  "$URL" || echo "000")"
BODY="$(cat "$BODY_FILE")"

echo "HTTP $CODE"
echo "--- response headers (trimmed) ---"
grep -iE '^(HTTP/|content-type:|x-request-id:|www-authenticate:|date:)' "$HDR" || head -n 15 "$HDR"
echo "--- body ---"
if [ -n "$BODY" ]; then
  echo "$BODY" | head -c 500
  echo
else
  echo "(empty body)"
fi
rm -f "$HDR" "$BODY_FILE"

if printf '%s' "$BODY" | grep -q 'access_token'; then
  echo "OK — OAuth works. STK should authenticate."
  exit 0
fi

echo "FAIL — no access_token from Safaricom." >&2
echo "" >&2
echo "Lengths look fine but Safaricom still rejected Key:Secret." >&2
echo "Do this in order:" >&2
echo "  1) Portal Copy buttons → 3-line file (do NOT reuse chat/OCR strings):" >&2
echo "       nano /tmp/daraja-keys.txt     # line1=Key line2=Secret line3=Passkey" >&2
echo "       bash scripts/apply-daraja-keys-from-file.sh /tmp/daraja-keys.txt" >&2
echo "       bash scripts/test-daraja-oauth.sh" >&2
echo "  2) In the same app, confirm product 'M-Pesa Express (STK Push)' / Lipa Na M-Pesa Online is attached." >&2
echo "  3) Portal → regenerate Consumer Key & Secret, Copy again into the file, re-apply." >&2
echo "  4) If this app was created today and still 400: email apisupport@safaricom.co.ke" >&2
echo "     with app name Prod-SOKONIMALL-…, shortcode 3439153, and the x-request-id above." >&2
echo "  Org portal roles (Business Manager, B2C, etc.) do NOT fix OAuth." >&2
exit 1
