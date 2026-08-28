# Phase 7.2 — Operational multi-agent engine (Sokoni Plug)

Delivers the buyer / seller / HITL capabilities below on the **existing WhatsApp + `/api/agent/chat` stack**.

| Spec buzzword | What Sokoni ships |
|---------------|-------------------|
| LangGraph multi-agent | `agent-graph.js` — escalate → specialist → allowlisted tools → RAG → reply |
| LiteLLM routing | `llm-router.js` — OpenRouter free-tier-first model chain (no extra process) |
| Pgvector | Chunked keyword RAG today (`knowledge/*.md`); embedding table optional later |

Chat models: OpenRouter (`OPENAI_*`). Listing vision unchanged (OpenRouter → NVIDIA → Gemini).

```
User message
    ↓
Escalation (fraud/legal/anger → HIGH PRIORITY inbox + admin ping)
    ↓
Specialist route (buyer | seller | dispute | logistics | general)
    ↓
Tool allowlist for that specialist
    ↓
Knowledge RAG-lite (chunked markdown)
    ↓
LLM (LiteLLM-style failover) + TOOL RESULTS
    ↓
Reply
```

## Tools

| Tool | Role |
|------|------|
| `track_order` / `list_orders` | Order status, rider, ETA |
| `search_products` / `browse_*` | Catalog recommendations |
| `open_return_case` | Damaged/refund → escrow hold + ask for photos |
| `get_seller_onboarding` | Register + Till / Paybill SOP |
| `get_seller_payout` | Ready / pending / in-transit balances |
| `get_shipping_rates` | Guide + saved local/upcountry rates |
| `propose_goodwill` | Cap KES 300; higher → human |
| `store_info` | Escrow / trust facts |

## Real-world test cases

### 1. Buyer support

**A — Order tracking**  
Send: `Where is my package for Order #SKN-4920?`  
Expect: logistics/buyer tools → status, rider if dispatched, ETA from tools only.

**B — Catalog**  
Send: `wireless noise-canceling headphones under KES 5000`  
Expect: `search_products` hits with live prices + links (no invented stock).

**C — Low-level return**  
Send: `Order #SKN-1102 arrived damaged. I want my money back.`  
Expect: `open_return_case` → payout held, ask for photos, admin alerted.

### 2. Seller support

**A — Onboarding**  
Send: `How do I register as a seller and link my M-Pesa Till?`  
Expect: `get_seller_onboarding` steps → Seller Hub Settings → Payouts.

**B — Payout balance**  
Send (as seller WhatsApp): `What is my pending payout balance?`  
Expect: `get_seller_payout` with Ready / Pending escrow / In transit.

**C — Shipping rates**  
Send: `How do I set delivery to KES 300 Nairobi and KES 500 upcountry?`  
Expect: `get_shipping_rates` guide to Seller Hub → Shipping Rates.

### 3. HITL

**A — Fraud / legal**  
Send: `This seller scammed me on SKN-8811 — I'm calling the police and suing.`  
Expect: high-priority ticket, bot pauses, admin WhatsApp/webhook ping, serious escalation reply.

## Deploy

```bash
SKIP_WAHA_DEPLOY=1 SKIP_CATALOG_PUBLISH=1 bash scripts/deploy-bot.sh
```

Smoke:

```bash
node scripts/test-agent-tool-router.mjs
node scripts/test-agent-ops-graph.mjs
```

## Honest limits

- Not a separate Python LangGraph / LiteLLM / Pinecone bill — same Node bot, free-tier OpenRouter.
- Refunds are **held + human finalize**, not auto-STK reverse.
- Shipping rate **writes** stay in Seller Hub (authenticated); AI reads + guides.
- Pgvector embeddings are optional next; keyword RAG is live.


See also [PHASE7_AI_COMMERCE.md](./PHASE7_AI_COMMERCE.md) for cart/voice/inventory/risk/retention.
