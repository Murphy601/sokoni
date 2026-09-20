#!/usr/bin/env bash
# Snapshot the file-backed stores under whatsapp-bot/data, encrypt, ship off-site.
#
# orders.json, settlements.json and withdrawals.json are the only copy of order
# and payout state. They are gitignored (so deploy-bot.sh's hard reset leaves
# them alone), which also means nothing else backs them up. A local snapshot
# survives file corruption; only an off-site copy survives losing the VM.
#
# Snapshots carry order records and buyer dispute photos, so the archive is
# encrypted before it leaves the box and the plaintext tar is shredded.
#
# Install on the VM (user crontab, so the env file must be readable by that
# user -- keep it in $HOME, not /etc, or cron cannot source it):
#   nano ~/.sokoni-backup.env && chmod 600 ~/.sokoni-backup.env
#   crontab -e
#   15 2 * * * set -a; . $HOME/.sokoni-backup.env; set +a; /bin/bash $HOME/sokoni/scripts/backup-bot-data.sh >> $HOME/sokoni-backups/backup.log 2>&1
#
# BACKUP ENV (~/.sokoni-backup.env, owned by the cron user, chmod 600):
#   SOKONI_BACKUP_PASSPHRASE=<long random>     # required for encryption + upload
#
#   # Target A — private git repo. Free, no payment method, no new install.
#   SOKONI_BACKUP_GIT_REMOTE=git@github.com:<you>/sokoni-backups.git
#   SOKONI_BACKUP_GIT_KEY=/home/<user>/.ssh/sokoni_backup_ed25519
#   # SOKONI_BACKUP_GIT_KEEP=14
#
#   # Target B — S3-compatible (R2/S3/B2). Needs a card on the provider.
#   # SOKONI_BACKUP_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
#   # SOKONI_BACKUP_S3_BUCKET=sokoni-backups
#   # SOKONI_BACKUP_S3_ACCESS_KEY=...
#   # SOKONI_BACKUP_S3_SECRET_KEY=...
#   # SOKONI_BACKUP_S3_REGION=auto            # R2 wants "auto"; S3 wants a real region
#
#   # SOKONI_BACKUP_TARGET=git|s3|none        # default: auto-detect from the above
#   # SOKONI_BACKUP_KEEP_DAYS=14
#
# Restore:
#   openssl enc -d -aes-256-cbc -pbkdf2 -in sokoni-data-YYYYmmdd-HHMMSS.tar.gz.enc \
#     -out restore.tar.gz -pass env:SOKONI_BACKUP_PASSPHRASE
#   pm2 stop sokoni-bot
#   tar -xzf restore.tar.gz -C ~/sokoni/whatsapp-bot
#   pm2 start sokoni-bot
#
# Degrades rather than fails: no passphrase means a local plaintext snapshot
# with a warning; no S3 config means local-only with a warning. Either way the
# exit code stays 0 so cron does not mail on every run — grep the log for WARN.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$REPO_ROOT/whatsapp-bot/data"
DEST="${SOKONI_BACKUP_DIR:-$HOME/sokoni-backups}"
KEEP_DAYS="${SOKONI_BACKUP_KEEP_DAYS:-14}"
PASSPHRASE="${SOKONI_BACKUP_PASSPHRASE:-}"

log() { echo "$(date -Is) $*"; }

if [ ! -d "$DATA_DIR" ]; then
  log "no data dir at $DATA_DIR — nothing to back up"
  exit 0
fi

mkdir -p "$DEST"
chmod 700 "$DEST"

STAMP="$(date +%Y%m%d-%H%M%S)"
PLAIN="$DEST/sokoni-data-$STAMP.tar.gz"

# Skip temp files an in-flight atomic write may have left mid-rename.
if ! tar -czf "$PLAIN" -C "$REPO_ROOT/whatsapp-bot" --exclude='*.tmp' data; then
  log "ERROR: tar failed — no snapshot written"
  rm -f "$PLAIN"
  exit 1
