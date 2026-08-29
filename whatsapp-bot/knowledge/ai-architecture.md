# Sokoni AI architecture (for RAG)

Sokoni’s WhatsApp AI uses four tiers. Updating any tier does **not** erase the model’s general ability — it updates instructions and facts.

1. **Command router** — ACCEPT, PICKUP, CONFIRM, WAYBILL, PARTIAL_REFUND, balance run as code before the AI.
2. **System prompt** — Sokoni Bot identity, safety, escrow/rider Stable Facts (`ai-prompts.js`).
3. **Dynamic context** — each freeform turn gets the user’s role and recent SKN orders.
4. **Knowledge RAG** — FAQs and policies from `knowledge/*.md` (optional pgvector table).

The AI never moves M-Pesa money or enters OTPs itself. It answers in KES and points people to exact commands when they try to act in freeform chat.
