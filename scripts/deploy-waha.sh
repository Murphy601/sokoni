#!/usr/bin/env bash
# Recreate WAHA with media settings required for WhatsApp catalog photo uploads.
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
COMPOSE_FILE="$REPO/docker-compose.waha.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: Missing $COMPOSE_FILE — run: cd ~/sokoni && git pull origin main"
  exit 1
fi

echo "==> Recreating WAHA from $COMPOSE_FILE"
cd "$REPO"
docker compose -f docker-compose.waha.yml up -d --force-recreate --remove-orphans

sleep 4
WAHA_CID="$(docker ps -qf 'ancestor=devlikeapro/waha:latest' | head -1)"
if [ -z "$WAHA_CID" ]; then
  echo "ERROR: WAHA container is not running."
  docker compose -f docker-compose.waha.yml ps
  exit 1
fi

echo "==> WAHA container: $WAHA_CID"
echo "==> WAHA WhatsApp env:"
docker exec "$WAHA_CID" env | grep -E '^WHATSAPP_' | sort || true

missing=0
for key in WHATSAPP_DOWNLOAD_MEDIA WHATSAPP_FILES_LIFETIME WHATSAPP_FILES_FOLDER; do
  if ! docker exec "$WAHA_CID" env | grep -q "^${key}="; then
    echo "ERROR: Missing $key in WAHA container — recreate failed."
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "Fix: docker compose -f docker-compose.waha.yml down && docker compose -f docker-compose.waha.yml up -d --force-recreate"
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
docker compose -f docker-compose.waha.yml ps
