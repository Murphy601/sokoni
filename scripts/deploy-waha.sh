#!/usr/bin/env bash
# Start/recreate WAHA with media settings required for WhatsApp catalog photo uploads.
# Safe on docker-compose v1 (no --force-recreate — that triggers ContainerConfig KeyError).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
export SOKONI_REPO="${SOKONI_REPO:-$REPO}"

# shellcheck source=lib/waha-common.sh
source "$SCRIPT_DIR/lib/waha-common.sh"
COMPOSE_FILE="$WAHA_COMPOSE_FILE"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: Missing $COMPOSE_FILE — run: cd ~/sokoni && git pull origin main"
  exit 1
fi

echo "==> Starting WAHA from $COMPOSE_FILE (repo: $SOKONI_REPO)"
cd "$SOKONI_REPO"

if [ "${WIPE_WAHA_SESSIONS:-}" = "1" ]; then
  waha_wipe_sessions_volume
fi

# Resolve WhatsApp Web version on the host (required — empty env breaks compose/NOWEB).
if [ -z "${WAHA_NOWEB_WA_VERSION:-}" ]; then
  if command -v node >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/fetch-wa-version.js" ]; then
    WAHA_NOWEB_WA_VERSION="$(node "$SCRIPT_DIR/fetch-wa-version.js" 2>/dev/null || true)"
  fi
fi
if [ -z "${WAHA_NOWEB_WA_VERSION:-}" ]; then
  # Built-in floor from WAHA 2026.7.2 / current Baileys pin — better than empty.
  WAHA_NOWEB_WA_VERSION="2.3000.1043857760"
  echo "==> Could not fetch live WA version — using fallback $WAHA_NOWEB_WA_VERSION"
fi
export WAHA_NOWEB_WA_VERSION
echo "==> WAHA_NOWEB_WA_VERSION=$WAHA_NOWEB_WA_VERSION"

# Pull the pinned image explicitly (avoid compose ${image:tag} default interpolation bugs).
if [ "${SKIP_WAHA_PULL:-}" != "1" ]; then
  echo "==> Pulling WAHA image ($WAHA_DEFAULT_IMAGE) — set SKIP_WAHA_PULL=1 to skip"
  docker pull "$WAHA_DEFAULT_IMAGE" || echo "WARN: docker pull failed — continuing with cached image"
fi

# Show resolved compose config (catches empty/broken image early).
echo "==> Resolved compose image:"
waha_docker_compose -p "$WAHA_COMPOSE_PROJECT" -f docker-compose.waha.yml config 2>/dev/null \
  | python3 -c "import sys,re
t=sys.stdin.read()
m=re.search(r'image:\\s*[\\\"\\']?([^\\\"\\'\\s]+)', t)
print(m.group(1) if m else 'UNKNOWN')" \
  || echo "(could not render compose config)"

# docker-compose v1.29 + --force-recreate → KeyError: 'ContainerConfig'. Use down + up instead.
# Do NOT use --remove-orphans — it kills sokoni_postgres (separate compose file, same project name).
waha_docker_compose -p "$WAHA_COMPOSE_PROJECT" -f docker-compose.waha.yml down 2>/dev/null || true

# Remove ghost containers left by failed --force-recreate runs (this project only).
docker ps -aq --filter "name=${WAHA_COMPOSE_PROJECT}" 2>/dev/null | xargs -r docker rm -f 2>/dev/null || true

waha_docker_compose -p "$WAHA_COMPOSE_PROJECT" -f docker-compose.waha.yml up -d

sleep 5
WAHA_CID="$(waha_container_id)"
if [ -z "$WAHA_CID" ]; then
  echo "ERROR: WAHA container is not running."
  waha_print_status
  waha_print_recent_logs 60
  exit 1
fi

echo "==> WAHA container: $WAHA_CID"
echo "==> Image: $(docker inspect -f '{{.Config.Image}}' "$WAHA_CID" 2>/dev/null || echo unknown)"
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
echo "==> WAHA_NOWEB_WA_VERSION in container:"
docker exec "$WAHA_CID" env | grep '^WAHA_NOWEB_WA_VERSION=' || echo "(missing)"
waha_docker_compose -p "$WAHA_COMPOSE_PROJECT" -f docker-compose.waha.yml ps

echo "==> Waiting for WAHA HTTP API..."
api_ok=0
for i in $(seq 1 60); do
  if curl -sf -H "X-Api-Key: ${WAHA_KEY}" "${WAHA_URL}/api/sessions" >/dev/null 2>&1; then
    echo "==> WAHA API ready (${i}s)"
    api_ok=1
    break
  fi
  # Surface crash-loops early
  if [ $((i % 10)) -eq 0 ]; then
    echo "  … still waiting (${i}s)"
    waha_print_recent_logs 15
  fi
  sleep 1
done

if [ "$api_ok" -ne 1 ]; then
  echo "ERROR: WAHA container is up but API never became ready at $WAHA_URL"
  waha_print_status
  waha_print_recent_logs 80
  echo "Inspect: docker logs $WAHA_CID --tail 100"
  exit 1
fi

if [ -f "$SCRIPT_DIR/configure-waha-session.sh" ]; then
  if ! bash "$SCRIPT_DIR/configure-waha-session.sh"; then
    echo ""
    echo "WARN: WAHA container is up, but WhatsApp session is not WORKING yet."
    echo "      Link the phone (pairing code / QR):"
    echo "        bash scripts/waha-link-whatsapp.sh"
    echo "      Or reset:"
    echo "        RESET_WAHA_SESSION=1 bash scripts/configure-waha-session.sh"
    # Container itself succeeded — linking is a separate step.
    exit 0
  fi
fi
