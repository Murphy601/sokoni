# Backup setup (free, no payment method)

`whatsapp-bot/data/` holds the only copy of order, settlement and withdrawal
state. It is gitignored — which is what protects it from `deploy-bot.sh`'s
`git reset --hard` — and that also means nothing else backs it up.

About 3 MB today. Fourteen snapshots is ~45 MB.

## Why a git repo and not object storage

| Option | Free? | Blocker |
|---|---|---|
| Cloudflare R2 | 10 GB | needs a card on file before it issues API tokens |
| Backblaze B2 | 10 GB | same |
| Google Cloud Storage | 5 GB always-free | VM service account is `devstorage.read_only`; widening it needs a stop/start, which takes WhatsApp down |
| **Private GitHub repo** | **unlimited** | **none — the VM already speaks git** |

The archive is AES-256 encrypted on the VM before it is pushed, so the remote
only ever holds ciphertext. The S3 path still exists in the script for whenever
a card does exist — set `SOKONI_BACKUP_S3_*` instead and it switches over.

---

## 1. Passphrase

On the VM:

```bash
openssl rand -base64 48
```

**Store this off the VM** — password manager, or on paper. It is the only thing
that decrypts the backups. Losing it makes every archive permanently
unreadable. Do not keep it *only* in the env file, which lives on the machine
the backups exist to protect.

## 2. A dedicated SSH key

The VM's existing GitHub key is a **deploy key scoped to `Murphy601/sokoni`** —
`ssh -T git@github.com` answers `Hi Murphy601/sokoni!`, the repo name rather
than a username. It cannot push anywhere else, so the backup repo needs its own.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/sokoni_backup_ed25519 -N "" -C "sokoni-backup"
```

```bash
cat ~/.ssh/sokoni_backup_ed25519.pub
```

Copy that line. It is a **public** key — safe to paste anywhere.

## 3. The backup repo

On GitHub:

1. **New repository** → name `sokoni-backups` → **Private** → Create
2. That repo → **Settings** → **Deploy keys** → **Add deploy key**
3. Title `sokoni-bot VM`, paste the public key from step 2
4. **Tick "Allow write access"** — without it every push fails
5. Add key

Keep the repo private. The contents are ciphertext, but treat it as if it were
not.

## 4. Env file on the VM

```bash
nano ~/.sokoni-backup.env
```

```bash
SOKONI_BACKUP_PASSPHRASE=<the passphrase from step 1>
SOKONI_BACKUP_GIT_REMOTE=git@github.com:Murphy601/sokoni-backups.git
SOKONI_BACKUP_GIT_KEY=/home/daviemuiruri3888/.ssh/sokoni_backup_ed25519
SOKONI_BACKUP_GIT_KEEP=14
```

```bash
chmod 600 ~/.sokoni-backup.env
```

## 5. Test before trusting it

```bash
set -a; . ~/.sokoni-backup.env; set +a; bash ~/sokoni/scripts/backup-bot-data.sh
```

Expect:

```
encrypted sokoni-data-…tar.gz.enc
wrote …
[git-backup] pushed — remote now holds 1 archive(s)
off-site copy OK (git)
```

`push failed — check the deploy key has WRITE access` means step 3.4 was missed.

## 6. Prove you can restore

An untested backup is not a backup.

```bash
set -a; . ~/.sokoni-backup.env; set +a; openssl enc -d -aes-256-cbc -pbkdf2 -in "$(ls -t ~/sokoni-backups/*.enc | head -1)" -pass env:SOKONI_BACKUP_PASSPHRASE | tar -tz | head
```

You want `data/orders.json` and `data/settlements.json` in the listing.

## 7. Schedule it

```bash
( crontab -l 2>/dev/null; echo '15 2 * * * set -a; . $HOME/.sokoni-backup.env; set +a; /bin/bash $HOME/sokoni/scripts/backup-bot-data.sh >> $HOME/sokoni-backups/backup.log 2>&1' ) | crontab -
```

```bash
crontab -l | grep backup-bot-data
```

Check it a day later:

```bash
tail -20 ~/sokoni-backups/backup.log
```

The script exits 0 even when a target is unreachable, so cron stays quiet —
`grep WARN ~/sokoni-backups/backup.log` is how you find silent degradation.

---

## Restoring for real

```bash
pm2 stop sokoni-bot
```

```bash
set -a; . ~/.sokoni-backup.env; set +a; openssl enc -d -aes-256-cbc -pbkdf2 -in <archive>.enc -out /tmp/restore.tar.gz -pass env:SOKONI_BACKUP_PASSPHRASE
```

```bash
tar -xzf /tmp/restore.tar.gz -C ~/sokoni/whatsapp-bot
```

```bash
pm2 start sokoni-bot && curl -s https://bot.sokonimall.com/health | head -c 120
```

If the VM itself is gone, clone the backup repo anywhere, decrypt, and drop
`data/` into a fresh checkout before the first `deploy-bot.sh`.

## What is not covered

- **Postgres** (social, boda, disputes, ratings) is not in these archives. It
  is a separate container with its own volume.
- **`whatsapp-bot/.env`** is excluded, being outside `data/`. Keep the Daraja
  and Paystack credentials recorded separately.
- **WAHA session state** lives in a Docker volume. Losing it means re-linking
  WhatsApp by QR, not losing data.
