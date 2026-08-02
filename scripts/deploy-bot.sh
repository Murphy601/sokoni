#!/usr/bin/env bash
# Run on the GCP VM (sokoni-bot) after SSH login.
#
# IMPORTANT: git checkout replaces this path on disk. Bash reading the repo file
# then hits EOF and exits right after "Reset branch" with no error. Always run
# the body from a /tmp snapshot (see wrapper below).
set -euo pipefail

# __DEPLOY_WRAPPER__
if [ "${SOKONI_DEPLOY_REEXEC:-}" != "1" ]; then
  _self="${BASH_SOURCE[0]:-$0}"
  _tmp="$(mktemp /tmp/sokoni-deploy.XXXXXX)"
  # Strip the wrapper; only the body runs from /tmp (safe across git checkout).
  if ! awk '/^# __DEPLOY_BODY__$/ {p=1; next} p' "$_self" > "$_tmp" || [ ! -s "$_tmp" ]; then
    echo "ERROR: could not extract deploy body from $_self" >&2
    rm -f "$_tmp"
    exit 1
  fi
  chmod 700 "$_tmp"
  echo "==> Deploy snapshot: $_tmp" >&2
  exec env SOKONI_DEPLOY_REEXEC=1 SOKONI_DEPLOY_TMP="$_tmp" bash "$_tmp" "$@"
fi
if [ -n "${SOKONI_DEPLOY_TMP:-}" ]; then
  # shellcheck disable=SC2064
  trap 'rm -f "$SOKONI_DEPLOY_TMP" 2>/dev/null || true' EXIT
fi

# __DEPLOY_BODY__
REPO="${SOKONI_REPO:-$HOME/sokoni}"
BOT_DIR="$REPO/whatsapp-bot"
NAME="${PM2_NAME:-sokoni-bot}"

echo "==> Deploying Sokoni bot from $REPO"

cd "$REPO"

DEPLOY_REF="${SOKONI_DEPLOY_REF:-main}"
STASHED=0

# Optional: publish local WhatsApp catalog before switching branches.
# Set SKIP_CATALOG_PUBLISH=1 when the VM is on a diverged feature branch / push would fail.
if [ "${SKIP_CATALOG_PUBLISH:-}" = "1" ]; then
  echo "==> SKIP_CATALOG_PUBLISH=1 — leaving local catalog files alone for now"
elif git status --porcelain whatsapp-bot/src/data/products.json website/data/products.json website/assets/images/products/ 2>/dev/null | grep -q .; then
  echo "==> Local catalog changes found — publishing to GitHub first..."
  node scripts/build-site-catalog.mjs
  if ! node scripts/commit-catalog.mjs; then
    echo "WARN: Catalog publish failed — continuing deploy (live catalog is Postgres when dbConnected)."
    echo "      Later: node scripts/publish-catalog-now.mjs"
  fi
fi

echo "==> Syncing to origin/${DEPLOY_REF} (always deploy from this ref, not a leftover feature branch)..."
git fetch origin "$DEPLOY_REF"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "==> Stashing dirty tracked files so checkout can proceed..."
  # Do NOT use `git stash -u` — that removes untracked listing photos under
  # website/assets/images/products/ and breaks /catalog-images until re-upload.
  git stash push -m "deploy-bot-$(date +%s)" || true
  STASHED=1
fi
# Keep noisy untracked bak files from blocking nothing; leave product images alone.
mkdir -p /tmp/sokoni-vm-scratch
shopt -s nullglob
for bak in whatsapp-bot/src/data/products.json.bak-*; do
  mv "$bak" /tmp/sokoni-vm-scratch/ 2>/dev/null || true
done
shopt -u nullglob
# Force local main (or override) onto the remote tip — avoids "pull --rebase" staying on a feature branch.
if ! git checkout -B "$DEPLOY_REF" "origin/${DEPLOY_REF}"; then
  echo "ERROR: could not checkout origin/${DEPLOY_REF}"
  exit 1
