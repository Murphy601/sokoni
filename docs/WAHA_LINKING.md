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
bash scripts/deploy-waha.sh          # pinned image + NOWEB store + webhook
bash scripts/waha-link-whatsapp.sh   # pairing code (preferred) or PNG QR
bash scripts/deploy-bot.sh
bash scripts/health-check.sh
```

Image is hardcoded as `devlikeapro/waha:latest-2026.6.2` in `docker-compose.waha.yml`
(avoid `${WAHA_IMAGE:-repo:tag}` — docker-compose v1 can break on the colon in the tag).

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

```bash
RESET_WAHA_SESSION=1 bash scripts/waha-link-whatsapp.sh
```

Also unlink old devices on the phone if WhatsApp stuck on Connection Failure.

## Related

- [`DEPLOY_BOT_GCP.md`](DEPLOY_BOT_GCP.md) — Phase G
- [`DEPLOY_STATUS.md`](DEPLOY_STATUS.md)
- [`PHASE2_SOCIAL.md`](PHASE2_SOCIAL.md) — social pings need a linked session
