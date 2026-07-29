# WAHA / WhatsApp linking

Ops guide for linking Sokoni’s business WhatsApp to self-hosted WAHA (NOWEB).

## Rules

- Keep WAHA on **localhost:3000** (SSH tunnel / VM shell only).
- Never publish QR images or pairing codes on `bot.sokonimall.com`.
- Do not commit `waha-qr.png`.
- Use the same `WAHA_API_KEY` for compose, scripts, and `whatsapp-bot/.env`.

## Canonical VM flow

```bash
cd ~/sokoni && git pull --rebase origin main
bash scripts/deploy-waha.sh          # pinned image + live WA version + NOWEB store + webhook
bash scripts/waha-link-whatsapp.sh   # pairing code (preferred) or PNG QR
bash scripts/deploy-bot.sh
bash scripts/health-check.sh
```

Image is hardcoded as `devlikeapro/waha:latest-2026.7.2` in `docker-compose.waha.yml`
(avoid `${WAHA_IMAGE:-repo:tag}` — docker-compose v1 can break on the colon in the tag).

On each start, the container fetches the live WhatsApp Web version from
`web.whatsapp.com/sw.js` (via `scripts/fetch-wa-version.js`) and sets
`WAHA_NOWEB_WA_VERSION`. Override with `export WAHA_NOWEB_WA_VERSION=2.3000.…`
before deploy if needed.

Expect session `WORKING`. Public probe:

```bash
curl -s https://bot.sokonimall.com/health
# wahaConfigured, wahaReachable, wahaLinked, wahaSessionStatus
```

Admin detail (redacted phone):

```bash
curl -s "https://bot.sokonimall.com/admin/ops/waha?token=$ADMIN_SETUP_TOKEN"
```

## Reset / re-link

API reset (may keep bad identity keys on disk):

```bash
RESET_WAHA_SESSION=1 bash scripts/waha-link-whatsapp.sh
```

Full wipe of the Docker sessions volume (required after Connection Failure loops):

```bash
# Phone: WhatsApp → Linked devices → unlink old desktop / Sokoni entries
WIPE_WAHA_SESSIONS=1 bash scripts/deploy-waha.sh
bash scripts/waha-link-whatsapp.sh
```

## Diagnose: STARTING → Connection Failure

Logs that look like:

```
connected to WA
not logged in, attempting registration...
connection errored … Error: Connection Failure … noise-handler.js
Session stuck in STARTING status, force stopping
```

mean WhatsApp accepted the socket then rejected the **client version** during
registration — QR never appears. Confirm:

```bash
# what WAHA announces (stale example: tertiary 1035920091)
docker logs "$(docker ps -qf name=sokoni-waha)" --tail 200 2>&1 \
  | grep -o 'appVersion[^}]*}' | tail -1

# what WhatsApp serves now
node scripts/fetch-wa-version.js
```

If announced tertiary ≪ live `client_revision`, pull this repo (2026.7.2 +
version fetch), wipe sessions, and re-link. See WAHA [#2191](https://github.com/devlikeapro/waha/issues/2191).

Also unlink old devices on the phone if pairing still fails after the wipe.

## Related

- [`DEPLOY_BOT_GCP.md`](DEPLOY_BOT_GCP.md) — Phase G
- [`DEPLOY_STATUS.md`](DEPLOY_STATUS.md)
- [`PHASE2_SOCIAL.md`](PHASE2_SOCIAL.md) — social pings need a linked session
