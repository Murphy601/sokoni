# Phase 7 — Unified AI layer (Sokoni Plug)

One shared brain for **WhatsApp** and the **website** — same catalog search, browse taxonomy, order tracking, and prepaid/escrow answers.

## Architecture

```
User message (web or WhatsApp)
        ↓
   Tool router (search_products, browse_products, browse_taxonomy,
                track_order, list_orders, store_info, get_product)
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
| `search_products` | Keyword catalog search with budget / pre-loved / browse-aisle filters |
| `browse_products` | List live items on a browse category/subcategory path |
| `browse_taxonomy` | Categories, subcategories, aesthetics, price tiers, site paths |
| `get_product` | Lookup by `prod_*` id |
| `track_order` | SK-#### shipment timeline (Phase 6) |
| `list_orders` | Customer orders by phone/chat |
| `store_info` | Prepaid, escrow, till, delivery note, how-it-works, promo, site URLs |

Browse menu source: `website/data/browse-menu.json` via `whatsapp-bot/src/services/browse-menu.js`.

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
| Browse menu | `whatsapp-bot/src/services/browse-menu.js` |
| Prompts | `whatsapp-bot/src/services/ai-prompts.js` |
| WhatsApp | `whatsapp-bot/src/services/ai.js` (thin wrapper) |
| API | `whatsapp-bot/src/routes/agentApi.js` |
| Web UI | `website/ask.html`, `website/assets/js/shop-ai.js` |

## Deploy

```bash
bash ~/sokoni/scripts/deploy-bot.sh
```

Website deploys on push via Cloudflare Pages. Bot needs a VM deploy after merge for WhatsApp + `/api/agent/*`.

## Test plan

- [ ] WhatsApp: "dress under 5000" → product suggestions + reply *1* CTA
- [ ] WhatsApp: "What categories do you have?" → browse_taxonomy aisles
- [ ] WhatsApp: "women dresses" → browse_products / aisle-aware reply
- [ ] WhatsApp: `SK-1042` → shipment timeline
- [ ] WhatsApp: "prepaid" / "how does delivery work" → store_info answer (till, escrow, delivery note)
- [ ] Web: ask.html chips → categories / prepaid / delivery
- [ ] `GET /api/agent/meta` → tools include `browse_taxonomy`, `browse_products`
- [ ] `node whatsapp-bot/scripts/test-agent-tool-router.mjs`

## Next: Phase 8

Personalization & behavior-ranked feeds — see [PHASE8_FEED.md](./PHASE8_FEED.md).
