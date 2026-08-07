#!/usr/bin/env bash
# Configure Daraja B2C initiator on the bot VM (SOKONIMA).
#
# Does NOT commit secrets. Run on the VM after downloading ProductionCertificate.cer
# from developer.safaricom.co.ke → Prod-SOKONIMALL → APIs / certificates.
#
# Usage:
#   # 1) Place cert (required to encrypt SecurityCredential):
#   mkdir -p ~/sokoni/whatsapp-bot/certs
#   # download ProductionCertificate.cer from Daraja portal → save as:
#   #   ~/sokoni/whatsapp-bot/certs/ProductionCertificate.cer
#
#   # 2) Apply initiator (password from your org portal — not web login):
#   export MPESA_INITIATOR_PASSWORD='your-initiator-password'
#   bash scripts/configure-b2c-initiator.sh
#
# Optional overrides:
#   MPESA_INITIATOR_NAME=SOKONIMA
#   MPESA_CERT_PATH=/path/to/ProductionCertificate.cer
#   SKIP_RESTART=1
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"
CERT_DEFAULT="$REPO/whatsapp-bot/certs/ProductionCertificate.cer"
CERT_PATH="${MPESA_CERT_PATH:-$CERT_DEFAULT}"
INITIATOR_NAME="${MPESA_INITIATOR_NAME:-SOKONIMA}"
B2C_SHORT="${MPESA_B2C_SHORTCODE:-3439153}"
PASSWORD="${MPESA_INITIATOR_PASSWORD:-}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE" >&2
  exit 1
fi

if [ -z "$PASSWORD" ]; then
  echo "ERROR: export MPESA_INITIATOR_PASSWORD first (API initiator password for $INITIATOR_NAME)." >&2
  echo "  This is NOT the Business Manager web login password." >&2
  exit 1
fi

# Strip accidental whitespace / surrounding quotes
PASSWORD="$(printf '%s' "$PASSWORD" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["'\'']//' -e 's/["'\'']$//')"
INITIATOR_NAME="$(printf '%s' "$INITIATOR_NAME" | tr -d '[:space:]')"

if [ ! -f "$CERT_PATH" ]; then
  echo "ERROR: production certificate not found at:" >&2
  echo "  $CERT_PATH" >&2
  echo "" >&2
  echo "Download ProductionCertificate.cer from developer.safaricom.co.ke" >&2
  echo "(Prod-SOKONIMALL → APIs / Certificates), save it there, then re-run." >&2
  exit 1
fi

# Detect HTML/error pages mistaken for a cert
if head -c 20 "$CERT_PATH" | grep -qiE '<!DOCTYPE|html'; then
  echo "ERROR: $CERT_PATH looks like an HTML page, not a .cer certificate." >&2
  exit 1
fi

echo "==> Encrypting SecurityCredential for initiator $INITIATOR_NAME"
TMP_PUB="$(mktemp)"
TMP_CRED="$(mktemp)"
cleanup() { rm -f "$TMP_PUB" "$TMP_CRED"; }
trap cleanup EXIT

# Support PEM or DER .cer
if grep -q 'BEGIN CERTIFICATE' "$CERT_PATH"; then
  openssl x509 -in "$CERT_PATH" -pubkey -noout > "$TMP_PUB"
else
  openssl x509 -inform DER -in "$CERT_PATH" -pubkey -noout > "$TMP_PUB"
fi

# Critical: printf (not echo) — no trailing newline inside the ciphertext
printf '%s' "$PASSWORD" \
  | openssl pkeyutl -encrypt -pubin -inkey "$TMP_PUB" -pkeyopt rsa_padding_mode:pkcs1 \
  | base64 -w0 > "$TMP_CRED"

CRED="$(cat "$TMP_CRED")"
if [ "${#CRED}" -lt 80 ]; then
  echo "ERROR: encrypted SecurityCredential looks too short (len=${#CRED})." >&2
  exit 1
fi

upsert() {
  local key="$1"
  local val="$2"
  local tmp
  tmp="$(mktemp)"
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}

upsert MPESA_INITIATOR_NAME "$INITIATOR_NAME"
upsert MPESA_SECURITY_CREDENTIAL "$CRED"
upsert MPESA_CERT_PATH "$CERT_PATH"
upsert MPESA_B2C_SHORTCODE "$B2C_SHORT"
upsert MPESA_B2C_COMMAND_ID "${MPESA_B2C_COMMAND_ID:-BusinessPayment}"
upsert MPESA_B2C_RESULT_URL "${MPESA_B2C_RESULT_URL:-https://bot.sokonimall.com/api/payments/daraja/b2c/result}"
upsert MPESA_B2C_TIMEOUT_URL "${MPESA_B2C_TIMEOUT_URL:-https://bot.sokonimall.com/api/payments/daraja/b2c/timeout}"
upsert ESCROW_HOLD_BUSINESS_DAYS "${ESCROW_HOLD_BUSINESS_DAYS:-0}"
upsert SELLER_WITHDRAW_INSTANT_B2C "${SELLER_WITHDRAW_INSTANT_B2C:-true}"
# Keep plaintext password out of .env once credential exists (safer).
grep -vE '^MPESA_INITIATOR_PASSWORD=' "$ENV_FILE" > "${ENV_FILE}.tmp" || true
mv "${ENV_FILE}.tmp" "$ENV_FILE"

echo "==> B2C initiator written to $ENV_FILE"
echo "    Initiator: $INITIATOR_NAME"
echo "    SecurityCredential len=${#CRED}"
echo "    Cert: $CERT_PATH"
echo "    B2C shortcode: $B2C_SHORT"
echo "    B2C URL (bot): /mpesa/b2c/v1/paymentrequest (then v3 fallback)"
echo "    Result: https://bot.sokonimall.com/api/payments/daraja/b2c/result"

if [ "${SKIP_RESTART:-}" = "1" ]; then
  echo "==> SKIP_RESTART=1 — restart bot yourself"
  exit 0
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "==> Restarting sokoni-bot"
  pm2 restart sokoni-bot --update-env
  pm2 save >/dev/null 2>&1 || true
else
  echo "WARN: pm2 not found — restart the bot process yourself"
fi

echo ""
echo "Next:"
echo "  bash scripts/test-daraja-oauth.sh"
echo "  # Then from admin WhatsApp: #payouts  then  #payb2c SKN-… for a Ready order"
echo "  # Or seller Hub → Request withdrawal (instant B2C when Ready > 0)"
