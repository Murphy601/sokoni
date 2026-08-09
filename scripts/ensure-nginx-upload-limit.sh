#!/usr/bin/env bash
# Ensure bot nginx allows seller video uploads (25m).
# Live was stuck at default ~1m → XHR died mid-upload → "Failed to fetch".
set -euo pipefail

LIMIT="${NGINX_CLIENT_MAX_BODY_SIZE:-25m}"
CONF_CANDIDATES=(
  /etc/nginx/sites-available/bot.sokonimall.com
  /etc/nginx/sites-enabled/bot.sokonimall.com
  /etc/nginx/conf.d/bot.sokonimall.com.conf
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

patched=0
for conf in "${CONF_CANDIDATES[@]}"; do
  if [ ! -f "$conf" ]; then continue; fi
  if grep -qE 'client_max_body_size[[:space:]]+[0-9]+[kKmMgG]?;' "$conf"; then
    current="$($SUDO grep -E 'client_max_body_size[[:space:]]+[0-9]+[kKmMgG]?;' "$conf" | head -1 | awk '{print $2}' | tr -d ';')"
    # Rewrite anything under 25m (1m / 2m / missing units).
    if echo "$current" | grep -qiE '^(1m|2m|1M|2M|[0-9]+k)$'; then
      $SUDO sed -i -E "s/client_max_body_size[[:space:]]+[0-9]+[kKmMgG]?;/client_max_body_size ${LIMIT};/g" "$conf"
      echo "==> Patched $conf client_max_body_size → ${LIMIT} (was ${current})"
      patched=1
    else
      echo "==> $conf already has client_max_body_size ${current}"
    fi
  else
    # Insert into first server { block
    $SUDO sed -i -E "0,/server[[:space:]]*\{/s//server {\n    client_max_body_size ${LIMIT};/" "$conf"
    echo "==> Inserted client_max_body_size ${LIMIT} into $conf"
    patched=1
  fi
done

if [ "$patched" -eq 1 ]; then
  $SUDO nginx -t
  $SUDO systemctl reload nginx
  echo "==> nginx reloaded"
else
  echo "WARN: no bot nginx conf found to patch — set client_max_body_size ${LIMIT} manually"
  echo "      see docs/DEPLOY_BOT_GCP.md / docs/PRODUCT_VIDEO.md"
fi
