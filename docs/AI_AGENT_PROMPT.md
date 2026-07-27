# Sokoni AI Brain — System Prompt & Architecture

> **Source of truth:** `whatsapp-bot/src/services/ai.js` (`SYSTEM_PROMPT`, `buildCatalogBlock`, `buildModeInjection`)
> **Architecture:** Pre-search catalog → inject CATALOG + mode → LLM reply (no function tools)
> **Business model:** COD store primary; international affiliate secondary
> **Last synced:** 2026-07-08

---

## How the brain works (3 layers)

```
User message
    ↓
webhookHandler.js (routing: menu, order, track, admin, product-router)
    ↓
gatherProducts() + catalog search (deterministic)
    ↓
SYSTEM_PROMPT + CATALOG block + MODE injection + session history
    ↓
LLM reply (or template fallback)
```

The LLM **does not search**. Your code searches. The prompt enforces catalog-only answers.

---

## Layer 1 — Master brain

Implemented as `SYSTEM_PROMPT` in `whatsapp-bot/src/services/ai.js`.

Key rules:
- **Store first:** pay-on-delivery, reply *1* to order, type *menu* to browse
- **International second:** only when asked; route to *menu* → Shop International
- **TikTok:** match viral energy; featured items from `tiktok-featured.json`
- **Never hallucinate:** only CATALOG block facts
- **Human handoff:** stop selling; team replies in chat

---

## Layer 2 — Mode injections

Appended as extra system messages based on context:

| Mode | Trigger | Behaviour |
|------|---------|-----------|
| `TIKTOK_VIRAL` | TikTok / viral keywords | Fast, featured items first |
| `PRODUCT_FOCUS` | `lastProductContext` + detail question | Answer about THIS item first |
| `RECOMMEND` | "recommend", "best", "show me" | Top 3 ranked picks |
| `INTERNATIONAL` | AliExpress / abroad / import intent | 1–4 weeks, customs, menu → intl |

---

## Layer 3 — CATALOG block format

Built by `buildCatalogBlock()` in `ai.js`:

```
CATALOG (authoritative — only use these):
[STORE | pay on delivery]
1) id:pt-001 | Tecno Spark 20C | KES 13,599 | ⭐4.5 | STORE|pay on delivery | cat:phones-tablets/smartphones | tags:camera,battery

CUSTOMER CONTEXT:
intent: recommend
budget_hint: under KES 15000
viral_source: no
language: sw
REQUIRED CTA: reply *1* to order OR *menu* to browse
```

---

## Message router (code-level, not LLM)

Documented order in `webhookHandler.js`:

1. Admin sender → admin commands
2. Human handoff active → handoff handler only
3. `"menu"` / `"start"` / `"habari"` → reset + main menu
4. Pending COD order → order flow (name/location/phone)
5. Active product menu (`1`/`2`/`3`) → order / ask AI / main menu
6. `"track"` + `SK-####` → order status
7. `"human"` / `"agent"` → handoff
8. **Product router** (`product-router.js`) → perfume oils + all-category search
9. Purchase intent (`nipee`/`nataka`) + product context → start COD order
10. Product search intent → numbered list OR AI
11. Default → `runAiAgent()`

---

## WhatsApp main menu

1. Browse Categories
2. Today's Picks
3. **Shop International**
4. Track My Order
5. Visit Website
6. Talk to a Human
7. How Sokoni Works

---

## How Sokoni Works (single truth)

1. Chat Sokoni on WhatsApp (or browse sokonimall.com)
2. AI finds the right product from our **pay-on-delivery store** catalog
3. Reply *1* to order (local) OR *menu* → Shop International (partner links)
4. Track with your **SK-####** order number anytime

---

## TikTok caption brain

See `whatsapp-bot/prompts/tiktok-caption.prompt.md`.

- `fulfillment=store` → CTA must say **pay on delivery** + WhatsApp link in bio
- `scope=international` → CTA must mention **1–4 weeks** + customs may apply
- Never fake discounts unless `originalPriceKes` exists in JSON

---

## Website alignment

- Hero: COD store first, international secondary
- Site catalog: run `node scripts/build-site-catalog.mjs` after editing `whatsapp-bot/src/data/products.json`
- Deep links: `sokonimall.com/?text=phone under 15k` pre-fills search
- Reviews: API at `bot.sokonimall.com/api/reviews`, fallback `website/data/reviews.json`

---

## Do not use (outdated)

- `docs/CONCEPT.md` affiliate-only flows without COD context
- Old references to LLM `search_products` tool calls — not implemented in v1
- Interactive WhatsApp buttons — WAHA uses numbered text menus
