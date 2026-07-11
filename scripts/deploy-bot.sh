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

echo "==> Syncing with origin/main..."
git fetch origin main
STASHED=0
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "==> Stashing dirty files so git pull can proceed..."
  git stash push -u -m "deploy-bot-$(date +%s)" || true
  STASHED=1
fi
if ! git pull --rebase origin main; then
  echo "WARN: git pull --rebase failed — continuing deploy at $(git rev-parse --short HEAD)"
fi
if [ "$STASHED" = "1" ]; then
  if ! git stash pop; then
    echo "WARN: stash pop had conflicts — auto-resolving known VM-only files..."
    if git diff --name-only --diff-filter=U 2>/dev/null | grep -q '^website/data/tiktok-featured\.json$'; then
      git checkout --ours website/data/tiktok-featured.json
      git add website/data/tiktok-featured.json
      echo "==> Resolved tiktok-featured.json (kept origin/main version)"
    fi
    # Drop stash if working tree is clean enough to continue
    if [ -z "$(git diff --name-only --diff-filter=U 2>/dev/null)" ]; then
      git stash drop || true
    else
      echo "WARN: unresolved conflicts remain — fix manually; bot restart continues"
    fi
  fi
fi
echo "==> Git at: $(git log -1 --oneline)"

if [ -f "$REPO/docker-compose.waha.yml" ]; then
  if ! bash "$REPO/scripts/deploy-waha.sh"; then
    echo "WARN: WAHA deploy failed — WhatsApp will not reply until WAHA is fixed."
    echo "      Run: bash scripts/deploy-waha.sh"
  fi
fi

cd "$BOT_DIR"

# Ensure .env exists and upgrade legacy tiny free models → Gemini Flash.
ENV_FILE="$BOT_DIR/.env"
if [ ! -f "$ENV_FILE" ] && [ -f "$REPO/.env" ]; then
  ENV_FILE="$REPO/.env"
fi
if [ ! -f "$ENV_FILE" ] && [ -f "$BOT_DIR/.env.example" ]; then
  cp "$BOT_DIR/.env.example" "$ENV_FILE"
  echo "==> Created $ENV_FILE from .env.example"
fi

set_env_kv() {
  local file="$1" key="$2" val="$3"
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" 2>/dev/null; then
    sed -i -E "s|^[[:space:]]*(export[[:space:]]+)?${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

if [ -f "$ENV_FILE" ]; then
  CURRENT_MODEL="$(grep -E '^[[:space:]]*(export[[:space:]]+)?OPENAI_MODEL=' "$ENV_FILE" | tail -1 | sed -E 's/^[^=]+=//' | tr -d "\"'" | tr -d '[:space:]')"
  if [ -z "$CURRENT_MODEL" ] || echo "$CURRENT_MODEL" | grep -qE 'nemotron-nano-9b|gemma-2-9b-it|gpt-oss-20b'; then
    echo "==> Upgrading OPENAI_MODEL → google/gemini-2.5-flash (was: ${CURRENT_MODEL:-unset})"
    set_env_kv "$ENV_FILE" "OPENAI_MODEL" "google/gemini-2.5-flash"
  fi
  if ! grep -qE '^[[:space:]]*(export[[:space:]]+)?OPENAI_MODEL_FALLBACKS=' "$ENV_FILE"; then
    set_env_kv "$ENV_FILE" "OPENAI_MODEL_FALLBACKS" "openai/gpt-4o-mini,google/gemini-2.5-flash-lite,nvidia/nemotron-nano-9b-v2:free"
    echo "==> Added OPENAI_MODEL_FALLBACKS"
  fi
  echo "==> AI model: $(grep -E '^[[:space:]]*(export[[:space:]]+)?OPENAI_MODEL=' "$ENV_FILE" | tail -1 | sed -E 's/^[^=]+=//')"
else
  echo "WARN: No .env found — bot uses code defaults (google/gemini-2.5-flash)"
fi

npm install --omit=dev 2>/dev/null || npm install

if pm2 describe "$NAME" >/dev/null 2>&1; then
  pm2 delete "$NAME" || true
fi
pm2 start src/server.js --name "$NAME" --cwd "$BOT_DIR" --update-env
pm2 save

sleep 3
echo "==> Local health:"
curl -s "http://127.0.0.1:3001/health" || true
echo ""
echo "==> PM2 status:"
pm2 describe "$NAME" | sed -n '1,25p'
echo ""
echo "Done. Public check: curl https://bot.sokonimall.com/health"
