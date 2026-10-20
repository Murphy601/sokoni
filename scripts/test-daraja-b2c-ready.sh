#!/usr/bin/env bash
# Check B2C initiator readiness from whatsapp-bot/.env (no payout sent).
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

env_get() {
  local key="$1"
  local line=""
  # Missing keys must not abort under set -euo pipefail (grep exit 1).
  if [ -f "$ENV_FILE" ]; then
    line="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 || true)"
  fi
  printf '%s' "$line" | sed -E "s/^${key}=//" | tr -d '\r' | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

NAME="$(env_get MPESA_INITIATOR_NAME)"
CRED="$(env_get MPESA_SECURITY_CREDENTIAL)"
PASS="$(env_get MPESA_INITIATOR_PASSWORD)"
CERT="$(env_get MPESA_CERT_PATH)"
SHORT="$(env_get MPESA_B2C_SHORTCODE)"
RESULT="$(env_get MPESA_B2C_RESULT_URL)"
KEY="$(env_get MPESA_CONSUMER_KEY)"

echo "Env file: $ENV_FILE"
echo "Initiator: ${NAME:-unset}"
echo "B2C shortcode: ${SHORT:-unset}"
echo "SecurityCredential len: ${#CRED}"
echo "InitiatorPassword set: $([ -n "$PASS" ] && echo yes || echo no)"
echo "Cert path: ${CERT:-unset} $([ -n "$CERT" ] && [ -f "$CERT" ] && echo '(exists)' || echo '')"
echo "Result URL: ${RESULT:-unset}"
echo "Consumer key len: ${#KEY}"

ok=1
[ -n "$NAME" ] || { echo "FAIL: MPESA_INITIATOR_NAME missing"; ok=0; }
[ -n "$SHORT" ] || { echo "FAIL: MPESA_B2C_SHORTCODE missing"; ok=0; }
[ -n "$RESULT" ] || { echo "FAIL: MPESA_B2C_RESULT_URL missing"; ok=0; }
[ "${#KEY}" -ge 32 ] || { echo "FAIL: OAuth consumer key missing/short"; ok=0; }
if [ "${#CRED}" -lt 80 ] && { [ -z "$PASS" ] || [ ! -f "${CERT:-}" ]; }; then
  echo "FAIL: need MPESA_SECURITY_CREDENTIAL or (INITIATOR_PASSWORD + cert file)"
  ok=0
fi

if [ "$ok" = 1 ]; then
  echo "OK — B2C env looks ready. Send a real payout with #payb2c SKN-… or Seller Withdraw."
  exit 0
fi
echo "Fix with: bash scripts/configure-b2c-initiator.sh"
exit 1
