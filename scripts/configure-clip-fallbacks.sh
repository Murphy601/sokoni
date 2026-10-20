#!/usr/bin/env bash
# Configure HyperFrames (HeyGen) + Remotion clip fallbacks on the bot VM.
# Does NOT commit secrets. Run on the GCP VM after SSH.
#
#   export HEYGEN_API_KEY='sk_…'
#   bash scripts/configure-clip-fallbacks.sh
#
# Or via deploy:
#   SOKONI_HEYGEN_API_KEY='sk_…' bash scripts/deploy-bot.sh
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
ENV_FILE="${ENV_FILE:-$REPO/whatsapp-bot/.env}"
WORKER_DIR="$REPO/remotion-worker"
WORKER_NAME="${REMOTION_PM2_NAME:-sokoni-remotion}"
WORKER_PORT="${REMOTION_WORKER_PORT:-3105}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE" >&2
  exit 1
fi

# Prefer explicit export; allow deploy to pass SOKONI_HEYGEN_API_KEY.
HEYGEN_KEY="${HEYGEN_API_KEY:-${SOKONI_HEYGEN_API_KEY:-}}"
HEYGEN_KEY="$(printf '%s' "$HEYGEN_KEY" | tr -d '[:space:]')"

upsert() {
  local key="$1"
  local val="$2"
  local tmp
  tmp="$(mktemp)"
  grep -vE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}

if [ -z "$HEYGEN_KEY" ]; then
  # Keep existing key if present.
  EXISTING="$(grep -E '^[[:space:]]*(export[[:space:]]+)?HEYGEN_API_KEY=' "$ENV_FILE" 2>/dev/null | tail -1 | sed -E 's/^[^=]+=//' | tr -d "\"'" | tr -d '[:space:]' || true)"
  if [ -n "$EXISTING" ]; then
    HEYGEN_KEY="$EXISTING"
    echo "==> Reusing existing HEYGEN_API_KEY (${#HEYGEN_KEY} chars)"
  else
    echo "ERROR: set HEYGEN_API_KEY (or SOKONI_HEYGEN_API_KEY) before running." >&2
    exit 1
  fi
fi

if [ "${#HEYGEN_KEY}" -lt 20 ]; then
  echo "ERROR: HEYGEN_API_KEY looks too short." >&2
  exit 1
fi

echo "==> Writing clip fallback env → $ENV_FILE"
upsert HEYGEN_API_KEY "$HEYGEN_KEY"
upsert STUDIO_CLIP_ENABLED true
upsert STUDIO_CLIP_FALLBACKS "hyperframes,remotion"
upsert REMOTION_RENDER_URL "http://127.0.0.1:${WORKER_PORT}/render"
upsert REMOTION_COMPOSITION "SokoniProduct"
upsert REMOTION_WORKER_PORT "$WORKER_PORT"
upsert REMOTION_WORKER_HOST "127.0.0.1"
# Prefer real Remotion; worker still soft-falls to Cloudinary if Chromium OOMs.
upsert REMOTION_LIGHT_MODE "false"

echo "==> Installing remotion-worker deps..."
if [ ! -d "$WORKER_DIR" ]; then
  echo "ERROR: missing $WORKER_DIR — pull latest main first." >&2
  exit 1
fi
(
  cd "$WORKER_DIR"
  npm install --omit=dev 2>/dev/null || npm install
)

if [ "${SKIP_RESTART:-}" = "1" ]; then
  echo "==> SKIP_RESTART=1 — env written; start worker later via deploy-bot.sh"
  exit 0
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "WARN: pm2 not found — env written; start worker manually."
  exit 0
fi

# Load Cloudinary keys into worker env from the same bot .env
set -a
# shellcheck disable=SC1090
source <(grep -E '^(CLOUDINARY_|REMOTION_|HEYGEN_|STUDIO_CLIP_)' "$ENV_FILE" | sed 's/^/export /' || true)
set +a

echo "==> Starting $WORKER_NAME on :$WORKER_PORT"
if pm2 describe "$WORKER_NAME" >/dev/null 2>&1; then
  pm2 delete "$WORKER_NAME" || true
fi
pm2 start "$WORKER_DIR/server.mjs" \
  --name "$WORKER_NAME" \
  --cwd "$WORKER_DIR" \
  --update-env \
  --max-memory-restart 320M \
  --node-args="--max-old-space-size=280"
pm2 save >/dev/null 2>&1 || true

echo "==> Restarting sokoni-bot so it picks up Remotion/HeyGen env"
if pm2 describe sokoni-bot >/dev/null 2>&1; then
  env -u HEYGEN_API_KEY -u SOKONI_HEYGEN_API_KEY \
    pm2 restart sokoni-bot --update-env
  pm2 save >/dev/null 2>&1 || true
fi

sleep 2
echo "==> Remotion health:"
curl -sf --max-time 5 "http://127.0.0.1:${WORKER_PORT}/health" && echo "" || echo "WARN: remotion worker not up yet (bundle may still be warming)"

echo ""
echo "Done. Fallbacks: HyperFrames (HeyGen) + Remotion (local :${WORKER_PORT})."
echo "Rotate the HeyGen key in the dashboard if it was pasted in chat."
