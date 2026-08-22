#!/usr/bin/env bash
# Configure Daraja B2C initiator on the bot VM (DavidMuiruri).
#
# Does NOT commit secrets.
#
# Option A — portal already gave you an encrypted SecurityCredential:
#   export MPESA_INITIATOR_NAME=DavidMuiruri
#   export MPESA_SECURITY_CREDENTIAL='…long base64…'   # generated FOR that username
#   bash scripts/configure-b2c-initiator.sh
#
# Option B — encrypt locally with ProductionCertificate.cer from Daraja:
#   # Download the .cer from developer.safaricom.co.ke (NOT the Postman JSON)
#   mkdir -p ~/sokoni/whatsapp-bot/certs
#   # save as: ~/sokoni/whatsapp-bot/certs/ProductionCertificate.cer
#   export MPESA_INITIATOR_NAME=DavidMuiruri
#   export MPESA_INITIATOR_PASSWORD='your-initiator-password'
#   bash scripts/configure-b2c-initiator.sh
#
# Note: Old GitHub/npm "production-cert.cer" files expired in 2018 — reject them.
# Note: SOKONIMA SecurityCredential will NOT work for DavidMuiruri — regenerate.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"
CERT_DEFAULT="$REPO/whatsapp-bot/certs/ProductionCertificate.cer"
CERT_PATH="${MPESA_CERT_PATH:-$CERT_DEFAULT}"
INITIATOR_NAME="${MPESA_INITIATOR_NAME:-DavidMuiruri}"
# Do not default to Buy Goods 3439153 — that shortcode cannot B2C.
B2C_SHORT="${MPESA_B2C_SHORTCODE:-}"
PASSWORD="${MPESA_INITIATOR_PASSWORD:-}"
PREMADE_CRED="${MPESA_SECURITY_CREDENTIAL:-}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE" >&2
  exit 1
fi

INITIATOR_NAME="$(printf '%s' "$INITIATOR_NAME" | tr -d '[:space:]')"
PASSWORD="$(printf '%s' "$PASSWORD" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["'\'']//' -e 's/["'\'']$//')"
PREMADE_CRED="$(printf '%s' "$PREMADE_CRED" | tr -d '[:space:]')"

case "$PREMADE_CRED" in
  PASTE_*|paste-*|*PORTAL_COPY*|*portal-copy*|*COPY_BUTTON*)
    echo "ERROR: MPESA_SECURITY_CREDENTIAL is instruction text, not the portal value." >&2
    echo "  In Daraja → Security Credential → use Copy Credentials, then:" >&2
    echo "  export MPESA_SECURITY_CREDENTIAL='…long base64…'" >&2
    exit 1
    ;;
esac

upsert() {
  local key="$1"
  local val="$2"
  local tmp
  tmp="$(mktemp)"
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}

CRED=""

if [ "${#PREMADE_CRED}" -ge 80 ]; then
  echo "==> Using pre-generated MPESA_SECURITY_CREDENTIAL (len=${#PREMADE_CRED})"
  CRED="$PREMADE_CRED"
else
  if [ -z "$PASSWORD" ]; then
    echo "ERROR: need either:" >&2
    echo "  export MPESA_SECURITY_CREDENTIAL='…'   # from Daraja portal Security Credential tool" >&2
    echo "  OR" >&2
    echo "  export MPESA_INITIATOR_PASSWORD='…' + ProductionCertificate.cer on disk" >&2
    exit 1
  fi

  if [ ! -f "$CERT_PATH" ]; then
    echo "ERROR: production certificate not found at:" >&2
    echo "  $CERT_PATH" >&2
    echo "" >&2
    echo "The Postman collection JSON is NOT the certificate." >&2
    echo "Download ProductionCertificate.cer from developer.safaricom.co.ke:" >&2
    echo "  Apps → Prod-SOKONIMALL → APIs / go-live docs → Production Certificate" >&2
    echo "Save it exactly as:" >&2
    echo "  $CERT_PATH" >&2
    echo "Then re-run this script." >&2
    exit 1
  fi

  # Detect wrong file types (HTML, Postman JSON, etc.)
  if head -c 40 "$CERT_PATH" | grep -qiE '<!DOCTYPE|html|postman_collection|\{'; then
    echo "ERROR: $CERT_PATH is not a certificate file (looks like HTML/JSON)." >&2
    echo "  You need the .cer from Daraja, not the Postman collection." >&2
    exit 1
  fi

  TMP_PUB="$(mktemp)"
  TMP_CRED="$(mktemp)"
  cleanup() { rm -f "$TMP_PUB" "$TMP_CRED"; }
  trap cleanup EXIT

  if grep -q 'BEGIN CERTIFICATE' "$CERT_PATH"; then
    OPENSSL_IN=(-in "$CERT_PATH")
  else
    OPENSSL_IN=(-inform DER -in "$CERT_PATH")
  fi

  # Reject expired / ancient tutorial certs (common 2017–2018 npm copies)
  END_DATE="$(openssl x509 "${OPENSSL_IN[@]}" -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
  if [ -n "$END_DATE" ]; then
    END_EPOCH="$(date -d "$END_DATE" +%s 2>/dev/null || true)"
    NOW_EPOCH="$(date +%s)"
    if [ -n "$END_EPOCH" ] && [ "$END_EPOCH" -lt "$NOW_EPOCH" ]; then
      echo "ERROR: certificate expired on $END_DATE — will cause B2C error 2001." >&2
      echo "  Download a FRESH ProductionCertificate.cer from the Daraja portal (not GitHub/npm)." >&2
      exit 1
    fi
    echo "==> Cert valid until: $END_DATE"
  fi

  openssl x509 "${OPENSSL_IN[@]}" -pubkey -noout > "$TMP_PUB"
  echo "==> Encrypting SecurityCredential for initiator $INITIATOR_NAME"
  printf '%s' "$PASSWORD" \
    | openssl pkeyutl -encrypt -pubin -inkey "$TMP_PUB" -pkeyopt rsa_padding_mode:pkcs1 \
    | base64 -w0 > "$TMP_CRED"
  CRED="$(cat "$TMP_CRED")"