fi
echo "==> Git at: $(git log -1 --oneline) (branch $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown))"

if [ "$STASHED" = "1" ]; then
  echo "==> Keeping deploy stash (not auto-popped onto main) — restore later with: git stash list"
  echo "    VM-only files (tiktok-featured, product bak) stay out of the running tree."
fi

# Default: do NOT recreate WAHA on bot deploys (bouncing 2026.6.2 broke WhatsApp).
# Refresh WAHA explicitly with: FORCE_WAHA_DEPLOY=1 bash scripts/deploy-bot.sh
# Or: bash scripts/deploy-waha.sh
if [ "${FORCE_WAHA_DEPLOY:-}" = "1" ]; then
  echo "==> FORCE_WAHA_DEPLOY=1 — running WAHA deploy"
  if ! bash "$REPO/scripts/deploy-waha.sh"; then
    echo "WARN: WAHA deploy failed — WhatsApp will not reply until WAHA is fixed."
    echo "      Run: bash scripts/deploy-waha.sh"
  fi
elif [ "${SKIP_WAHA_DEPLOY:-1}" != "0" ]; then
  echo "==> Leaving WAHA as-is (default). Set FORCE_WAHA_DEPLOY=1 to recreate."
elif [ -f "$REPO/docker-compose.waha.yml" ]; then
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

# Read env values without tripping set -e/pipefail when a key is missing.
env_get() {
  local file="$1" key="$2"
  grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" 2>/dev/null \
    | tail -1 \
    | sed -E 's/^[^=]+=//' \
    | tr -d "\"'" \
    | tr -d '[:space:]' \
    || true
}