fi
chmod 600 "$PLAIN"

# Verify the archive reads back before trusting it.
if ! tar -tzf "$PLAIN" >/dev/null 2>&1; then
  log "ERROR: archive unreadable — removing $PLAIN"
  rm -f "$PLAIN"
  exit 1
fi

# Confirm the money files made it in.
for want in data/orders.json data/settlements.json data/withdrawals.json; do
  if [ -f "$REPO_ROOT/whatsapp-bot/$want" ] && ! tar -tzf "$PLAIN" | grep -qx "$want"; then
    log "WARN: $want exists on disk but is missing from the archive"
  fi
done

ARCHIVE="$PLAIN"

if [ -n "$PASSPHRASE" ]; then
  ENC="$PLAIN.enc"
  if openssl enc -aes-256-cbc -pbkdf2 -salt -in "$PLAIN" -out "$ENC" -pass env:SOKONI_BACKUP_PASSPHRASE; then
    chmod 600 "$ENC"
    # Prove it decrypts before throwing the plaintext away.
    if openssl enc -d -aes-256-cbc -pbkdf2 -in "$ENC" -pass env:SOKONI_BACKUP_PASSPHRASE 2>/dev/null \
        | tar -tz >/dev/null 2>&1; then
      rm -f "$PLAIN"
      ARCHIVE="$ENC"
      log "encrypted $(basename "$ENC")"
    else
      log "ERROR: encrypted archive did not decrypt — keeping plaintext, removing .enc"
      rm -f "$ENC"
    fi
  else
    log "WARN: openssl encryption failed — keeping local plaintext snapshot only"
    rm -f "$ENC"
  fi
else
  log "WARN: SOKONI_BACKUP_PASSPHRASE unset — snapshot is UNENCRYPTED and will not be uploaded"
fi

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
log "wrote $ARCHIVE ($SIZE)"

# Off-site. Only ships encrypted archives — never push plaintext order data.
#
# Two targets. git is the default because it is free with no payment method:
# R2/B2/GCS all want a card or a wider VM scope first. Set
# SOKONI_BACKUP_TARGET to force one.
if [ "$ARCHIVE" != "${ARCHIVE%.enc}" ]; then
  target="${SOKONI_BACKUP_TARGET:-auto}"
  if [ "$target" = "auto" ]; then
    if [ -n "${SOKONI_BACKUP_GIT_REMOTE:-}" ]; then
      target="git"
    elif [ -n "${SOKONI_BACKUP_S3_ENDPOINT:-}" ]; then
      target="s3"
    else
      target="none"
    fi
  fi

  case "$target" in
    git)
      bash "$REPO_ROOT/scripts/lib/git-backup-push.sh" "$ARCHIVE"
      code=$?
      ;;
    s3)
      node "$REPO_ROOT/scripts/lib/s3-put.mjs" "$ARCHIVE" "$(basename "$ARCHIVE")"
      code=$?
      ;;
    none)
      code=3
      ;;
    *)
      log "WARN: unknown SOKONI_BACKUP_TARGET='$target' (expected git, s3 or none)"
      code=3
      ;;
  esac

  if [ "$code" -eq 0 ]; then
    log "off-site copy OK ($target)"
  elif [ "$code" -eq 3 ]; then
    log "WARN: off-site upload skipped — no target configured (local copy only)"
    log "      set SOKONI_BACKUP_GIT_REMOTE (free) or SOKONI_BACKUP_S3_* in ~/.sokoni-backup.env"
  else
    log "WARN: off-site upload failed (exit $code) — local copy retained, will retry next run"
  fi
else
  log "WARN: no off-site upload (archive is not encrypted)"
fi

DELETED="$(find "$DEST" -name 'sokoni-data-*.tar.gz*' -mtime "+$KEEP_DAYS" -print -delete | wc -l)"
if [ "$DELETED" -gt 0 ]; then
  log "pruned $DELETED snapshot(s) older than $KEEP_DAYS days"
fi
