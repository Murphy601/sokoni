# Sokoni AI Brain — System Prompt & Training (MVP)

> **Source of truth:** `whatsapp-bot/src/services/ai-prompts.js`  
> **RAG grounding:** `whatsapp-bot/knowledge/*.md` (via `agent-specialists.js`)  
> **Runtime agent:** `whatsapp-bot/src/services/ai-agent.js`  
> **Last synced:** 2026-08-29

---

## 2-layer model (do not confuse with ML fine-tuning)

Sokoni does **not** train a custom model from scratch. The WhatsApp AI uses:

```
[ Incoming WhatsApp message ]
            │
            ▼
┌───────────────────────────────────┐
│ Layer 1: Deterministic router     │
│ Regex / keyword commands          │
│ ACCEPT · PICKUP · CONFIRM · …     │
│ → instant DB handlers (no LLM)    │
└─────────────────┬─────────────────┘
                  │ unstructured text only
                  ▼
┌───────────────────────────────────┐
│ Layer 2: LLM agent                │
│ System prompt + knowledge RAG     │
│ + LOOKUP RESULTS / order context  │
└───────────────────────────────────┘
```

**Training = keeping Layer 2 prompts + knowledge docs accurate.**  
Mission-critical custody (OTPs, accept job) must stay on Layer 1.

---

## How to update AI “training”

1. Edit **`SOKONI_MASTER_RULES`** / **`SOKONI_MVP_LOGISTICS_FACTS`** in `ai-prompts.js` when business rules change (escrow windows, waybill rules, command formats).
2. Edit / add markdown under **`whatsapp-bot/knowledge/`** and register the file in `KNOWLEDGE_FILES` / `LANE_DOCS` inside `agent-specialists.js`.
3. Deploy the bot so RAG + prompts reload. Optional: re-run pgvector knowledge ingest if phase16 embeddings are enabled.
4. Inject live user context via `buildGroundedSystemPrompt({ contextBlocks, threadId })` — the agent already passes specialist hints, knowledge chunks, and tool LOOKUP RESULTS each turn.

---

## MVP logistics facts the LLM must know

| Topic | Rule the bot should teach |
| --- | --- |
| Rider assignment | Sokoni auto-pins; riders do not choose orders |
| Pickup | Seller speaks 4-digit OTP → rider `PICKUP SKN-#### ####` |
| Delivery | Buyer speaks 4-digit OTP → rider `CONFIRM SKN-#### ####` |
| Escrow | Prepaid hold; ~15 min local dispute window after delivery confirm |
| Upcountry | `WAYBILL …` + two pre-shipment photos |
| Freeform actions | Never execute — tell the exact WhatsApp command |
| Currency | Always **KES** |

Knowledge doc: `knowledge/rider-delivery.md` (+ `shipping-sop.md`, `buyer-trust.md`).

---

## System prompt entry points

| Export | Role |
| --- | --- |
| `SOKONI_MASTER_RULES` | Hard behavioural rules (grounding, brevity, no fake OTPs) |
| `SOKONI_MVP_LOGISTICS_FACTS` | Stable logistics / escrow facts |
| `WHATSAPP_SYSTEM_PROMPT` / `WEB_SYSTEM_PROMPT` | Channel wrappers |
| `buildGroundedSystemPrompt()` | Per-turn prompt + CONTEXT + thread id |

---

## Specialist lanes

`routeSpecialist()` → buyer | seller | dispute | logistics | general.  
Logistics lane prefers `rider-delivery.md` and reminds the model to point users at exact commands.

---

## Do not use (outdated)

- Old `SYSTEM_PROMPT` in `ai.js` / COD-first “pay on delivery” brain in this doc’s prior revisions
- Teaching the LLM to invent till numbers, OTPs, or rider pins
- Putting ACCEPT / PICKUP / CONFIRM execution inside the LLM (keep Layer 1)
