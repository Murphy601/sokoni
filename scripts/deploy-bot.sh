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

# WAHA deploy used to stop Postgres via --remove-orphans; keep DB up when configured.
if [ -f "$REPO/scripts/start-postgres.sh" ] && [ -f "$BOT_DIR/.env" ] && grep -q '^DATABASE_URL=.' "$BOT_DIR/.env" 2>/dev/null; then
  bash "$REPO/scripts/start-postgres.sh" || echo "WARN: Postgres start failed — bot will fall back to products.json"
fi

cd "$BOT_DIR"

# Ensure .env exists and upgrade legacy/paid chat models → free OpenRouter stack.
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
  FREE_MODEL="openrouter/free"
  FREE_FALLBACKS="google/gemma-4-26b-a4b-it:free,meta-llama/llama-3.2-3b-instruct:free,qwen/qwen3-coder:free"
  FREE_VISION="google/gemma-4-26b-a4b-it:free"
  FREE_VISION_FALLBACKS="openrouter/free,nvidia/nemotron-nano-12b-v2-vl:free"
  DEPRECATED_MODELS='nemotron-nano-9b|gemma-2-9b-it|gpt-oss-20b|gemini-2\.0-flash-exp|deepseek-r1|gemini-2\.5-pro|gemini-2\.5-flash|gemini-2\.5-flash-lite|gemma-4-31b-it:free|qwen/qwen3-next-80b|llama-3\.3-70b-instruct:free'
  if [ -z "$CURRENT_MODEL" ] || echo "$CURRENT_MODEL" | grep -qE "$DEPRECATED_MODELS"; then
    echo "==> Setting OPENAI_MODEL → ${FREE_MODEL} (was: ${CURRENT_MODEL:-unset})"
    set_env_kv "$ENV_FILE" "OPENAI_MODEL" "$FREE_MODEL"
  fi
  CURRENT_FALLBACKS="$(grep -E '^[[:space:]]*(export[[:space:]]+)?OPENAI_MODEL_FALLBACKS=' "$ENV_FILE" | tail -1 | sed -E 's/^[^=]+=//' | tr -d "\"'" | tr -d '[:space:]' || true)"
  if [ -z "$CURRENT_FALLBACKS" ] || echo "$CURRENT_FALLBACKS" | grep -qE 'gpt-4o-mini|gemini-2\.0-flash-exp|deepseek-r1|nemotron-nano|qwen/qwen3-next-80b|llama-3\.3-70b'; then
    set_env_kv "$ENV_FILE" "OPENAI_MODEL_FALLBACKS" "$FREE_FALLBACKS"
    echo "==> Set OPENAI_MODEL_FALLBACKS → ${FREE_FALLBACKS}"
  fi
  CURRENT_VISION="$(grep -E '^[[:space:]]*(export[[:space:]]+)?CATALOG_VISION_MODEL=' "$ENV_FILE" | tail -1 | sed -E 's/^[^=]+=//' | tr -d "\"'" | tr -d '[:space:]' || true)"
  if [ -z "$CURRENT_VISION" ] || echo "$CURRENT_VISION" | grep -qE 'gemini-2\.0-flash-exp|gemini-2\.5-flash|gemma-4-31b-it:free'; then
    set_env_kv "$ENV_FILE" "CATALOG_VISION_MODEL" "$FREE_VISION"
    echo "==> Set CATALOG_VISION_MODEL → ${FREE_VISION}"
  fi
  CURRENT_VISION_FB="$(grep -E '^[[:space:]]*(export[[:space:]]+)?CATALOG_VISION_FALLBACKS=' "$ENV_FILE" | tail -1 | sed -E 's/^[^=]+=//' | tr -d "\"'" | tr -d '[:space:]' || true)"
  if [ -z "$CURRENT_VISION_FB" ] || echo "$CURRENT_VISION_FB" | grep -qE 'gemini-2\.0-flash-exp|gemini-2\.5-flash-lite|gemma-4-31b-it:free'; then
    set_env_kv "$ENV_FILE" "CATALOG_VISION_FALLBACKS" "$FREE_VISION_FALLBACKS"
    echo "==> Set CATALOG_VISION_FALLBACKS → ${FREE_VISION_FALLBACKS}"
  fi
  echo "==> AI model: $(grep -E '^[[:space:]]*(export[[:space:]]+)?OPENAI_MODEL=' "$ENV_FILE" | tail -1 | sed -E 's/^[^=]+=//')"
else
  echo "WARN: No .env found — bot uses code defaults (openrouter/free)"
fi

npm install --omit=dev 2>/dev/null || npm install

  if [ -f "$ENV_FILE" ] && grep -q '^DATABASE_URL=.' "$ENV_FILE" 2>/dev/null; then
  echo "==> Applying DB migrations..."
  npm run db:migrate || echo "WARN: db:migrate failed"
  if npm run 2>/dev/null | grep -q 'db:backfill-browse'; then
    PAUSE_FILE="$REPO/website/data/catalog-paused.json"
    if [ -f "$PAUSE_FILE" ] && grep -q '"paused"[[:space:]]*:[[:space:]]*true' "$PAUSE_FILE" 2>/dev/null; then
      echo "==> Catalog paused — skipping browse backfill"
    else
      npm run db:backfill-browse || echo "WARN: db:backfill-browse failed"
    fi
  fi
fi

if [ -f "$REPO/scripts/build-browse-menu.mjs" ]; then
  node "$REPO/scripts/build-browse-menu.mjs" 2>/dev/null || true
fi

echo "==> Verifying bot module imports..."
if ! node "$REPO/scripts/verify-bot-import.mjs"; then
  echo "ERROR: bot modules failed to load — fix before starting pm2"
  exit 1
fi

if pm2 describe "$NAME" >/dev/null 2>&1; then
  pm2 delete "$NAME" || true
fi
pm2 start src/server.js --name "$NAME" --cwd "$BOT_DIR" --update-env
pm2 save

echo "==> Waiting for bot health (up to 30s)..."
HEALTH_OK=0
for i in $(seq 1 15); do
  if curl -sf --max-time 3 "http://127.0.0.1:3001/health/live" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done

echo "==> Local health:"
if [ "$HEALTH_OK" = "1" ]; then
  curl -s --max-time 8 "http://127.0.0.1:3001/health" || echo "(full health timed out — live probe OK)"
  echo ""
else
  echo "ERROR: bot not responding on :3001"
  echo "==> Recent PM2 logs:"
  pm2 logs "$NAME" --lines 40 --nostream 2>/dev/null || true
  echo ""
  echo "Fix: pm2 logs $NAME --lines 100"
  exit 1
fi
echo "==> PM2 status:"
pm2 describe "$NAME" | sed -n '1,25p'
echo ""
echo "==> Public health:"
if curl -sf --max-time 10 "https://bot.sokonimall.com/health/live" >/dev/null 2>&1; then
  curl -s --max-time 10 "https://bot.sokonimall.com/health/live" && echo ""
else
  echo "WARN: https://bot.sokonimall.com still unreachable (502 = nginx or Cloudflare)"
  echo "      If local health OK: sudo nginx -t && sudo systemctl reload nginx"
fi
echo ""
echo "Done."
