#!/usr/bin/env bash
# Apply production Daraja / M-Pesa env on the bot VM (run from ~/sokoni after SSH / during deploy).
#
# Prod app: Prod-SOKONIMALL · Org shortcode 3439153 · Buy Goods till 4775847
#
# Credentials are NEVER baked into this repo. Provide them once from the portal
# Copy buttons, then deploy keeps whatever is already in whatsapp-bot/.env.
#
# First-time / after regenerate — paste the REAL values from the portal Copy buttons
# (Key ~48 chars, Secret ~64, Passkey ~64). Example shape only:
#   export MPESA_CONSUMER_KEY='Vqd6…9DvB'          # full 48-char key from portal
#   export MPESA_CONSUMER_SECRET='P2ht…Vhfo'       # full 64-char secret
#   export MPESA_PASSKEY='ea9d…285d'               # full 64-char passkey for 3439153
#   bash scripts/set-daraja-env.sh && bash scripts/test-daraja-oauth.sh
#
# Later deploys: just run this script (or deploy-bot.sh) — it keeps existing keys.
#
# Do NOT export instruction text like paste-from-portal-copy (that is len 22 junk).
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

env_get() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | sed -E "s/^${key}=//" | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

clean_cred() {
  printf '%s' "$1" | tr -d '[:space:]' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

is_placeholder() {
  local raw="$1"
  case "$raw" in
    ""|"…"|"..."|"<"*|*"your"*|*"YOUR"*|"changeme"|"TODO"|"xxx"|"XXX") return 0 ;;
    # Instruction text people paste by mistake (not real portal keys)
    paste-from-portal*|paste-passkey*|*portal-copy*|*from-portal*) return 0 ;;
  esac
  # Real Prod-SOKONIMALL Consumer Key is 48 chars; Secret/Passkey 64. Reject short junk.
  [ "${#raw}" -lt 32 ]
}

cred_sha16() {
  printf '%s' "$1" | sha256sum | cut -c1-16
}

# Prefer explicit env export; else keep value already in .env.
resolve_cred() {
  local label="$1"
  local from_env="$2"
  local from_file="$3"
  local picked=""

  from_env="$(clean_cred "$from_env")"
  from_file="$(clean_cred "$from_file")"

  if ! is_placeholder "$from_env"; then
    picked="$from_env"
  elif ! is_placeholder "$from_file"; then
    picked="$from_file"
  else
    echo "ERROR: ${label} missing or still a placeholder (len=${#from_env})." >&2
    echo "  Do NOT paste the words paste-from-portal-copy — paste the real values" >&2
    echo "  from developer.safaricom.co.ke → Apps → Prod-SOKONIMALL (Copy buttons)." >&2
    echo "  Expect Key len≈48, Secret len≈64, Passkey len≈64, then:" >&2
    echo "    export MPESA_CONSUMER_KEY='…real key…'" >&2
    echo "    export MPESA_CONSUMER_SECRET='…real secret…'" >&2
    echo "    export MPESA_PASSKEY='…real passkey…'" >&2
    echo "    bash scripts/set-daraja-env.sh && bash scripts/test-daraja-oauth.sh" >&2
    exit 1
  fi

  printf '%s' "$picked"
}

MPESA_CONSUMER_KEY="$(resolve_cred MPESA_CONSUMER_KEY "${MPESA_CONSUMER_KEY:-}" "$(env_get MPESA_CONSUMER_KEY)")"
MPESA_CONSUMER_SECRET="$(resolve_cred MPESA_CONSUMER_SECRET "${MPESA_CONSUMER_SECRET:-}" "$(env_get MPESA_CONSUMER_SECRET)")"
MPESA_PASSKEY="$(resolve_cred MPESA_PASSKEY "${MPESA_PASSKEY:-}" "$(env_get MPESA_PASSKEY)")"

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
# Instant Seller Hub Ready on delivery (0). Set 3 for Depop-style hold.
HOLD_DAYS="${ESCROW_HOLD_BUSINESS_DAYS:-0}"
WITHDRAW_B2C="${SELLER_WITHDRAW_INSTANT_B2C:-true}"

upsert() {
  local key="$1"
  local val="$2"
  local tmp
  tmp="$(mktemp)"
  # Remove every existing line for this key, then append once.
  # Do NOT use awk -v / sed for values — they can mangle long secrets.
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
upsert ESCROW_HOLD_BUSINESS_DAYS "$HOLD_DAYS"
upsert SELLER_WITHDRAW_INSTANT_B2C "$WITHDRAW_B2C"

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
echo "    Key fingerprint (sha256…16): $(cred_sha16 "$MPESA_CONSUMER_KEY")"
echo "    Org/Daraja SHORTCODE (BusinessShortCode): $SHORTCODE"
echo "    Buy Goods TILL (PartyB): $TILL ($TILL_NAME) · STK: $TX_TYPE · Env: $ENV_NAME"
echo "    Merchant store 4421485 is not used in STK payload"
echo "    STK callback: $CALLBACK"
echo "    B2C shortcode: $B2C_SHORT · result: $B2C_RESULT"
echo "    Org API roles (Business Manager, B2C initiator, Buy Goods Org API, etc.) are"
echo "    toggled in the Safaricom org portal — not in this .env. Buyer STK only needs"
echo "    Consumer Key + Secret + Passkey + shortcode/till mapping above."
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
