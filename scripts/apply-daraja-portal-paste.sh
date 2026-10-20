#!/usr/bin/env bash
# Apply a Daraja portal paste to whatsapp-bot/.env — NEVER commits secrets.
#
# Supports labeled lines (portal / chat paste), e.g.:
#   Consumer Key: …
#   Consumer Secret: …
#   Passkey: …
#   Short Code: 3439153
#   USERNAME: DavidMuiruri
#   SECURITY CREDENTIALS: "…"
#
# On the VM:
#   nano /tmp/daraja-portal.txt   # paste labels + values, save
#   chmod 600 /tmp/daraja-portal.txt
#   bash scripts/apply-daraja-portal-paste.sh /tmp/daraja-portal.txt
#   shred -u /tmp/daraja-portal.txt 2>/dev/null || rm -f /tmp/daraja-portal.txt
#   bash scripts/test-daraja-oauth.sh
#
# STK is wired first. B2C auto-payout stays OFF (MPESA_B2C_AUTO=false) until you
# configure the separate B2C initiator username later.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"
FILE="${1:-}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: bash scripts/apply-daraja-portal-paste.sh /tmp/daraja-portal.txt" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE — clone/deploy the repo first." >&2
  exit 1
fi

clean_val() {
  printf '%s' "$1" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["'\'']//' -e 's/["'\'']$//'
}

KEY="" SECRET="" PASSKEY="" SHORTCODE="" INITIATOR="" SECURITY=""

