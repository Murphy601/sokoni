#!/usr/bin/env bash
# Start/recreate WAHA with media settings required for WhatsApp catalog photo uploads.
# Safe on docker-compose v1 (no --force-recreate — that triggers ContainerConfig KeyError).
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
# shellcheck source=lib/waha-common.sh
source "$REPO/scripts/lib/waha-common.sh"
COMPOSE_FILE="$WAHA_COMPOSE_FILE"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: Missing $COMPOSE_FILE — run: cd ~/sokoni && git pull origin main"
  exit 1
fi

echo "==> Starting WAHA from $COMPOSE_FILE"
cd "$REPO"

# Pull the pinned compose image (not floating :latest).
if [ "${SKIP_WAHA_PULL:-}" != "1" ]; then
  echo "==> Pulling WAHA image ($WAHA_DEFAULT_IMAGE) — set SKIP_WAHA_PULL=1 to skip"
  if ! waha_docker_compose -p "$WAHA_COMPOSE_PROJECT" -f docker-compose.waha.yml pull; then
    echo "WARN: compose pull failed — trying docker pull $WAHA_DEFAULT_IMAGE"
    docker pull "$WAHA_DEFAULT_IMAGE" || echo "WARN: docker pull failed — continuing with cached image"
  fi
fi

# docker-compose v1.29 + --force-recreate → KeyError: 'ContainerConfig'. Use down + up instead.
# Do NOT use --remove-orphans — it kills sokoni_postgres (separate compose file, same project name).
waha_docker_compose -p "$WAHA_COMPOSE_PROJECT" -f docker-compose.waha.yml down 2>/dev/null || true

# Remove ghost containers left by failed --force-recreate runs.
docker ps -aq --filter "name=waha" 2>/dev/null | xargs -r docker rm -f 2>/dev/null || true

waha_docker_compose -p "$WAHA_COMPOSE_PROJECT" -f docker-compose.waha.yml up -d

sleep 4
WAHA_CID="$(waha_container_id)"
if [ -z "$WAHA_CID" ]; then
  echo "ERROR: WAHA container is not running."
  waha_docker_compose -p "$WAHA_COMPOSE_PROJECT" -f docker-compose.waha.yml ps || true
  docker ps -a | grep -i waha || true
  exit 1
fi

echo "==> WAHA container: $WAHA_CID"
echo "==> WAHA WhatsApp env:"
docker exec "$WAHA_CID" env | grep -E '^WHATSAPP_' | sort || true

missing=0
for key in WHATSAPP_DOWNLOAD_MEDIA WHATSAPP_FILES_LIFETIME WHATSAPP_FILES_FOLDER; do
  if ! docker exec "$WAHA_CID" env | grep -q "^${key}="; then
    echo "ERROR: Missing $key in WAHA container."
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "Fix: bash scripts/deploy-waha.sh"
  exit 1
fi

dl="$(docker exec "$WAHA_CID" env | grep '^WHATSAPP_DOWNLOAD_MEDIA=' | cut -d= -f2-)"
life="$(docker exec "$WAHA_CID" env | grep '^WHATSAPP_FILES_LIFETIME=' | cut -d= -f2-)"
if [ "$dl" != "true" ]; then
  echo "ERROR: WHATSAPP_DOWNLOAD_MEDIA must be true (got: $dl)"
  exit 1
fi
if [ "$life" != "0" ]; then
  echo "ERROR: WHATSAPP_FILES_LIFETIME must be 0 for large album uploads (got: $life)"
  exit 1
fi

echo "==> WAHA media config OK"
waha_docker_compose -p "$WAHA_COMPOSE_PROJECT" -f docker-compose.waha.yml ps

if [ -f "$REPO/scripts/configure-waha-session.sh" ]; then
  if ! bash "$REPO/scripts/configure-waha-session.sh"; then
    echo ""
    echo "ERROR: WAHA WhatsApp session is not WORKING — bot cannot send/receive messages."
    echo "       Run: bash scripts/waha-link-whatsapp.sh"
    echo "       Or:  RESET_WAHA_SESSION=1 bash scripts/configure-waha-session.sh"
    exit 1
  fi
fi
