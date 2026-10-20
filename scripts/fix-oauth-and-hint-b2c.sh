#!/usr/bin/env bash
# Restore correct Prod-SOKONIMALL Consumer Key (l/I OCR fix) + remind about B2C cert.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

# Correct key/secret/passkey from portal Copy (l/I fixed)
export MPESA_CONSUMER_KEY='Vqd6UhRdqIEai2qBfsnwZQ9I725JuQgYcud9C85s2lHS9DvB'
export MPESA_CONSUMER_SECRET='P2ht5y63CZcAOHLc8jDSbuxu4KbTdkWmebF6DyWAKz9owJh393eseGduGaHAVhfo'
export MPESA_PASSKEY='ea9d0b4e609cc9ecc51aaa3c5973a0e8890efca311df7ac28af8cdafdc67285d'

# Do not let a leftover shell SecurityCredential placeholder clobber B2C.
unset MPESA_SECURITY_CREDENTIAL MPESA_INITIATOR_PASSWORD || true

bash "$REPO/scripts/set-daraja-env.sh"
bash "$REPO/scripts/test-daraja-oauth.sh" || true

echo ""
if grep -qE '^MPESA_SECURITY_CREDENTIAL=.+' "$ENV_FILE" 2>/dev/null; then
  echo "B2C SecurityCredential already in .env — STK + B2C should both work after bot restart."
  echo "Buyer: reply pay · Seller payout: Withdraw or #payb2c SKN-…"
else
  echo "STK OAuth restored. For seller B2C payouts still need SecurityCredential:"
  echo "  export MPESA_INITIATOR_NAME=DavidMuiruri"
  echo "  export MPESA_SECURITY_CREDENTIAL='…from Daraja Copy Credentials…'"
  echo "  bash scripts/configure-b2c-initiator.sh"
fi
