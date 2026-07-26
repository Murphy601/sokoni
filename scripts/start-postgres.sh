#!/usr/bin/env bash
# Start PostgreSQL for Sokoni Phase 1 (works with docker-compose v1 or v2).
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
COMPOSE_FILE="$REPO/docker-compose.db.yml"

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "ERROR: Docker Compose not found."
    echo "Install: sudo apt install docker-compose"
    exit 1
  fi
}

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: Missing $COMPOSE_FILE — run: cd ~/sokoni && git pull origin main"
  exit 1
fi

cd "$REPO"
echo "==> Starting PostgreSQL from $COMPOSE_FILE"
docker_compose -f docker-compose.db.yml up -d

echo "==> Waiting for Postgres..."
for i in $(seq 1 30); do
  if docker_compose -f docker-compose.db.yml exec -T postgres pg_isready -U sokoni -d sokoni >/dev/null 2>&1; then
    echo "==> PostgreSQL ready on localhost:5432"
    echo "    DATABASE_URL=postgresql://sokoni:sokoni@localhost:5432/sokoni"
    exit 0
  fi
  sleep 1
done

echo "ERROR: Postgres did not become ready in 30s"
docker_compose -f docker-compose.db.yml ps
exit 1
