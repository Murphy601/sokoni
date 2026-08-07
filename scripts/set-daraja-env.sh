#!/usr/bin/env bash
# Apply production Daraja / M-Pesa env on the bot VM (run from ~/sokoni after SSH / during deploy).
#
# Prod app: Prod-SOKONIMALL · Shortcode 3439153 (SOKONIMA)
#
# Usage (recommended — uses baked-in Prod-SOKONIMALL keys):
#   unset MPESA_CONSUMER_KEY MPESA_CONSUMER_SECRET
#   bash scripts/set-daraja-env.sh
#
# Do NOT export placeholder dots like '…' — that overwrites real keys with 1-char junk.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE" >&2
  exit 1
fi

# --- Production Daraja (org H.O. 3439153) + Buy Goods Till 4775847 ---
# Hierarchy: org/Daraja 3439153 → merchant store 4421485 → till 4775847
# STK uses SHORTCODE (password) + TILL (PartyB). Store 4421485 is not sent on STK.
DEFAULT_KEY="Vqd6UhRdqlEai2qBfsnwZQ9I725JuQgYcud9C85s2IHS9DvB"
DEFAULT_SECRET="P2ht5y63CZcAOHLc8jDSbuxu4KbTdkWmebF6DyWAKz9owJh393eseGduGaHAVhfo"
DEFAULT_PASSKEY="ea9d0b4e609cc9ecc51aaa3c5973a0e8890efca311df7ac28af8cdafdc67285d"

# Accept an override only if it looks like a real key (not '…', '...', empty, or tiny).
pick_cred() {
  local raw="$1"
  local fallback="$2"
  local label="$3"
  # Strip whitespace / surrounding quotes
  raw="$(printf '%s' "$raw" | tr -d '[:space:]' | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
  case "$raw" in
    ""|"…"|"..."|"<"*|*"your"*|*"YOUR"*|"changeme"|"TODO"|"xxx"|"XXX")
      if [ -n "$raw" ]; then
        echo "==> Ignoring invalid ${label} override (placeholder) — using production default" >&2
      fi
      printf '%s' "$fallback"
      return
      ;;
  esac
  if [ "${#raw}" -lt 16 ]; then
    echo "==> Ignoring invalid ${label} override (len=${#raw}, need ≥16) — using production default" >&2
    printf '%s' "$fallback"
    return
  fi
  printf '%s' "$raw"
}

MPESA_CONSUMER_KEY="$(pick_cred "${MPESA_CONSUMER_KEY:-}" "$DEFAULT_KEY" "MPESA_CONSUMER_KEY")"
MPESA_CONSUMER_SECRET="$(pick_cred "${MPESA_CONSUMER_SECRET:-}" "$DEFAULT_SECRET" "MPESA_CONSUMER_SECRET")"
MPESA_PASSKEY="$(pick_cred "${MPESA_PASSKEY:-}" "$DEFAULT_PASSKEY" "MPESA_PASSKEY")"

SHORTCODE="${MPESA_SHORTCODE:-3439153}"
TILL="${MPESA_TILL_NUMBER:-4775847}"
TILL_NAME="${MPESA_TILL_NAME:-David Thuku Muiruri}"
PARTY_B="${MPESA_PARTY_B:-$TILL}"
TX_TYPE="${MPESA_TRANSACTION_TYPE:-CustomerBuyGoodsOnline}"
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
  # Remove every existing line for this key, then append once.
  # Do NOT use awk -v for values — gawk can mangle backslashes / long secrets.
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}

if grep -qE '^MPESA_TILL_NUMBER=3439153$' "$ENV_FILE" 2>/dev/null; then
  echo "==> Restoring Buy Goods Till 4775847 (was wrongly set to org shortcode 3439153)"
fi

upsert MPESA_CONSUMER_KEY "$MPESA_CONSUMER_KEY"
upsert MPESA_CONSUMER_SECRET "$MPESA_CONSUMER_SECRET"
upsert MPESA_PASSKEY "$MPESA_PASSKEY"
upsert MPESA_SHORTCODE "$SHORTCODE"
upsert MPESA_TILL_NUMBER "$TILL"
upsert MPESA_TILL_NAME "$TILL_NAME"
upsert MPESA_PARTY_B "$PARTY_B"
upsert MPESA_ENV "$ENV_NAME"
upsert MPESA_TRANSACTION_TYPE "$TX_TYPE"
upsert MPESA_CALLBACK_URL "$CALLBACK"
upsert MPESA_B2C_SHORTCODE "$B2C_SHORT"
upsert MPESA_B2C_RESULT_URL "$B2C_RESULT"
upsert MPESA_B2C_TIMEOUT_URL "$B2C_TIMEOUT"
upsert MPESA_B2C_COMMAND_ID "$B2C_CMD"
upsert MPESA_B2C_AUTO "$B2C_AUTO"

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
echo "    Key len=${#MPESA_CONSUMER_KEY}  Secret len=${#MPESA_CONSUMER_SECRET}  Passkey len=${#MPESA_PASSKEY}"
echo "    Org/Daraja SHORTCODE (BusinessShortCode): $SHORTCODE"
echo "    Buy Goods TILL (PartyB): $TILL ($TILL_NAME) · STK: $TX_TYPE · Env: $ENV_NAME"
echo "    Merchant store 4421485 is not used in STK payload"
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
