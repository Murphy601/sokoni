#!/usr/bin/env bash
# Restore correct Prod-SOKONIMALL Consumer Key (l/I OCR fix) + remind about B2C cert.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

# Correct key/secret/passkey from portal Copy (l/I fixed)
export MPESA_CONSUMER_KEY='Vqd6UhRdqIEai2qBfsnwZQ9I725JuQgYcud9C85s2lHS9DvB'
export MPESA_CONSUMER_SECRET='P2ht5y63CZcAOHLc8jDSbuxu4KbTdkWmebF6DyWAKz9owJh393eseGduGaHAVhfo'
export MPESA_PASSKEY='ea9d0b4e609cc9ecc51aaa3c5973a0e8890efca311df7ac28af8cdafdc67285d'

bash "$REPO/scripts/set-daraja-env.sh"
bash "$REPO/scripts/test-daraja-oauth.sh" || true

CERT="$REPO/whatsapp-bot/certs/ProductionCertificate.cer"
echo ""
if [ -f "$CERT" ]; then
  echo "Cert present: $CERT"
  echo "Run: export MPESA_INITIATOR_PASSWORD='…' && bash scripts/configure-b2c-initiator.sh"
else
  echo "STILL NEED: ProductionCertificate.cer (not the Postman JSON)"
  echo "  1) developer.safaricom.co.ke → Prod-SOKONIMALL"
  echo "  2) Download Production Certificate (.cer)"
  echo "  3) scp/save to: $CERT"
  echo "  4) export MPESA_INITIATOR_PASSWORD='General2543888#'"
  echo "  5) bash scripts/configure-b2c-initiator.sh"
fi
