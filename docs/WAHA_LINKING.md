# WAHA / WhatsApp linking

Ops guide for linking Sokoni’s business WhatsApp to self-hosted WAHA (NOWEB).

## Rules

- Keep WAHA on **localhost:3000** (SSH tunnel / VM shell only).
- Never publish QR images or pairing codes on `bot.sokonimall.com`.
- Do not commit `waha-qr.png`.
- Use the same `WAHA_API_KEY` for compose, scripts, and `whatsapp-bot/.env`.

## Canonical VM flow

```bash
cd ~/sokoni && git fetch origin main && git checkout -B main origin/main
bash scripts/deploy-waha.sh          # pinned 2026.7.2 + live WA version + NOWEB store
bash scripts/waha-link-whatsapp.sh   # pairing code (preferred) or PNG QR — only if not WORKING
SKIP_CATALOG_PUBLISH=1 bash scripts/deploy-bot.sh   # bot only; does not bounce WAHA by default
bash scripts/health-check.sh
```

Image is hardcoded as `devlikeapro/waha:latest-2026.7.2` in `docker-compose.waha.yml`
(avoid `${WAHA_IMAGE:-repo:tag}` — docker-compose v1 can break on the colon in the tag).  
Do **not** use `2026.6.2` — it loops `Connection Failure` with stale client `2.3000.1035920091`.

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
