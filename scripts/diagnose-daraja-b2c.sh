#!/usr/bin/env bash
# Diagnose why seller B2C payouts fail.
# Buy Goods shortcode 3439153 is C2B-only — B2C needs a separate shortcode.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

env_get() {
  local key="$1"
  local line=""
  if [ -f "$ENV_FILE" ]; then
    line="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 || true)"
  fi
  printf '%s' "$line" | sed -E "s/^${key}=//" | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

STK="$(env_get MPESA_SHORTCODE)"
B2C="$(env_get MPESA_B2C_SHORTCODE)"
INIT="$(env_get MPESA_INITIATOR_NAME)"
CRED="$(env_get MPESA_SECURITY_CREDENTIAL)"
KEY="$(env_get MPESA_CONSUMER_KEY)"
B2C_KEY="$(env_get MPESA_B2C_CONSUMER_KEY)"

echo "Env: $ENV_FILE"
echo "STK (Buy Goods) shortcode: ${STK:-unset}"
echo "B2C shortcode: ${B2C:-unset}"
echo "Initiator: ${INIT:-unset}"
echo "SecurityCredential len: ${#CRED}"
echo "STK Consumer Key len: ${#KEY}"
echo "B2C Consumer Key len: ${#B2C_KEY} (0 = reuse STK app keys)"
echo ""

if [ "$STK" = "3439153" ]; then
  echo "OK: 3439153 is your Buy Goods / C2B org shortcode for buyer STK."
fi

if [ -z "$B2C" ] || [ "$B2C" = "3439153" ]; then
  echo "BLOCKED: B2C cannot use 3439153 (C2B / Buy Goods only)."
  echo "  Safaricom: apply for B2C/Bulk/One Account shortcode:"
  echo "  https://hub.m-pesaforbusiness.co.ke/merchant-onboarding/self-onboarding"
  echo "  Then on the VM:"
  echo "    export MPESA_B2C_SHORTCODE='YOUR_NEW_B2C_CODE'"
  echo "    # optional if B2C uses a different Daraja app:"
  echo "    export MPESA_B2C_CONSUMER_KEY='…' MPESA_B2C_CONSUMER_SECRET='…'"
  echo "    bash scripts/set-daraja-env.sh"
  echo "    bash scripts/configure-b2c-initiator.sh"
  echo "    bash scripts/test-daraja-b2c-ready.sh"
  exit 1
fi

echo "B2C shortcode looks set ($B2C). Next: bash scripts/test-daraja-b2c-ready.sh"
exit 0
