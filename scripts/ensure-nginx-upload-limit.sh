#!/usr/bin/env bash
# Ensure bot nginx allows multipart uploads (seller video + boda rider docs).
# Live was stuck at default ~1m → XHR died mid-upload → browser "Failed to fetch"
# (413 without CORS headers looks like a network failure in fetch()).
#
# HISTORY — read before changing the insertion logic.
# The first version matched /server[[:space:]]*\{/ and inserted after the first
# hit. In stock Ubuntu's /etc/nginx/nginx.conf the first hit is inside the
# commented-out mail sample:
#
#   #       server {
#       client_max_body_size 25m;     <-- inserted uncommented, main context
#
# client_max_body_size is only legal in http / server / location, so nginx
# refused to start. It ran `nginx -t` afterwards but reloaded regardless and
# had no rollback, so the box stayed up on its old config and the breakage only
# surfaced 19 hours later when certbot reloaded. The site was down until
# someone read the error by hand.
#
# Rules now:
#   1. Never match a commented line.
#   2. Only insert into `server {` in a SITE config, never into nginx.conf.
#      nginx.conf gets the directive at `http {` level or not at all.
#   3. Back up every file before editing.
#   4. `nginx -t` decides. Invalid => restore every backup and exit non-zero.
#   5. Only reload after a passing test.

set -uo pipefail

LIMIT="${NGINX_CLIENT_MAX_BODY_SIZE:-25m}"

# Site configs: safe to insert a server-level directive.
SITE_CONFS=(
  /etc/nginx/sites-available/bot.sokonimall.com
  /etc/nginx/sites-enabled/bot.sokonimall.com
  /etc/nginx/conf.d/bot.sokonimall.com.conf
  /etc/nginx/sites-available/default
)
# Main config: http-level only. Never a server block.
MAIN_CONF=/etc/nginx/nginx.conf

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

size_to_bytes() {
  local s="${1:-0}" n unit
  n="$(echo "$s" | tr -d '[:space:]' | sed -E 's/^([0-9]+).*/\1/')"
  unit="$(echo "$s" | tr -d '[:space:]' | sed -E 's/^[0-9]+//' | tr '[:upper:]' '[:lower:]')"
  case "$unit" in
    g) echo $((n * 1024 * 1024 * 1024)) ;;
    m) echo $((n * 1024 * 1024)) ;;
    k) echo $((n * 1024)) ;;
    *) echo "${n:-0}" ;;
  esac
}

# Uncommented directive only — a commented example must not count as "present".
LIVE_DIRECTIVE='^[[:space:]]*client_max_body_size[[:space:]]+[0-9]+[kKmMgG]?;'
# Uncommented `server {` only — the mail sample in nginx.conf is all comments.
LIVE_SERVER_BLOCK='^[[:space:]]*server[[:space:]]*\{'
LIVE_HTTP_BLOCK='^[[:space:]]*http[[:space:]]*\{'

TARGET_BYTES="$(size_to_bytes "$LIMIT")"
patched=0
found_conf=0
BACKUP_STAMP="$(date +%s)"
declare -a BACKED_UP=()

backup_conf() {
  local conf="$1"
  $SUDO cp -a "$conf" "${conf}.sokoni-bak-${BACKUP_STAMP}" || return 1
  BACKED_UP+=("$conf")
  return 0
}

restore_all() {
  for conf in "${BACKED_UP[@]:-}"; do
    [ -n "$conf" ] || continue
    if [ -f "${conf}.sokoni-bak-${BACKUP_STAMP}" ]; then
      $SUDO cp -a "${conf}.sokoni-bak-${BACKUP_STAMP}" "$conf"
      echo "==> Restored $conf"
    fi
  done
}

count_live_directives() {
  $SUDO grep -cE "$LIVE_DIRECTIVE" "$1" 2>/dev/null || echo 0
}