if [ -f "$ENV_FILE" ]; then
  CURRENT_MODEL="$(env_get "$ENV_FILE" OPENAI_MODEL)"
  FREE_MODEL="openrouter/free"
  FREE_FALLBACKS="google/gemma-4-26b-a4b-it:free"
  # Seller photos only — WhatsApp chat stays on FREE_MODEL above.
  # Primary = multimodal vision; two OpenRouter fallbacks keep krea (image-gen — skipped for photo→JSON).
  PHOTO_VISION_MODEL="google/gemini-2.5-flash"
  PHOTO_VISION_FALLBACKS="google/gemini-2.0-flash-001,krea/krea-2-medium-turbo"
  DEPRECATED_MODELS='nemotron-nano-9b|gemma-2-9b-it|gpt-oss-20b|gemini-2\.0-flash-exp|deepseek-r1|gemini-2\.5-pro|gemini-2\.5-flash|gemini-2\.5-flash-lite|gemma-4-31b-it:free|qwen/qwen3-next-80b|llama-3\.3-70b-instruct:free|llama-3\.2-3b-instruct:free|qwen/qwen3-coder:free'
  if [ -z "$CURRENT_MODEL" ] || echo "$CURRENT_MODEL" | grep -qE "$DEPRECATED_MODELS"; then
    echo "==> Setting OPENAI_MODEL → ${FREE_MODEL} (was: ${CURRENT_MODEL:-unset})"
    set_env_kv "$ENV_FILE" "OPENAI_MODEL" "$FREE_MODEL"
  fi
  CURRENT_FALLBACKS="$(env_get "$ENV_FILE" OPENAI_MODEL_FALLBACKS)"
  if [ -z "$CURRENT_FALLBACKS" ] || echo "$CURRENT_FALLBACKS" | grep -qE 'gpt-4o-mini|gemini-2\.0-flash-exp|deepseek-r1|nemotron-nano|qwen/qwen3-next-80b|llama-3\.3-70b|llama-3\.2-3b|qwen/qwen3-coder'; then
    set_env_kv "$ENV_FILE" "OPENAI_MODEL_FALLBACKS" "$FREE_FALLBACKS"
    echo "==> Set OPENAI_MODEL_FALLBACKS → ${FREE_FALLBACKS}"
  fi
  CURRENT_VISION="$(env_get "$ENV_FILE" CATALOG_VISION_MODEL)"
  # Migrate away from image-gen / free-chat models as the photo primary (krea stays in FALLBACKS).
  if [ -z "$CURRENT_VISION" ] || echo "$CURRENT_VISION" | grep -qE '^(krea/|openrouter/free$)|gemini-2\.0-flash-exp|gemma-4-31b-it:free|google/gemma-4-26b-a4b-it:free'; then
    set_env_kv "$ENV_FILE" "CATALOG_VISION_MODEL" "$PHOTO_VISION_MODEL"
    echo "==> Set CATALOG_VISION_MODEL → ${PHOTO_VISION_MODEL} (was: ${CURRENT_VISION:-unset}; seller photos only; chat stays ${FREE_MODEL})"
  fi
  CURRENT_VISION_FB="$(env_get "$ENV_FILE" CATALOG_VISION_FALLBACKS)"
  if [ -z "$CURRENT_VISION_FB" ] || ! echo "$CURRENT_VISION_FB" | grep -q 'krea/krea-2-medium-turbo' || echo "$CURRENT_VISION_FB" | grep -qE 'gemini-2\.0-flash-exp|gemini-2\.5-flash-lite|gemma-4-31b-it:free|nvidia/nemotron'; then
    set_env_kv "$ENV_FILE" "CATALOG_VISION_FALLBACKS" "$PHOTO_VISION_FALLBACKS"
    echo "==> Set CATALOG_VISION_FALLBACKS → ${PHOTO_VISION_FALLBACKS}"
  fi
  echo "==> AI model: $(env_get "$ENV_FILE" OPENAI_MODEL)"
  echo "==> Vision: $(env_get "$ENV_FILE" CATALOG_VISION_MODEL)"
  echo "==> Vision fallbacks: $(env_get "$ENV_FILE" CATALOG_VISION_FALLBACKS)"
  # Always ensure a non-empty GEMINI_API_KEY (rotate later). Actions override wins when set.
  DEFAULT_GEMINI_API_KEY="AQ.Ab8RN6JKsaorEvw8bvKc277LHDh3lL3HMWNbPhrz_LJxDKkhKQ"
  CURRENT_GEMINI="$(env_get "$ENV_FILE" GEMINI_API_KEY)"
  if [ -n "${SOKONI_GEMINI_API_KEY:-}" ]; then
    set_env_kv "$ENV_FILE" "GEMINI_API_KEY" "$SOKONI_GEMINI_API_KEY"
    echo "==> Set GEMINI_API_KEY from SOKONI_GEMINI_API_KEY"
  elif [ -z "$CURRENT_GEMINI" ]; then
    set_env_kv "$ENV_FILE" "GEMINI_API_KEY" "$DEFAULT_GEMINI_API_KEY"
    echo "==> Seeded GEMINI_API_KEY into $ENV_FILE (was empty/missing — rotate when ready)"
  else
    echo "==> Gemini vision: GEMINI_API_KEY present (${#CURRENT_GEMINI} chars)"
  fi
  # Hard verify — never leave deploy without a key when we have a default.
  VERIFY_GEMINI="$(env_get "$ENV_FILE" GEMINI_API_KEY)"
  if [ -z "$VERIFY_GEMINI" ]; then
    echo "GEMINI_API_KEY=$DEFAULT_GEMINI_API_KEY" >> "$ENV_FILE"
    echo "==> Appended GEMINI_API_KEY (set_env_kv missed — forced append)"
  fi
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
# Cap heap + auto-restart before a studio OOM takes the whole 1GB VM down.
pm2 start src/server.js \
  --name "$NAME" \
  --cwd "$BOT_DIR" \
  --update-env \
  --max-memory-restart 450M \
  --node-args="--max-old-space-size=384"
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