while IFS= read -r raw || [ -n "$raw" ]; do
  line="$(clean_val "$raw")"
  [ -n "$line" ] || continue

  lower="$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    consumer\ key:*|consumer\ key\ :*)
      KEY="$(clean_val "${line#*:}")"
      continue
      ;;
    consumer\ secret:*|consumer\ secret\ :*)
      SECRET="$(clean_val "${line#*:}")"
      continue
      ;;
    passkey:*|pass\ key:*|lipa\ na\ m-pesa\ online\ passkey:*)
      PASSKEY="$(clean_val "${line#*:}")"
      continue
      ;;
    short\ code:*|shortcode:*|business\ shortcode:*)
      SHORTCODE="$(clean_val "${line#*:}")"
      continue
      ;;
    username:*|initiator:*|initiator\ name:*|mpesa_initiator_name:*)
      INITIATOR="$(clean_val "${line#*:}")"
      continue
      ;;
    security\ credentials:*|security\ credential:*|mpesa_security_credential:*)
      SECURITY="$(clean_val "${line#*:}")"
      continue
      ;;
  esac

  # Bare 3-line fallback values (key / secret / passkey) when no labels.
  if [[ "$line" =~ ^[0-9]{5,8}$ ]]; then
    SHORTCODE="$line"
    continue
  fi
  if [ -z "$KEY" ] && [ "${#line}" -ge 40 ] && [ "${#line}" -le 80 ]; then
    KEY="$line"
    continue
  fi
  if [ -z "$SECRET" ] && [ "${#line}" -ge 40 ]; then
    SECRET="$line"
    continue
  fi
  if [ -z "$PASSKEY" ] && [ "${#line}" -ge 40 ] && [[ "$line" =~ ^[0-9a-fA-F]+$ ]]; then
    PASSKEY="$line"
    continue
  fi
  if [ -z "$SECURITY" ] && [ "${#line}" -ge 80 ]; then
    SECURITY="$line"
  fi
done < "$FILE"

echo "Parsed portal paste from $FILE:"
echo "  Key len=${#KEY}  Secret len=${#SECRET}  Passkey len=${#PASSKEY}"
echo "  Shortcode=${SHORTCODE:-default}  Initiator=${INITIATOR:-DavidMuiruri}"
echo "  SecurityCredential len=${#SECURITY}"
echo "  Key fingerprint (sha256…16): $(printf '%s' "$KEY" | sha256sum | cut -c1-16)"

if [ "${#KEY}" -lt 40 ] || [ "${#SECRET}" -lt 40 ] || [ "${#PASSKEY}" -lt 40 ]; then
  echo "ERROR: Consumer Key / Secret / Passkey missing or too short." >&2
  exit 1
fi

# Known-bad OCR Consumer Key (l/I swapped)
if [ "$(printf '%s' "$KEY" | sha256sum | cut -c1-16)" = "24df15d590a14320" ]; then
  echo "ERROR: this Consumer Key is the OCR typo (l/I swapped)." >&2
  exit 1
fi

export MPESA_CONSUMER_KEY="$KEY"
export MPESA_CONSUMER_SECRET="$SECRET"
export MPESA_PASSKEY="$PASSKEY"
if [ -n "$SHORTCODE" ]; then
  export MPESA_SHORTCODE="$SHORTCODE"
fi
# Keep B2C auto OFF until initiator + matching SecurityCredential are confirmed.
export MPESA_B2C_AUTO=false
if [ -n "$INITIATOR" ]; then
  export MPESA_INITIATOR_NAME="$INITIATOR"
else
  export MPESA_INITIATOR_NAME=DavidMuiruri
fi
if [ "${#SECURITY}" -ge 80 ]; then
  export MPESA_SECURITY_CREDENTIAL="$SECURITY"
fi

echo "==> Writing STK + org shortcode mapping (B2C_AUTO forced false)…"
SKIP_RESTART=1 bash "$REPO/scripts/set-daraja-env.sh"

if [ "${#SECURITY}" -ge 80 ]; then
  echo "==> Writing initiator ${MPESA_INITIATOR_NAME} SecurityCredential (B2C payouts stay manual until you enable later)…"
  SKIP_RESTART=1 \
    MPESA_INITIATOR_NAME="$MPESA_INITIATOR_NAME" \
    MPESA_SECURITY_CREDENTIAL="$SECURITY" \
    bash "$REPO/scripts/configure-b2c-initiator.sh"
else
  echo "==> No SecurityCredential in paste — STK-only (set initiator name only if provided)"
  if [ -n "${MPESA_INITIATOR_NAME:-}" ]; then
    TMP_I="$(mktemp)"
    grep -vE '^MPESA_INITIATOR_NAME=' "$ENV_FILE" > "$TMP_I" || true
    printf 'MPESA_INITIATOR_NAME=%s\n' "$MPESA_INITIATOR_NAME" >> "$TMP_I"
    mv "$TMP_I" "$ENV_FILE"
  fi
fi

# Hard-ensure auto B2C stays off for this STK wire-up.
TMP="$(mktemp)"
grep -vE '^MPESA_B2C_AUTO=' "$ENV_FILE" > "$TMP" || true
printf 'MPESA_B2C_AUTO=false\n' >> "$TMP"
mv "$TMP" "$ENV_FILE"

if command -v pm2 >/dev/null 2>&1; then
  echo "==> Restarting sokoni-bot from .env (cleared shell MPESA_* overrides)"
  env -u MPESA_CONSUMER_KEY -u MPESA_CONSUMER_SECRET -u MPESA_PASSKEY \
    -u MPESA_SECURITY_CREDENTIAL -u MPESA_INITIATOR_PASSWORD \
    pm2 restart sokoni-bot --update-env
  pm2 save >/dev/null 2>&1 || true
fi

echo ""
echo "Done. Next on the VM:"
echo "  bash scripts/test-daraja-oauth.sh"
echo "  bash scripts/test-daraja-b2c-ready.sh   # should report initiator ready; auto B2C still false"
echo "  shred -u $FILE 2>/dev/null || rm -f $FILE"
echo ""
echo "B2C payouts: leave manual for now. When you have the separate B2C username,"
echo "re-run configure-b2c-initiator.sh with that name (same shortcode 3439153)."
