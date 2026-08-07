#!/usr/bin/env bash
# Smoke-test Daraja OAuth on the bot VM (production).
# Usage: bash scripts/test-daraja-oauth.sh
# Or: ENV_FILE=/path/to/.env bash scripts/test-daraja-oauth.sh
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  # Only pull MPESA_* lines (avoid sourcing whole .env with special chars)
  eval "$(grep -E '^MPESA_(CONSUMER_KEY|CONSUMER_SECRET|PASSKEY|ENV|SHORTCODE)=' "$ENV_FILE" | sed 's/\r$//')"
  set +a
fi

KEY="${MPESA_CONSUMER_KEY:-}"
SECRET="${MPESA_CONSUMER_SECRET:-}"
ENV_NAME="$(echo "${MPESA_ENV:-production}" | tr '[:upper:]' '[:lower:]')"
if [ "$ENV_NAME" = "prod" ] || [ "$ENV_NAME" = "production" ] || [ -z "$ENV_NAME" ]; then
  HOST="https://api.safaricom.co.ke"
else
  HOST="https://sandbox.safaricom.co.ke"
fi

if [ -z "$KEY" ] || [ -z "$SECRET" ]; then
  echo "ERROR: MPESA_CONSUMER_KEY / MPESA_CONSUMER_SECRET not set" >&2
  exit 1
fi

# Strip whitespace that breaks Basic auth
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
SECRET="$(printf '%s' "$SECRET" | tr -d '[:space:]')"

echo "Host: $HOST"
echo "Key length: ${#KEY}  Secret length: ${#SECRET}  Shortcode: ${MPESA_SHORTCODE:-unset}"
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

echo "FAIL — no access_token. Fix Consumer Key/Secret or MPESA_ENV, then re-run set-daraja-env.sh." >&2
exit 1
