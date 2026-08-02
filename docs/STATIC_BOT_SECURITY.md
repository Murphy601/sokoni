# Static site + Node bot security (Sokoni)

Sokoni is a **static frontend** (`website/` on Cloudflare Pages) plus a **Node WhatsApp bot** (`whatsapp-bot/` on GCP). Everything in the browser is public; secrets belong only in the bot `.env`.

## Checklist vs architecture

| Rule | Sokoni status |
|------|----------------|
| No API secrets in frontend JS | Yes — only `bot.sokonimall.com` URLs + session tokens after OTP |
| Secrets in bot `.env` + gitignored | Yes — `dotenv` via `config.js`; root `.gitignore` has `.env` |
| CORS allowlist for site origin | Yes — `sokonimall.com` / `www` / local `8080` |
| WAHA webhook authenticity | Set `WEBHOOK_HMAC_KEY` — bot verifies `X-Webhook-Hmac` (sha512) |
| Rate limit `/api/` | Yes — `express-rate-limit` (tunable via `RATE_LIMIT_*`) |
| Admin token not left in URL | Admin pages strip `?token=` and send `X-Admin-Token` |

## Enable webhook HMAC (production)

1. On the VM, add to `whatsapp-bot/.env`:

```bash
WEBHOOK_HMAC_KEY=$(openssl rand -hex 32)
# paste the same value into .env
```

2. Redeploy the bot, then re-apply WAHA session config (reads the key from `.env`):

```bash
cd ~/sokoni && SKIP_CATALOG_PUBLISH=1 SKIP_WAHA_DEPLOY=1 bash scripts/deploy-bot.sh
bash scripts/configure-waha-session.sh
```

3. Confirm unsigned webhooks are rejected:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://bot.sokonimall.com/webhook \
  -H 'Content-Type: application/json' -d '{"event":"message"}'
# expect 401 when WEBHOOK_HMAC_KEY is set
```

## Quick browser check

1. Open `https://sokonimall.com` → DevTools → Sources: search for `secret`, `api_key`, `GEMINI`, `PHOTOROOM`, `DATABASE`.
2. Network: product/search responses should not include admin flags, raw DB internals, or other customers’ phone numbers.

## Note on Meta vs WAHA

Guides that mention Meta `X-Hub-Signature-256` / `VERIFY_TOKEN` apply to **WhatsApp Cloud API**. Sokoni uses **WAHA** — equivalent control is `WEBHOOK_HMAC_KEY` + `X-Webhook-Hmac`.
