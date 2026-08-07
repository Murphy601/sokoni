#!/usr/bin/env bash
# Update Daraja / M-Pesa env on the bot VM (run from ~/sokoni after SSH).
# Never commit real Consumer Key / Secret / Passkey to git.
#
# Usage:
#   export MPESA_CONSUMER_KEY='…'
#   export MPESA_CONSUMER_SECRET='…'
#   export MPESA_PASSKEY='…'
#   bash scripts/set-daraja-env.sh
#
# Optional overrides: MPESA_SHORTCODE, MPESA_TILL_NUMBER, MPESA_TILL_NAME,
# MPESA_TRANSACTION_TYPE, MPESA_ENV, ENV_FILE, SKIP_RESTART=1
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE" >&2
  exit 1
fi

: "${MPESA_CONSUMER_KEY:?Set MPESA_CONSUMER_KEY}"
: "${MPESA_CONSUMER_SECRET:?Set MPESA_CONSUMER_SECRET}"
: "${MPESA_PASSKEY:?Set MPESA_PASSKEY}"

SHORTCODE="${MPESA_SHORTCODE:-3439153}"
TILL="${MPESA_TILL_NUMBER:-$SHORTCODE}"
TILL_NAME="${MPESA_TILL_NAME:-SOKONIMA}"
TX_TYPE="${MPESA_TRANSACTION_TYPE:-CustomerPayBillOnline}"
ENV_NAME="${MPESA_ENV:-production}"
CALLBACK="${MPESA_CALLBACK_URL:-https://bot.sokonimall.com/api/payments/daraja/callback}"

upsert() {
  local key="$1"
  local val="$2"
  local tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # Escape & \ for sed replacement; values should not contain newlines.
    local esc
    esc="$(printf '%s' "$val" | sed -e 's/[&\\]/\\&/g')"
    sed -E "s|^${key}=.*|${key}=${esc}|" "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
    rm -f "$tmp"
  fi
}

# Drop legacy personal till name if still present as a comment-only leftover — upsert handles keys.
upsert MPESA_CONSUMER_KEY "$MPESA_CONSUMER_KEY"
upsert MPESA_CONSUMER_SECRET "$MPESA_CONSUMER_SECRET"
upsert MPESA_PASSKEY "$MPESA_PASSKEY"
upsert MPESA_SHORTCODE "$SHORTCODE"
upsert MPESA_TILL_NUMBER "$TILL"
upsert MPESA_TILL_NAME "$TILL_NAME"
upsert MPESA_ENV "$ENV_NAME"
upsert MPESA_TRANSACTION_TYPE "$TX_TYPE"
upsert MPESA_CALLBACK_URL "$CALLBACK"
# Same shortcode for B2C unless already set to something else and you override.
if ! grep -qE '^MPESA_B2C_SHORTCODE=.' "$ENV_FILE" 2>/dev/null; then
  upsert MPESA_B2C_SHORTCODE "$SHORTCODE"
fi

echo "==> Updated Daraja keys in $ENV_FILE"
echo "    Shortcode/Till: $SHORTCODE / $TILL ($TILL_NAME)"
echo "    Env: $ENV_NAME · STK type: $TX_TYPE"
echo "    Callback: $CALLBACK"

if [ "${SKIP_RESTART:-}" = "1" ]; then
  echo "==> SKIP_RESTART=1 — restart bot manually when ready"
  exit 0
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "==> Restarting sokoni-bot"
  pm2 restart sokoni-bot --update-env
  pm2 save >/dev/null 2>&1 || true
else
  echo "WARN: pm2 not found — restart the bot process yourself"
fi
