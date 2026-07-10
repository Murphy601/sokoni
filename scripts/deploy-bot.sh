#!/usr/bin/env bash
# Run on the GCP VM (sokoni-bot) after SSH login.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
BOT_DIR="$REPO/whatsapp-bot"
NAME="${PM2_NAME:-sokoni-bot}"

echo "==> Deploying Sokoni bot from $REPO"

cd "$REPO"

# Push local WhatsApp catalog changes BEFORE pulling code (never wipe unpushed products).
if git status --porcelain whatsapp-bot/src/data/products.json website/data/products.json website/assets/images/products/ 2>/dev/null | grep -q .; then
  echo "==> Local catalog changes found — publishing to GitHub first..."
  node scripts/build-site-catalog.mjs
  if ! node scripts/commit-catalog.mjs; then
    echo "ERROR: Catalog publish failed. Fix git auth, then run: node scripts/publish-catalog-now.mjs"
    exit 1
  fi
fi

git fetch origin main
git pull --rebase origin main
echo "==> Git at: $(git log -1 --oneline)"

if [ -f "$REPO/docker-compose.waha.yml" ]; then
  bash "$REPO/scripts/deploy-waha.sh"
fi

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
