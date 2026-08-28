# Phase 7.3 — Fast, grounded multi-agent engine (Sokoni Plug)

Fixes the three usual bottlenecks: **latency**, **bad knowledge**, **inconsistent replies**.

| Spec | What Sokoni ships |
|------|-------------------|
| Fast inference | `llm-router.js` — **Groq → OpenRouter** (`tool_choice=none`; Gemini chat opt-in; never Ollama for WA traffic) |
| Low temperature | `AI_CHAT_TEMPERATURE=0.15` (deterministic buyer/seller answers) |
| Strict grounding | `buildGroundedSystemPrompt` — CONTEXT + TOOL RESULTS only; escalate if missing |
| LangGraph multi-agent | `agent-graph.js` — escalate → specialist → tools → RAG → reply |
| RAG | `knowledge/*.md` chunks ~200–300 words; optional `platform_knowledge` (pgvector) |
| Thread ID | WhatsApp sender phone via `threadIdFromPhone` / `resolveThreadId` |

```
User message (thread_id = WhatsApp phone)
    ↓
Escalation (fraud/legal/anger → HIGH PRIORITY inbox)
    ↓
Specialist route (buyer | seller | dispute | logistics | general)
    ↓
Tool allowlist for that specialist
    ↓
Knowledge RAG (markdown + optional platform_knowledge)
    ↓
LLM @ temp 0.15 (Groq → OpenRouter; Gemini opt-in)
    ↓
Reply
```

## Env (production)

```bash
# Prefer Groq for sub-second replies under load:
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-20b   # replaces retired llama-3.1-8b-instant

AI_CHAT_PROVIDER=auto          # groq | gemini | openrouter
AI_CHAT_TEMPERATURE=0.15
# AI_CHAT_USE_GEMINI=true      # only if you want Gemini in the chat chain
# GEMINI_API_KEY=...           # alone = listing vision only (not chat)

# Free fallback
OPENAI_API_KEY=...             # OpenRouter
OPENAI_MODEL=openrouter/free
```

**Do not** point Plug chat at local Ollama on a shared CPU box — requests queue and WhatsApp feels “stuck” at 30–60s.

## Grounding prompt

Injected every turn (`ai-prompts.js` → `buildGroundedSystemPrompt`):

- Rely **exclusively** on CONTEXT + TOOL RESULTS
- If missing: offer escalation (no invented policies/stock)
- Includes `USER PHONE / THREAD ID` for session continuity

## Knowledge / pgvector

1. Keyword RAG over `whatsapp-bot/knowledge/*.md` (always on)
2. Optional: `db/schema-phase16-pgvector-knowledge.sql` → `platform_knowledge`
3. Migrate: phase16 is **fail-soft** if `CREATE EXTENSION vector` is unavailable

Seed / query helpers: `knowledge-rag.js` (`retrievePlatformKnowledge`, `upsertKnowledgeChunk`).

## Diagnostics

| Symptom | Cause | Action |
|---------|--------|--------|
| Replies 15+s | Slow free OpenRouter / no Groq-Gemini | Set `GROQ_API_KEY` or `GEMINI_API_KEY` |
| Mixes rules/prices | High temp / weak grounding | Keep `AI_CHAT_TEMPERATURE=0.15`; redeploy prompts |
| Invents features | Empty context | Check knowledge files + tools; escalate path |
| Lost conversation | Wrong session key | Ensure webhook passes WhatsApp sender as `customerKey` |

## Deploy

```bash
# On bot VM
SKIP_WAHA_DEPLOY=1 SKIP_CATALOG_PUBLISH=1 bash scripts/deploy-bot.sh
# Optional knowledge table (when vector extension exists):
# psql $DATABASE_URL -f whatsapp-bot/db/schema-phase16-pgvector-knowledge.sql
```

Smoke: `node whatsapp-bot/scripts/test-ai-latency-grounding.mjs`
