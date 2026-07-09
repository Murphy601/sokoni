#!/usr/bin/env bash
# Run on the GCP VM (sokoni-bot) after SSH login.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
BOT_DIR="$REPO/whatsapp-bot"
NAME="${PM2_NAME:-sokoni-bot}"

echo "==> Deploying Sokoni bot from $REPO"

cd "$REPO"
git fetch origin main
git reset --hard origin/main
echo "==> Git at: $(git log -1 --oneline)"

cd "$BOT_DIR"
npm install --omit=dev 2>/dev/null || npm install

if pm2 describe "$NAME" >/dev/null 2>&1; then
  pm2 restart "$NAME" --update-env
else
  pm2 start src/server.js --name "$NAME" --cwd "$BOT_DIR"
fi
pm2 save

sleep 3
echo "==> Local health:"
curl -s "http://127.0.0.1:3001/health" || true
echo ""
echo "==> PM2 status:"
pm2 describe "$NAME" | sed -n '1,25p'
echo ""
echo "Done. Public check: curl https://bot.sokonimall.com/health"
