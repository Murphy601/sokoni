#!/usr/bin/env bash
# Shared helpers for WAHA deploy / link / health scripts.
# shellcheck shell=bash

SOKONI_REPO="${SOKONI_REPO:-$HOME/sokoni}"
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
    id="$(docker ps --format '{{.ID}} {{.Image}}' 2>/dev/null | awk 'tolower($0) ~ /waha/ { print $1; exit }' || true)"
  fi
  printf '%s' "$id"
}

waha_print_recent_logs() {
  local cid tail_n="${1:-30}"
  cid="$(waha_container_id)"
  if [ -n "$cid" ]; then
    echo "==> Recent WAHA logs ($cid):"
    docker logs "$cid" --tail "$tail_n" 2>&1 | tail -"$tail_n" || true
  else
    echo "==> No WAHA container found for logs."
  fi
}
