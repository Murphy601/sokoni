#!/usr/bin/env bash
# Smoke-test Daraja OAuth on the bot VM (production).
# Usage: bash scripts/test-daraja-oauth.sh
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

# Prefer values from .env file (ignore leftover shell exports like KEY='…').
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

echo "Env file: $ENV_FILE"
echo "Host: $HOST"
echo "Key length: ${#KEY}  Secret length: ${#SECRET}  Passkey length: ${#PASSKEY}  Shortcode: ${SHORTCODE:-unset}"

if [ "${#KEY}" -lt 16 ] || [ "${#SECRET}" -lt 16 ]; then
  echo "ERROR: Consumer Key/Secret in .env look wrong (too short)." >&2
  echo "  You probably exported placeholder '…' earlier. Fix with:" >&2
  echo "    unset MPESA_CONSUMER_KEY MPESA_CONSUMER_SECRET MPESA_PASSKEY" >&2
  echo "    bash scripts/set-daraja-env.sh" >&2
  echo "    bash scripts/test-daraja-oauth.sh" >&2
  exit 1
fi

echo "Requesting access_token…"

RESP="$(curl -sS -w '\nHTTP:%{http_code}' -u "${KEY}:${SECRET}" \
  "${HOST}/oauth/v1/generate?grant_type=client_credentials")"
BODY="$(printf '%s' "$RESP" | sed '$d')"
CODE="$(printf '%s' "$RESP" | tail -1 | sed 's/HTTP://')"

echo "HTTP $CODE"
echo "$BODY" | head -c 400
echo

if printf '%s' "$BODY" | grep -q 'access_token'; then
  echo "OK — OAuth works. STK should authenticate."
  exit 0
fi

echo "FAIL — no access_token from Safaricom." >&2
echo "  Confirm keys on developer.safaricom.co.ke (Prod-SOKONIMALL) and MPESA_ENV=production." >&2
exit 1