fi

if [ "${#CRED}" -lt 80 ]; then
  echo "ERROR: SecurityCredential looks too short (len=${#CRED})." >&2
  exit 1
fi

if [ "$B2C_SHORT" = "3439153" ]; then
  echo "ERROR: MPESA_B2C_SHORTCODE=3439153 is Buy Goods / C2B-only and cannot B2C." >&2
  echo "  Apply for a B2C/Bulk/One Account shortcode, then:" >&2
  echo "  export MPESA_B2C_SHORTCODE='YOUR_B2C_SHORTCODE'" >&2
  exit 1
fi

upsert MPESA_INITIATOR_NAME "$INITIATOR_NAME"
upsert MPESA_SECURITY_CREDENTIAL "$CRED"
upsert MPESA_CERT_PATH "$CERT_PATH"
if [ -n "$B2C_SHORT" ]; then
  upsert MPESA_B2C_SHORTCODE "$B2C_SHORT"
else
  echo "WARN: MPESA_B2C_SHORTCODE not set — initiator saved, but B2C stays disabled until you set a B2C/One Account shortcode."
fi
upsert MPESA_B2C_COMMAND_ID "${MPESA_B2C_COMMAND_ID:-BusinessPayment}"
upsert MPESA_B2C_RESULT_URL "${MPESA_B2C_RESULT_URL:-https://bot.sokonimall.com/api/payments/daraja/b2c/result}"
upsert MPESA_B2C_TIMEOUT_URL "${MPESA_B2C_TIMEOUT_URL:-https://bot.sokonimall.com/api/payments/daraja/b2c/timeout}"
upsert ESCROW_HOLD_BUSINESS_DAYS "${ESCROW_HOLD_BUSINESS_DAYS:-0}"
upsert SELLER_WITHDRAW_INSTANT_B2C "${SELLER_WITHDRAW_INSTANT_B2C:-true}"
grep -vE '^MPESA_INITIATOR_PASSWORD=' "$ENV_FILE" > "${ENV_FILE}.tmp" || true
mv "${ENV_FILE}.tmp" "$ENV_FILE"

echo "==> B2C initiator written to $ENV_FILE"
echo "    Initiator: $INITIATOR_NAME"
echo "    SecurityCredential len=${#CRED}"
echo "    B2C shortcode: ${B2C_SHORT:-NOT SET} · URL: /mpesa/b2c/v1/paymentrequest"

if [ "${SKIP_RESTART:-}" != "1" ] && command -v pm2 >/dev/null 2>&1; then
  echo "==> Restarting sokoni-bot (env from whatsapp-bot/.env, not this shell)"
  # Do not let a leftover OCR/wrong Consumer Key in the SSH session override .env.
  env -u MPESA_CONSUMER_KEY -u MPESA_CONSUMER_SECRET -u MPESA_PASSKEY \
    -u MPESA_SECURITY_CREDENTIAL -u MPESA_INITIATOR_PASSWORD \
    pm2 restart sokoni-bot --update-env
  pm2 save >/dev/null 2>&1 || true
fi

echo "Next: bash scripts/test-daraja-b2c-ready.sh && bash scripts/test-daraja-oauth.sh"
