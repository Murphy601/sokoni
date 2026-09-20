#!/usr/bin/env bash
# Push encrypted backup archives to a private git repo.
#
# Why git rather than object storage: Cloudflare R2, Backblaze B2 and GCS all
# want a payment method or a wider VM scope before they will issue write
# access. A private GitHub repo is free with no card, and the VM already
# speaks git. The archive is AES-256 encrypted before it gets here, so the
# remote only ever holds ciphertext.
#
# Size is bounded by force-pushing a single orphan commit each run: the repo
# holds the last N archives and no history. Without that, a daily commit of a
# 3MB blob grows forever.
#
# Usage: bash scripts/lib/git-backup-push.sh <encrypted-archive>
#
# Env:
#   SOKONI_BACKUP_GIT_REMOTE  git@github.com:<you>/sokoni-backups.git
#   SOKONI_BACKUP_GIT_KEY     ~/.ssh/sokoni_backup_ed25519  (deploy key, write access)
#   SOKONI_BACKUP_GIT_KEEP    14
#   SOKONI_BACKUP_GIT_WORKDIR ~/.sokoni-backup-repo
#
# Exit codes: 0 pushed · 3 not configured · 1 failed

set -uo pipefail

ARCHIVE="${1:-}"
REMOTE="${SOKONI_BACKUP_GIT_REMOTE:-}"
KEY="${SOKONI_BACKUP_GIT_KEY:-$HOME/.ssh/sokoni_backup_ed25519}"
KEEP="${SOKONI_BACKUP_GIT_KEEP:-14}"
WORKDIR="${SOKONI_BACKUP_GIT_WORKDIR:-$HOME/.sokoni-backup-repo}"

log() { echo "[git-backup] $*"; }

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  log "usage: git-backup-push.sh <encrypted-archive>"
  exit 1
fi

# Refuse plaintext. The remote is a git host, not a safe place for order data.
case "$ARCHIVE" in
  *.enc) ;;
  *)
    log "refusing to push a non-encrypted archive ($(basename "$ARCHIVE"))"
    exit 1
    ;;
esac

if [ -z "$REMOTE" ]; then
  log "not configured — SOKONI_BACKUP_GIT_REMOTE unset"
  exit 3
fi
if [ ! -f "$KEY" ]; then
  log "not configured — ssh key not found at $KEY"
  exit 3
fi

export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

if [ ! -d "$WORKDIR/.git" ]; then
  log "initialising $WORKDIR"
  rm -rf "$WORKDIR"
  mkdir -p "$WORKDIR"
  git -C "$WORKDIR" init -q
  git -C "$WORKDIR" remote add origin "$REMOTE"
fi
chmod 700 "$WORKDIR"

git -C "$WORKDIR" remote set-url origin "$REMOTE"
# Identity is per-repo so this never touches the deploy clone's config.
git -C "$WORKDIR" config user.name "sokoni-backup"
git -C "$WORKDIR" config user.email "backup@sokonimall.com"

# Pull down what is already stored so we keep a rolling window rather than
# replacing the remote with a single file every night.
if git -C "$WORKDIR" fetch -q --depth 1 origin main 2>/dev/null; then
  git -C "$WORKDIR" checkout -q -B main FETCH_HEAD 2>/dev/null || true
else
  log "no remote main yet (first run)"
fi

cp -a "$ARCHIVE" "$WORKDIR/$(basename "$ARCHIVE")"

# Keep the newest N archives, drop the rest.
mapfile -t stale < <(cd "$WORKDIR" && ls -1t sokoni-data-*.tar.gz.enc 2>/dev/null | tail -n +"$((KEEP + 1))")
for old in "${stale[@]:-}"; do
  [ -n "$old" ] || continue
  rm -f "$WORKDIR/$old"
  log "pruned $old"
done

cat > "$WORKDIR/README.md" <<'EOF'
# Sokoni encrypted backups

Automated. Do not edit by hand.

Every file is an AES-256-CBC (pbkdf2) encrypted tarball of
`whatsapp-bot/data/` from the bot VM — order records, settlements,
withdrawals, and buyer dispute evidence.

**This repository must stay private.** The contents are ciphertext, but the
passphrase is the only thing between it and live financial records.

Restore:

    openssl enc -d -aes-256-cbc -pbkdf2 \
      -in sokoni-data-YYYYmmdd-HHMMSS.tar.gz.enc \
      -out restore.tar.gz -pass env:SOKONI_BACKUP_PASSPHRASE
    tar -xzf restore.tar.gz -C ~/sokoni/whatsapp-bot

The passphrase is NOT stored here or on the VM's repo. If it is lost these
files are unrecoverable.
EOF

# Single orphan commit, force-pushed: bounded repo, no history growth.
git -C "$WORKDIR" checkout -q --orphan rolling 2>/dev/null || git -C "$WORKDIR" checkout -q -B rolling
git -C "$WORKDIR" add -A
if git -C "$WORKDIR" diff --cached --quiet 2>/dev/null; then
  log "nothing changed — skipping push"
  exit 0
fi
git -C "$WORKDIR" commit -q -m "backup $(date -Is)"
git -C "$WORKDIR" branch -M rolling main

if git -C "$WORKDIR" push -q --force origin main; then
  count="$(cd "$WORKDIR" && ls -1 sokoni-data-*.tar.gz.enc 2>/dev/null | wc -l)"
  log "pushed — remote now holds $count archive(s)"
  exit 0
fi

log "push failed — check the deploy key has WRITE access to $REMOTE"
exit 1
