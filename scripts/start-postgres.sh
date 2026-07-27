#!/usr/bin/env bash
# Start PostgreSQL for Sokoni (works with docker-compose v1 or v2).
set -euo pipefail

REPO="${SOKONI_REPO:-$HOME/sokoni}"
COMPOSE_FILE="$REPO/docker-compose.db.yml"
PROJECT="${SOKONI_DB_PROJECT:-sokoni-db}"
CONTAINER="${SOKONI_PG_CONTAINER:-sokoni_postgres}"

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

pg_ready() {
  docker exec "$CONTAINER" pg_isready -U sokoni -d sokoni >/dev/null 2>&1
}

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: Missing $COMPOSE_FILE — run: cd ~/sokoni && git pull origin main"
  exit 1
fi

cd "$REPO"

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "==> PostgreSQL already running ($CONTAINER)"
elif docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "==> Starting existing container $CONTAINER (name conflict avoided)"
  docker start "$CONTAINER"
else
  echo "==> Creating PostgreSQL (project: $PROJECT)"
  docker_compose -p "$PROJECT" -f docker-compose.db.yml up -d
fi

echo "==> Waiting for Postgres..."
for i in $(seq 1 30); do
  if pg_ready; then
    echo "==> PostgreSQL ready on localhost:5432"
    echo "    DATABASE_URL=postgresql://sokoni:sokoni@localhost:5432/sokoni"
    exit 0
  fi
  sleep 1
done

echo "ERROR: Postgres did not become ready in 30s"
docker ps -a --filter "name=$CONTAINER" || true
exit 1
