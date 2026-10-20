#!/usr/bin/env bash
# Delete WAHA media files older than N days.
#
# WAHA runs with WHATSAPP_FILES_LIFETIME=0, which means "never expire". That is
# deliberate -- the 180s default was deleting files mid-album while sellers
# uploaded catalog photos -- but it also means every photo and voice note ever
# received is still in the waha_media volume on this VM.
#
# Nothing else clears it. On a 1GB VM that ends one way.
#
# The bot only needs a file while it is still being served: a catalog photo is
# copied out during import, and a chat voice note is streamed on demand. Two
# weeks is far longer than either needs and still bounds the volume.
#
#   bash scripts/purge-waha-media.sh            # delete older than 14 days
#   bash scripts/purge-waha-media.sh 30         # or pick your own
#   DRY_RUN=1 bash scripts/purge-waha-media.sh  # show what would go
set -euo pipefail

DAYS="${1:-14}"
MEDIA_DIR="${WAHA_MEDIA_DIR:-/app/.media}"
DRY_RUN="${DRY_RUN:-0}"

if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [ "$DAYS" -lt 1 ]; then
  echo "ERROR: days must be a positive integer (got: $DAYS)" >&2
  exit 1
fi

CID="$(docker ps --filter 'ancestor=devlikeapro/waha' --format '{{.ID}}' | head -1)"
if [ -z "$CID" ]; then
  CID="$(docker ps --filter 'name=waha' --format '{{.ID}}' | head -1)"
fi
if [ -z "$CID" ]; then
  echo "ERROR: no running WAHA container found" >&2
  exit 1
fi

if ! docker exec "$CID" test -d "$MEDIA_DIR"; then
  echo "ERROR: $MEDIA_DIR does not exist in the container" >&2
  exit 1
fi

before="$(docker exec "$CID" du -sh "$MEDIA_DIR" 2>/dev/null | cut -f1 || echo '?')"
count="$(docker exec "$CID" find "$MEDIA_DIR" -type f -mtime "+$DAYS" 2>/dev/null | wc -l | tr -d ' ')"

echo "WAHA media:   $MEDIA_DIR ($before)"
echo "Older than:   ${DAYS}d"
echo "Would delete: $count file(s)"

if [ "$count" = "0" ]; then
  echo "Nothing to do."
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY_RUN=1 — listing the ten oldest, deleting nothing:"
  docker exec "$CID" find "$MEDIA_DIR" -type f -mtime "+$DAYS" -printf '%T+ %p\n' 2>/dev/null | sort | head -10 || true
  exit 0
fi

# -delete rather than a piped rm: no filename ever reaches a shell, so a file
# named with a space or a quote cannot turn into something else.
docker exec "$CID" find "$MEDIA_DIR" -type f -mtime "+$DAYS" -delete

after="$(docker exec "$CID" du -sh "$MEDIA_DIR" 2>/dev/null | cut -f1 || echo '?')"
echo "Deleted $count file(s). $before -> $after"
