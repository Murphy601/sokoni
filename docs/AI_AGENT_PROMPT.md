# Sokoni AI Brain — 4-Tier Architecture & Training

> **Source of truth (prompts):** `whatsapp-bot/src/services/ai-prompts.js`  
> **Layer 3 context:** `whatsapp-bot/src/services/ai-user-context.js`  
> **RAG:** `whatsapp-bot/knowledge/*.md` + optional `platform_knowledge` (pgvector)  
> **Tools (pre-LLM):** `whatsapp-bot/src/services/ai-tools.js`  
> **Runtime:** `whatsapp-bot/src/services/ai-agent.js`  
> **Last synced:** 2026-08-29

---

## Updating prompts does **not** wipe training

Editing the system prompt or knowledge docs is like updating a worker’s instruction manual.
The model’s general language ability stays; only Sokoni’s reference rules and retrieved facts change.

To make the agent wiser over time: add bullets to `SOKONI_MASTER_RULES` / `SOKONI_MVP_LOGISTICS_FACTS`, add markdown under `knowledge/`, and keep Layer 1 command handlers for money/custody.

---

## The 4 tiers

```
1. Strict Command Router   → ACCEPT / PICKUP / CONFIRM / WAYBILL / PARTIAL_REFUND / balance
2. System Prompt           → identity, safety, logistics Stable Facts
3. Dynamic User Context    → role, recent SKN orders, rider/seller flags (every AI turn)
4. RAG Knowledge           → knowledge/*.md (+ optional pgvector platform_knowledge)
         +
   Pre-LLM Tools           → track_order, search_products, get_seller_payout, …
```

### Tier 1 — Command router (no LLM)

`webhookHandler.js` runs deterministic handlers **before** `runAiAgent`.
Financial / custody actions never rely on the model.

### Tier 2 — System prompt

`buildGroundedSystemPrompt()` wraps channel prompts + master rules.
Improve accuracy by editing Stable Facts — not by fine-tuning.

### Tier 3 — Dynamic user context

`buildUserContextBlock({ phone, customerKey })` injects live role + recent orders
into `CONTEXT DATA` every freeform turn. This is **additive**; it does not replace Tier 2.

### Tier 4 — RAG

Keyword (and optional DB) retrieval over `knowledge/*.md`. Prefer short policy docs over stuffing the system prompt.

### Tools (agentic, Sokoni style)

Tools are **selected and executed server-side** (`runToolRouter` / `runAgentGraph`) before the LLM call.
Results appear as LOOKUP RESULTS. Native OpenAI `tool_calls` stay disabled on purpose (safer for escrow).

| User intent | Tool / path | Outcome |
| --- | --- | --- |
| Where is my order? | `track_order` | Live status from order + boda meta |
| Shipping rates | `get_shipping_rates` | Seller tariff matrix |
| Seller balance | Layer 1 `balance` or `get_seller_payout` | Ledger snapshot |

---

## Accuracy as you scale

1. **Separation of concerns** — ACCEPT / PICKUP / CONFIRM / refunds stay on fixed DB code.
2. **Prompt bullets** — when launch logs show a wrong answer, add one Stable Fact line.
3. **Conversation memory** — WhatsApp AI turns persist in `chat_memory` (session history). Review weekly; add FAQs to `knowledge/`.
4. **Never** let the LLM move money without a Layer 1 verifier.

---

## How to extend knowledge

1. Add/edit `whatsapp-bot/knowledge/<topic>.md`
2. Register in `KNOWLEDGE_FILES` / `LANE_DOCS` (`agent-specialists.js`)
3. Deploy bot (keyword RAG reloads). Optional: seed `platform_knowledge` via `upsertKnowledgeChunk` when pgvector is enabled.

---

## Do not use (outdated)

- COD-first / `ai.js` SYSTEM_PROMPT docs from older revisions
- Teaching the LLM to invent OTPs, till numbers, or execute ACCEPT itself
- Replacing Layer 1 with LLM-native tool_calls for custody
