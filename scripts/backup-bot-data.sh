#!/usr/bin/env bash
# Snapshot the file-backed stores under whatsapp-bot/data.
#
# orders.json, settlements.json and withdrawals.json are the only copy of
# order and payout state. They are gitignored (so deploy-bot.sh's hard reset
# leaves them alone), which also means nothing else backs them up.
#
# Install on the VM:
#   crontab -e
#   15 2 * * * /bin/bash $HOME/sokoni/scripts/backup-bot-data.sh >> $HOME/sokoni-backups/backup.log 2>&1
#
# Restore:
#   pm2 stop sokoni-bot
#   tar -xzf ~/sokoni-backups/sokoni-data-YYYYmmdd-HHMMSS.tar.gz -C ~/sokoni/whatsapp-bot
#   pm2 start sokoni-bot

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$REPO_ROOT/whatsapp-bot/data"
DEST="${SOKONI_BACKUP_DIR:-$HOME/sokoni-backups}"
KEEP_DAYS="${SOKONI_BACKUP_KEEP_DAYS:-14}"

if [ ! -d "$DATA_DIR" ]; then
  echo "$(date -Is) no data dir at $DATA_DIR — nothing to back up"
  exit 0
fi

mkdir -p "$DEST"
# Snapshots hold order records and buyer dispute photos. Keep them owner-only.
chmod 700 "$DEST"

STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$DEST/sokoni-data-$STAMP.tar.gz"

# Skip temp files an in-flight atomic write may have left mid-rename.
tar -czf "$ARCHIVE" \
  -C "$REPO_ROOT/whatsapp-bot" \
  --exclude='*.tmp' \
  data
chmod 600 "$ARCHIVE"

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo "$(date -Is) wrote $ARCHIVE ($SIZE)"

# Verify the archive actually reads back before trusting it.
if ! tar -tzf "$ARCHIVE" >/dev/null 2>&1; then
  echo "$(date -Is) ARCHIVE IS UNREADABLE — removing $ARCHIVE" >&2
  rm -f "$ARCHIVE"
  exit 1
fi

# Confirm the money files made it in.
for want in data/orders.json data/settlements.json; do
  if [ -f "$REPO_ROOT/whatsapp-bot/$want" ] && ! tar -tzf "$ARCHIVE" | grep -qx "$want"; then
    echo "$(date -Is) WARNING: $want exists on disk but is missing from the archive" >&2
  fi
done

DELETED="$(find "$DEST" -name 'sokoni-data-*.tar.gz' -mtime "+$KEEP_DAYS" -print -delete | wc -l)"
if [ "$DELETED" -gt 0 ]; then
  echo "$(date -Is) pruned $DELETED snapshot(s) older than $KEEP_DAYS days"
fi
