#!/usr/bin/env bash
# Diagnose why seller B2C payouts fail while OAuth/STK may work.
# Does NOT send money.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"

echo "==> 1) Env readiness"
bash "$REPO/scripts/test-daraja-b2c-ready.sh" || true
echo ""
echo "==> 2) OAuth (same keys STK + B2C use)"
bash "$REPO/scripts/test-daraja-oauth.sh" || true
echo ""
echo "==> 3) Recent bot B2C / OAuth log lines"
if command -v pm2 >/dev/null 2>&1; then
  pm2 logs sokoni-bot --lines 80 --nostream 2>/dev/null \
    | grep -E '\[daraja\] (B2C|OAuth)|Invalid Access|404\.001|payb2c|SecurityCredential' \
    || echo "(no matching lines — retry B2C once, then re-run this script)"
else
  echo "pm2 not found"
fi

echo ""
echo "==> How to read results"
echo "  • OAuth HTTP 200 + STK works, but B2C says Invalid Access Token / 404.001.03"
echo "    → almost always Safaricom has not whitelisted B2C on shortcode 3439153"
echo "      (Daraja app may show B2C in go-live email; shortcode still needs enablement)."
echo "  • Email: apisupport@safaricom.co.ke"
echo "    App: Prod-SOKONIMALL · Shortcode: 3439153 · Ask: enable B2C Payment API"
echo "  • Until then: pay seller manually on M-Pesa, then #paid SKN-1005"
echo "  • If OAuth itself is 400: bash scripts/fix-oauth-and-hint-b2c.sh"
