# Sokoni WhatsApp Bot

AI-powered WhatsApp store bot using **WAHA** (not Meta Cloud API). Numbered text menus + OpenRouter AI.

Canonical GCP linking: **[`../docs/DEPLOY_BOT_GCP.md`](../docs/DEPLOY_BOT_GCP.md)** (Phase G).  
Older free-host notes: **[`../docs/GO_LIVE_WAHA.md`](../docs/GO_LIVE_WAHA.md)**.

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
bash scripts/deploy-waha.sh
# Link phone (pairing code or local QR PNG) — do not expose :3000 publicly
bash scripts/waha-link-whatsapp.sh

# Terminal 2
cd whatsapp-bot
npm run dev
```

Status:

- Public: `GET /health` → `wahaLinked`, `wahaSessionStatus`
- Admin: `GET /admin/ops/waha?token=…`

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
| `OPENAI_API_KEY` | OpenRouter API key (chat + catalog vision) |
| `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` |
| `OPENAI_MODEL` | Chat model (default: `google/gemma-4-31b-it:free`) |
| `OPENAI_MODEL_FALLBACKS` | Comma-separated backup models if primary fails |
| `CATALOG_VISION_MODEL` | Vision model for seller photo → draft (Phase 4) |
| `CATALOG_VISION_FALLBACKS` | Optional vision model fallbacks |
| `GEMINI_API_KEY` | Optional Google Gemini vision fallback for listings |
| `GEMINI_VISION_MODEL` | Gemini vision model (default: `gemini-2.5-flash`) |
| `CLOUDINARY_*` / `HUGGINGFACE_API_KEY` / `PHOTOROOM_API_KEY` | Optional cloud background cleanup (see `docs/MEDIA_STUDIO_PLAN.md`) |
| `CATALOG_AUTO_PUSH` | `true` to git-push catalog rebuild after publish |
| `ELEVENLABS_API_KEY` | Optional TTS for WhatsApp voice-note replies (VM only; text-first) |
| `ELEVENLABS_VOICE_ID` | Voice Library id (default Rachel `21m00Tcm4TlvDq8ikWAM`) |

### AI model choice (English / Kiswahili / Sheng)

The bot uses OpenRouter. Default is **free** (`:free` suffix = no credits per message). Avoid tiny models like `nemotron-nano-9b` — they misread Sheng.

| Tier | OpenRouter model | When to use |
| --- | --- | --- |
| **Default (free)** | `google/gemma-4-31b-it:free` | Current OpenRouter free tier; multilingual |
| **Free fallback** | `qwen/qwen3-next-80b-a3b-instruct:free` | Backup if Gemma is rate-limited |
| **Paid upgrade** | `google/gemini-2.5-flash` | Higher volume, fewer rate limits |
| **High thinking (paid)** | `google/gemini-2.5-pro` | Hardest queries only |

Set on the VM in `whatsapp-bot/.env`, then `bash scripts/deploy-bot.sh`. Menus, orders, catalog, and admin flows are unchanged.

| `PUBLIC_SITE_URL` | HTTPS site for product images |
| `BUSINESS_WHATSAPP_NUMBER` | Your number — receives order alerts |

## Catalog

Edit `src/data/products.json`, then from repo root:

```bash
node scripts/sync-catalog.mjs
```
