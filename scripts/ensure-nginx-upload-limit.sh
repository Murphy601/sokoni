#!/usr/bin/env bash
# Ensure bot nginx allows multipart uploads (seller video + boda rider docs).
# Live was stuck at default ~1m → XHR died mid-upload → browser "Failed to fetch"
# (413 without CORS headers looks like a network failure in fetch()).
set -euo pipefail

LIMIT="${NGINX_CLIENT_MAX_BODY_SIZE:-25m}"
CONF_CANDIDATES=(
  /etc/nginx/sites-available/bot.sokonimall.com
  /etc/nginx/sites-enabled/bot.sokonimall.com
  /etc/nginx/conf.d/bot.sokonimall.com.conf
  /etc/nginx/sites-available/default
  /etc/nginx/nginx.conf
)

if ! command -v nginx >/dev/null 2>&1; then
  echo "WARN: nginx not installed — skip body-size fix"
  exit 0
fi

if [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
  echo "WARN: need root/sudo to patch nginx client_max_body_size"
  exit 0
fi

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

# Convert nginx size token to bytes for comparison (approx).
size_to_bytes() {
  local s="${1:-0}"
  local n unit
  n="$(echo "$s" | tr -d '[:space:]' | sed -E 's/^([0-9]+).*/\1/')"
  unit="$(echo "$s" | tr -d '[:space:]' | sed -E 's/^[0-9]+//' | tr '[:upper:]' '[:lower:]')"
  case "$unit" in
    g) echo $((n * 1024 * 1024 * 1024)) ;;
    m) echo $((n * 1024 * 1024)) ;;
    k) echo $((n * 1024)) ;;
    *) echo "$n" ;;
  esac
}

TARGET_BYTES="$(size_to_bytes "$LIMIT")"
patched=0
found_conf=0

for conf in "${CONF_CANDIDATES[@]}"; do
  if [ ! -f "$conf" ]; then continue; fi
  found_conf=1
  if grep -qE 'client_max_body_size[[:space:]]+[0-9]+[kKmMgG]?;' "$conf"; then
    current="$($SUDO grep -E 'client_max_body_size[[:space:]]+[0-9]+[kKmMgG]?;' "$conf" | head -1 | awk '{print $2}' | tr -d ';')"
    cur_bytes="$(size_to_bytes "$current")"
    if [ "$cur_bytes" -lt "$TARGET_BYTES" ]; then
      $SUDO sed -i -E "s/client_max_body_size[[:space:]]+[0-9]+[kKmMgG]?;/client_max_body_size ${LIMIT};/g" "$conf"
      echo "==> Patched $conf client_max_body_size → ${LIMIT} (was ${current})"
      patched=1
    else
      echo "==> $conf already has client_max_body_size ${current}"
    fi
  else
    # Insert into first server { block when present; else skip http-level nginx.conf
    if grep -qE 'server[[:space:]]*\{' "$conf"; then
      $SUDO sed -i -E "0,/server[[:space:]]*\{/s//server {\n    client_max_body_size ${LIMIT};/" "$conf"
      echo "==> Inserted client_max_body_size ${LIMIT} into $conf"
      patched=1
    else
      echo "==> Skip $conf (no server block)"
    fi
  fi
done

if [ "$patched" -eq 1 ]; then
  $SUDO nginx -t
  $SUDO systemctl reload nginx
  echo "==> nginx reloaded (needed for /api/riders/register + seller video uploads)"
elif [ "$found_conf" -eq 0 ]; then
  echo "WARN: no bot nginx conf found to patch — set client_max_body_size ${LIMIT} manually"
  echo "      see docs/DEPLOY_BOT_GCP.md / docs/PRODUCT_VIDEO.md"
fi
