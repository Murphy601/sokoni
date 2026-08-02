#!/usr/bin/env bash
# Restart the WhatsApp bot on the VM without git checkout.
# Use when code is already on the right commit and deploy-bot.sh is misbehaving.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
BOT_DIR="$REPO/whatsapp-bot"
NAME="${PM2_NAME:-sokoni-bot}"

echo "==> Restarting $NAME (no git sync)"
cd "$BOT_DIR"

npm install --omit=dev 2>/dev/null || npm install

if [ -f "$REPO/scripts/verify-bot-import.mjs" ]; then
  echo "==> Verifying imports..."
  node "$REPO/scripts/verify-bot-import.mjs"
fi

if pm2 describe "$NAME" >/dev/null 2>&1; then
  pm2 delete "$NAME" || true
fi

# Free port 3001 if a stray node process is holding it.
if command -v ss >/dev/null 2>&1; then
  for pid in $(ss -ltnp 2>/dev/null | sed -n 's/.*:3001.*pid=\([0-9]\+\).*/\1/p' | sort -u); do
    echo "==> Killing stray pid $pid on :3001"
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
fi

pm2 start src/server.js \
  --name "$NAME" \
  --cwd "$BOT_DIR" \
  --update-env \
  --max-memory-restart 450M \
  --node-args="--max-old-space-size=384"
pm2 save

echo "==> Waiting for :3001..."
ok=0
for _ in $(seq 1 15); do
  if curl -sf --max-time 3 "http://127.0.0.1:3001/health/live" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

pm2 list
echo "==> Local health:"
if [ "$ok" = "1" ]; then
  curl -sS --max-time 8 "http://127.0.0.1:3001/health" || true
  echo
else
  echo "ERROR: not up on :3001"
  pm2 logs "$NAME" --lines 60 --nostream || true
  exit 1
fi
echo "==> Public health:"
curl -sS --max-time 10 "https://bot.sokonimall.com/health" || echo "(public health failed)"
echo
echo "Done. git=$(git -C "$REPO" log -1 --oneline)"
