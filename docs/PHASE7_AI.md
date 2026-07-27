# Phase 7 — Unified AI layer (Sokoni Plug)

One shared brain for **WhatsApp** and the **website** — same catalog search, order tracking, and prepaid/escrow answers.

## Architecture

```
User message (web or WhatsApp)
        ↓
   Tool router (search_products, track_order, list_orders, store_info, get_product)
        ↓
   LLM + TOOL RESULTS context (OpenRouter)
        ↓
   Reply + optional product cards / tracking
```

## Channels

| Channel | Entry | Session |
|---------|-------|---------|
| WhatsApp | Free-text → `runAiAgent()` | In-memory by chat ID |
| Web | [ask.html](../website/ask.html) → `POST /api/agent/chat` | `sessionId` in sessionStorage |

## Tools

| Tool | Purpose |
|------|---------|
| `search_products` | Catalog search with budget / pre-loved filters |
| `get_product` | Lookup by `prod_*` id |
| `track_order` | SK-#### shipment timeline (Phase 6) |
| `list_orders` | Customer orders by phone/chat |
| `store_info` | Prepaid, escrow, Daraja meta |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent/meta` | Agent name, tools, config status |
| POST | `/api/agent/chat` | `{ message, sessionId?, phone? }` → `{ reply, products, tracking }` |

## Files

| Area | Files |
|------|--------|
| Agent core | `whatsapp-bot/src/services/ai-agent.js` |
| Tools | `whatsapp-bot/src/services/ai-tools.js` |
| Prompts | `whatsapp-bot/src/services/ai-prompts.js` |
| WhatsApp | `whatsapp-bot/src/services/ai.js` (thin wrapper) |
| API | `whatsapp-bot/src/routes/agentApi.js` |
| Web UI | `website/ask.html`, `website/assets/js/shop-ai.js` |

## Deploy

```bash
bash ~/sokoni/scripts/deploy-bot.sh
```

Website deploys on push via Cloudflare Pages.

## Test plan

- [ ] WhatsApp: "dress under 5000" → product suggestions + reply *1* CTA
- [ ] WhatsApp: `SK-1042` → shipment timeline
- [ ] WhatsApp: "prepaid" / "escrow" → store_info answer
- [ ] Web: ask.html → chat + product Order buttons
- [ ] `GET /api/agent/meta` → `phase: 7`, tools list
- [ ] `/health` → `aiTools` array present

## Next: Phase 8

Personalization / ML feed ranking (views, saves, purchases).
