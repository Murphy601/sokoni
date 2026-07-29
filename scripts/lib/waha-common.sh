#!/usr/bin/env bash
# Shared helpers for WAHA deploy / link / health scripts.
# shellcheck shell=bash

# Prefer the repo that contains this file (not a stale $HOME/sokoni guess).
_WAHA_COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_WAHA_REPO_ROOT="$(cd "${_WAHA_COMMON_DIR}/../.." && pwd)"
SOKONI_REPO="${SOKONI_REPO:-$_WAHA_REPO_ROOT}"
WAHA_COMPOSE_FILE="${WAHA_COMPOSE_FILE:-$SOKONI_REPO/docker-compose.waha.yml}"
WAHA_COMPOSE_PROJECT="${WAHA_COMPOSE_PROJECT:-sokoni-waha}"
WAHA_URL="${WAHA_API_URL:-http://127.0.0.1:3000}"
WAHA_KEY="${WAHA_API_KEY:-sokoni-local-dev-key}"
WAHA_SESSION="${WAHA_SESSION:-default}"
WAHA_DEFAULT_IMAGE="${WAHA_IMAGE:-devlikeapro/waha:latest-2026.6.2}"

waha_docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "ERROR: Docker Compose not found." >&2
    return 127
  fi
}

# Resolve running WAHA container id (pinned image or compose project).
waha_container_id() {
  local id=""
  if [ -f "$WAHA_COMPOSE_FILE" ]; then
    id="$(
      waha_docker_compose -p "$WAHA_COMPOSE_PROJECT" -f "$WAHA_COMPOSE_FILE" ps -q waha 2>/dev/null | head -1 || true
    )"
  fi
  if [ -z "$id" ]; then
    id="$(docker ps -qf "name=${WAHA_COMPOSE_PROJECT}" 2>/dev/null | head -1 || true)"
  fi
  if [ -z "$id" ]; then
    # Match any running container whose image or name mentions waha.
    id="$(docker ps --format '{{.ID}} {{.Image}} {{.Names}}' 2>/dev/null | awk 'tolower($0) ~ /waha/ { print $1; exit }' || true)"
  fi
  printf '%s' "$id"
}

# Most recent WAHA container (running or exited) — for diagnostics.
waha_container_id_any() {
  local id=""
  id="$(waha_container_id)"
  if [ -n "$id" ]; then
    printf '%s' "$id"
    return 0
  fi
  id="$(docker ps -aqf "name=${WAHA_COMPOSE_PROJECT}" 2>/dev/null | head -1 || true)"
  if [ -z "$id" ]; then
    id="$(docker ps -a --format '{{.ID}} {{.Image}} {{.Names}}' 2>/dev/null | awk 'tolower($0) ~ /waha/ { print $1; exit }' || true)"
  fi
  printf '%s' "$id"
}

waha_print_recent_logs() {
  local cid tail_n="${1:-40}"
  cid="$(waha_container_id_any)"
  if [ -n "$cid" ]; then
    echo "==> Recent WAHA logs ($cid):"
    docker logs "$cid" --tail "$tail_n" 2>&1 | tail -"$tail_n" || true
  else
    echo "==> No WAHA container found for logs."
  fi
}

waha_print_status() {
  echo "==> docker compose ps:"
  if [ -f "$WAHA_COMPOSE_FILE" ]; then
    waha_docker_compose -p "$WAHA_COMPOSE_PROJECT" -f "$WAHA_COMPOSE_FILE" ps || true
  fi
  echo "==> docker ps -a (waha):"
  docker ps -a --format 'table {{.ID}}\t{{.Status}}\t{{.Image}}\t{{.Names}}' 2>/dev/null | awk 'NR==1 || tolower($0) ~ /waha/' || true
}
