# Sokoni WhatsApp Bot

AI-powered WhatsApp store bot using **WAHA** (not Meta Cloud API). Numbered text menus + OpenRouter AI.

See **[`../docs/GO_LIVE_WAHA.md`](../docs/GO_LIVE_WAHA.md)** for the full step-by-step go-live guide.

## Quick start (local dry-run)

```bash
cd whatsapp-bot
npm install
cp .env.example .env
npm run dev
```

Without `WAHA_API_URL` set, outgoing messages are logged (dry-run). Without `OPENAI_API_KEY`,
free-text falls back to keyword search.

## With WAHA locally

```bash
# Terminal 1 — from repo root
docker compose -f docker-compose.waha.yml up -d

# Scan QR at http://localhost:3000/api/sessions/default/auth/qr

# Terminal 2
cd whatsapp-bot
npm run dev
```

Simulate an inbound message:

```bash
curl -X POST http://localhost:8080/webhook \
  -H "Content-Type: application/json" \
  -d "{\"event\":\"message\",\"session\":\"default\",\"payload\":{\"from\":\"254712345678@c.us\",\"body\":\"menu\",\"fromMe\":false}}"
```

Reply with `1`, `2`, etc. for menu choices (not buttons).

## Environment

| Variable | Purpose |
| --- | --- |
| `WAHA_API_URL` | WAHA base URL (e.g. `http://localhost:3000`) |
| `WAHA_SESSION` | Session name (default: `default`) |
| `OPENAI_API_KEY` | OpenRouter API key |
| `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` |
| `PUBLIC_SITE_URL` | HTTPS site for product images |
| `BUSINESS_WHATSAPP_NUMBER` | Your number — receives COD order alerts |

## Catalog

Edit `src/data/products.json`, then from repo root:

```bash
node scripts/sync-catalog.mjs
```
