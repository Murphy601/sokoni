# Phase 7.3 — WhatsApp commerce ops (cart, voice, inventory, risk, retention)

Builds on [PHASE7_AI_ENGINE.md](./PHASE7_AI_ENGINE.md) Phase 7.2. Stays on **Node + WAHA VM WhatsApp** — no FastAPI rewrite.  
**Thread ID** = WhatsApp phone / customer key (`threadIdFromPhone`).

| Spec | Implementation |
|------|----------------|
| LangGraph + pgvector | Same graph + chunked RAG; optional `schema-phase16-pgvector-knowledge.sql` |
| Conversational checkout | `create_checkout_link` → SKN order + STK / `checkout.html?order=` |
| Voice notes | WAHA audio → OpenRouter Whisper-compatible STT → text router |
| Seller inventory WA | `update_inventory` (phone-auth seller) |
| Rider DISPATCH | `DISPATCH SKN-… via rider Name 07…` + `dispatch_with_rider` |
| Fake PoP | `verify_payment_code` vs Paystack/M-Pesa webhook fields |
| AUP moderation | Expanded prohibited list + `check_aup` |
| Abandon recovery | Hourly cron on pending checkouts + unpaid SKN |
| Review collector | `sendReviewPrompt` after YES + 24h auto-release |

## New / extended tools

| Tool | Role |
|------|------|
| `create_checkout_link` | Reserve qty + pay URL / STK |
| `update_inventory` | Seller stock (+ optional price) via WhatsApp |
| `dispatch_with_rider` | Mark dispatched + notify buyer |
| `verify_payment_code` | Reject unverified M-Pesa codes |
| `check_aup` | Block medical/prohibited listing text |

## Test scenarios

### Conversational shopping
- `Add 2 of those Sony headphones to my cart and send me the payment link.` → reserved SKN + pay link / STK.
- Voice: Swahili/English note → STT → catalog search → numbered picks.

### Seller logistics
- `Update my inventory: I just received 20 units of Red Nike Air Max at KES 4500 each.`
- `DISPATCH SKN-3011 via rider Kamau 0722123456` → buyer notified.

### Risk
- Fake code on *paid* → rejected if not in webhook records.
- Title `Unregistered Medical Pills` → AUP reject.

### Retention
- Pending checkout / unpaid SKN > 30m → abandon WhatsApp nudge.
- After YES / auto-release → star rating prompt.

## Deploy

```bash
SKIP_WAHA_DEPLOY=1 SKIP_CATALOG_PUBLISH=1 bash scripts/deploy-bot.sh
```

```bash
node scripts/test-agent-ops-graph.mjs
node scripts/test-commerce-ops.mjs
```

## Honest limits

- STT needs `OPENAI_API_KEY` (OpenRouter) + `OPENAI_TRANSCRIBE_MODEL` (optional).
- Multi-qty checkout multiplies item total; shipping still one leg unless Hub zones say otherwise.
- Inventory image OCR (“photo of stock box”) is not full vision listing create — caption/text path is live.
- Keep WAHA on the VM; do **not** migrate to a separate FastAPI/LangGraph Python stack.
