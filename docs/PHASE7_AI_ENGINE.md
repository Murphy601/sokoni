# Phase 7.1 — Agentic AI engine (Sokoni Plug specialists)

Builds on [PHASE7_AI.md](./PHASE7_AI.md). Chat stays on **OpenRouter** (`OPENAI_*`); listing vision stays **OpenRouter → NVIDIA → Gemini**. No paid LangGraph / Pinecone required.

## Architecture

```
User message
    ↓
Escalation guard (lawyer / fraud / angry → human handoff + inbox ticket)
    ↓
Specialist router (buyer | seller | dispute | logistics | general)
    ↓
Tool router (existing deterministic tools)
    ↓
Knowledge RAG-lite (data/knowledge/*.md keyword retrieval)
    ↓
LLM (OpenRouter) + TOOL RESULTS + policy excerpts
    ↓
Reply
```

## Guardrails

| Rule | Behaviour |
|------|-----------|
| Goodwill voucher | Auto propose ≤ **KES 300**; higher → human admin (`GOODWILL_VOUCHER_CAP_KES`) |
| Sensitive keywords | Immediate human handoff + support inbox |
| No invented stock / balances | Unchanged — tools only |

## Knowledge

Files under `whatsapp-bot/knowledge/`. Optional next step: `pgvector` on Postgres for embeddings — keyword RAG works offline today.

## Inventory (seller)

- Size/colour **variants** + per-variant stock (`POST /api/seller/onboard/variants`)
- Low-stock WhatsApp alerts (≤2 units)
- Shop promo banner (`POST /api/seller/onboard/shop-offer`) + item `% Set promo`
- Pre-pay oversell check in `createOrder` (`assertPurchaseQty`)

## Deploy

```bash
SKIP_WAHA_DEPLOY=1 SKIP_CATALOG_PUBLISH=1 bash scripts/deploy-bot.sh
```
