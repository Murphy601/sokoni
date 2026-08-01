#!/usr/bin/env bash
# Start Sokoni rembg on the bot VM without a long custom image build.
# Prefer prebuilt danielgatis/rembg; falls back to docker-compose.media.yml build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME="${REMBG_CONTAINER_NAME:-sokoni-rembg}"
PORT="${REMBG_HOST_PORT:-7000}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found" >&2
  exit 1
fi

echo "==> Stopping old container (if any): $NAME"
docker rm -f "$NAME" 2>/dev/null || true

echo "==> Pulling prebuilt rembg image (faster than building media-worker)…"
docker pull danielgatis/rembg:latest

echo "==> Starting $NAME on 127.0.0.1:$PORT"
docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  -p "127.0.0.1:${PORT}:7000" \
  --memory=1536m \
  danielgatis/rembg:latest \
  s --host 0.0.0.0 --port 7000

echo "==> Waiting for rembg (first start downloads the model — may take a few minutes)…"
ok=0
for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${PORT}/api" >/dev/null 2>&1 \
    || curl -fsS "http://127.0.0.1:${PORT}/docs" >/dev/null 2>&1 \
    || curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -ne 1 ]]; then
  echo "rembg did not become ready. Logs:" >&2
  docker logs --tail 80 "$NAME" || true
  exit 1
fi

echo "==> rembg is up"
curl -sS "http://127.0.0.1:${PORT}/docs" >/dev/null && echo "docs OK" || true
curl -sS "http://127.0.0.1:${PORT}/health" || echo "(no /health on prebuilt image — OK, /api/remove still works)"
docker ps --filter "name=$NAME"
echo
echo "Next: ensure whatsapp-bot/.env has:"
echo "  STUDIO_PROVIDER=auto"
echo "  REMBG_URL=http://127.0.0.1:${PORT}"
echo "  STUDIO_CLIP_ENABLED=true"
echo "Then: SKIP_CATALOG_PUBLISH=1 SKIP_WAHA_DEPLOY=1 bash scripts/deploy-bot.sh"