# Raise an existing (uncommented) limit that is too small.
raise_if_small() {
  local conf="$1" current cur_bytes
  current="$($SUDO grep -E "$LIVE_DIRECTIVE" "$conf" | head -1 | awk '{print $2}' | tr -d ';')"
  cur_bytes="$(size_to_bytes "$current")"
  if [ "$cur_bytes" -lt "$TARGET_BYTES" ]; then
    backup_conf "$conf" || { echo "WARN: could not back up $conf — skipping"; return; }
    $SUDO sed -i -E "s/^([[:space:]]*)client_max_body_size[[:space:]]+[0-9]+[kKmMgG]?;/\\1client_max_body_size ${LIMIT};/" "$conf"
    echo "==> Patched $conf client_max_body_size → ${LIMIT} (was ${current})"
    patched=1
  else
    echo "==> $conf already has client_max_body_size ${current}"
  fi
}

for conf in "${SITE_CONFS[@]}"; do
  [ -f "$conf" ] || continue
  found_conf=1
  live_count="$(count_live_directives "$conf")"

  if [ "$live_count" -gt 1 ]; then
    echo "WARN: $conf has ${live_count} client_max_body_size directives — leaving it alone"
    continue
  fi

  if [ "$live_count" -eq 1 ]; then
    raise_if_small "$conf"
    continue
  fi

  if $SUDO grep -qE "$LIVE_SERVER_BLOCK" "$conf"; then
    backup_conf "$conf" || { echo "WARN: could not back up $conf — skipping"; continue; }
    $SUDO sed -i -E "0,/${LIVE_SERVER_BLOCK}/s//server {\n    client_max_body_size ${LIMIT};/" "$conf"
    echo "==> Inserted client_max_body_size ${LIMIT} into $conf (server block)"
    patched=1
  else
    echo "==> Skip $conf (no uncommented server block)"
  fi
done

# nginx.conf: http level only, and only when nothing is set there yet.
if [ -f "$MAIN_CONF" ]; then
  found_conf=1
  main_count="$(count_live_directives "$MAIN_CONF")"
  if [ "$main_count" -gt 1 ]; then
    echo "WARN: $MAIN_CONF has ${main_count} client_max_body_size directives — duplicate, leaving it alone"
  elif [ "$main_count" -eq 1 ]; then
    raise_if_small "$MAIN_CONF"
  elif $SUDO grep -qE "$LIVE_HTTP_BLOCK" "$MAIN_CONF"; then
    backup_conf "$MAIN_CONF" || echo "WARN: could not back up $MAIN_CONF — skipping"
    if [ -f "${MAIN_CONF}.sokoni-bak-${BACKUP_STAMP}" ]; then
      $SUDO sed -i -E "0,/${LIVE_HTTP_BLOCK}/s//http {\n    client_max_body_size ${LIMIT};/" "$MAIN_CONF"
      echo "==> Inserted client_max_body_size ${LIMIT} into $MAIN_CONF (http block)"
      patched=1
    fi
  else
    echo "==> Skip $MAIN_CONF (no http block found)"
  fi
fi

if [ "$patched" -ne 1 ]; then
  if [ "$found_conf" -eq 0 ]; then
    echo "WARN: no bot nginx conf found to patch — set client_max_body_size ${LIMIT} manually"
    echo "      see docs/DEPLOY_BOT_GCP.md / docs/PRODUCT_VIDEO.md"
  fi
  exit 0
fi

# The test decides. A bad edit is rolled back rather than left for certbot to find.
if ! $SUDO nginx -t; then
  echo "ERROR: nginx -t failed after patching — rolling back every change."
  restore_all
  if $SUDO nginx -t; then
    echo "==> Rollback verified: nginx config is valid again. Upload limit NOT applied."
  else
    echo "ERROR: config still invalid after rollback — nginx was already broken before this script ran."
    echo "       Backups: *.sokoni-bak-${BACKUP_STAMP}"
  fi
  exit 1
fi

if $SUDO systemctl reload nginx; then
  echo "==> nginx reloaded (needed for /api/riders/register + seller video uploads)"
else
  echo "WARN: nginx -t passed but reload failed — check: systemctl status nginx"
  exit 1
fi
