#!/usr/bin/env bash
# Apply production Daraja / M-Pesa env on the bot VM (run from ~/sokoni after SSH / during deploy).
#
# Prod app: Prod-SOKONIMALL · Shortcode 3439153 (SOKONIMA)
# Org roles present: Business Manager, B2C API Initiator/Caller, Balance Query,
# Transaction Status, Org Reversals, Business Paybill / Buy Goods Org API, etc.
#
# Usage:
#   bash scripts/set-daraja-env.sh
#   SKIP_RESTART=1 bash scripts/set-daraja-env.sh   # during deploy-bot.sh
#
# Override any value via env before running (e.g. MPESA_INITIATOR_NAME=…).
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE" >&2
  exit 1
fi

# --- Production Daraja app credentials (Prod-SOKONIMALL / Paybill 3439153) ---
# Override via environment if rotating keys.
MPESA_CONSUMER_KEY="${MPESA_CONSUMER_KEY:-Vqd6UhRdqlEai2qBfsnwZQ9I725JuQgYcud9C85s2IHS9DvB}"
MPESA_CONSUMER_SECRET="${MPESA_CONSUMER_SECRET:-P2ht5y63CZcAOHLc8jDSbuxu4KbTdkWmebF6DyWAKz9owJh393eseGduGaHAVhfo}"
MPESA_PASSKEY="${MPESA_PASSKEY:-ea9d0b4e609cc9ecc51aaa3c5973a0e8890efca311df7ac28af8cdafdc67285d}"

SHORTCODE="${MPESA_SHORTCODE:-3439153}"
TILL="${MPESA_TILL_NUMBER:-$SHORTCODE}"
TILL_NAME="${MPESA_TILL_NAME:-SOKONIMA}"
TX_TYPE="${MPESA_TRANSACTION_TYPE:-CustomerPayBillOnline}"
ENV_NAME="${MPESA_ENV:-production}"
CALLBACK="${MPESA_CALLBACK_URL:-https://bot.sokonimall.com/api/payments/daraja/callback}"
B2C_SHORT="${MPESA_B2C_SHORTCODE:-$SHORTCODE}"
B2C_RESULT="${MPESA_B2C_RESULT_URL:-https://bot.sokonimall.com/api/payments/daraja/b2c/result}"
B2C_TIMEOUT="${MPESA_B2C_TIMEOUT_URL:-https://bot.sokonimall.com/api/payments/daraja/b2c/timeout}"
B2C_CMD="${MPESA_B2C_COMMAND_ID:-BusinessPayment}"
B2C_AUTO="${MPESA_B2C_AUTO:-false}"

upsert() {
  local key="$1"
  local val="$2"
  local tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    local esc
    esc="$(printf '%s' "$val" | sed -e 's/[&\\]/\\&/g')"
    sed -E "s|^${key}=.*|${key}=${esc}|" "$ENV_FILE" > "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
    rm -f "$tmp"
  fi
}

# Remove legacy personal till if still hanging around as the only till value.
if grep -qE '^MPESA_TILL_NUMBER=4775847' "$ENV_FILE" 2>/dev/null; then
  echo "==> Replacing legacy till 4775847 with $SHORTCODE"
fi

upsert MPESA_CONSUMER_KEY "$MPESA_CONSUMER_KEY"
upsert MPESA_CONSUMER_SECRET "$MPESA_CONSUMER_SECRET"
upsert MPESA_PASSKEY "$MPESA_PASSKEY"
upsert MPESA_SHORTCODE "$SHORTCODE"
upsert MPESA_TILL_NUMBER "$TILL"
upsert MPESA_TILL_NAME "$TILL_NAME"
upsert MPESA_ENV "$ENV_NAME"
upsert MPESA_TRANSACTION_TYPE "$TX_TYPE"
upsert MPESA_CALLBACK_URL "$CALLBACK"
upsert MPESA_B2C_SHORTCODE "$B2C_SHORT"
upsert MPESA_B2C_RESULT_URL "$B2C_RESULT"
upsert MPESA_B2C_TIMEOUT_URL "$B2C_TIMEOUT"
upsert MPESA_B2C_COMMAND_ID "$B2C_CMD"
upsert MPESA_B2C_AUTO "$B2C_AUTO"

# Optional B2C initiator — only upsert when provided (org role: B2C API Initiator/Caller).
if [ -n "${MPESA_INITIATOR_NAME:-}" ]; then
  upsert MPESA_INITIATOR_NAME "$MPESA_INITIATOR_NAME"
fi
if [ -n "${MPESA_SECURITY_CREDENTIAL:-}" ]; then
  upsert MPESA_SECURITY_CREDENTIAL "$MPESA_SECURITY_CREDENTIAL"
fi
if [ -n "${MPESA_INITIATOR_PASSWORD:-}" ]; then
  upsert MPESA_INITIATOR_PASSWORD "$MPESA_INITIATOR_PASSWORD"
fi
if [ -n "${MPESA_CERT_PATH:-}" ]; then
  upsert MPESA_CERT_PATH "$MPESA_CERT_PATH"
fi

echo "==> Updated Daraja production config in $ENV_FILE"
echo "    Shortcode: $SHORTCODE ($TILL_NAME) · STK: $TX_TYPE · Env: $ENV_NAME"
echo "    STK callback: $CALLBACK"
echo "    B2C shortcode: $B2C_SHORT · result: $B2C_RESULT"
if grep -qE '^MPESA_INITIATOR_NAME=.' "$ENV_FILE" 2>/dev/null && \
   { grep -qE '^MPESA_SECURITY_CREDENTIAL=.' "$ENV_FILE" 2>/dev/null || \
     grep -qE '^MPESA_INITIATOR_PASSWORD=.' "$ENV_FILE" 2>/dev/null; }; then
  echo "    B2C initiator: configured"
else
  echo "    B2C initiator: not set yet (STK checkout works; seller #payb2c needs MPESA_INITIATOR_NAME + SECURITY_CREDENTIAL)"
fi

if [ "${SKIP_RESTART:-}" = "1" ]; then
  echo "==> SKIP_RESTART=1 — bot restart left to deploy / pm2"
  exit 0
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "==> Restarting sokoni-bot"
  pm2 restart sokoni-bot --update-env
  pm2 save >/dev/null 2>&1 || true
else
  echo "WARN: pm2 not found — restart the bot process yourself"
fi
