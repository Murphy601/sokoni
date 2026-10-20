# Master AI Obedience Architecture (Sokoni)

Multi-layer authority so the Boss line controls the platform **in code**, not by hoping the LLM obeys a prompt.

## Layers

```
Incoming WhatsApp / REST
        │
        ▼
 Identity: ADMIN_PHONES / hardwired last-9 757764009 / MASTER_ADMIN_SECRET
        │
   ┌────┴────┐
   │ Boss    │ Regular user
   ▼         ▼
 Natural verbs / ! / OVERRIDE:     Standard escrow / OTP / AI
 code interceptor (no LLM, no RAG)  + PUBLIC_ESCROW_GUARDRAIL
   │
   ▼
 Freeform Boss chat → Boss-only system prompt (no “I don’t have those details”)
```

## Natural executive commands (code interceptor)

| Command | Effect |
|---------|--------|
| `FORCE RELEASE SKN-####` | Escrow release to seller (OTP bypass) |
| `REFUND BUYER SKN-####` | Full buyer refund path |
| `SPLIT ESCROW SKN-#### 50 50` | Record split + release/refund rails |
| `PAUSE PAYOUTS @handle` | Seller payout hold |
| `VERIFY SHOP @handle` | Verified badge on |
| `SUSPEND SHOP @handle reason` | Freeze shop + hide listings |
| `SET COMMISSION @handle 3` | Force commission % |
| `HIDE ITEM product_id` | Takedown one listing |
| `REASSIGN RIDER SKN-#### +254…` | Flag / force reassign |
| `FORCE RETURN SKN-####` | Return-to-vendor protocol |
| `UNBAN RIDER +254…` | Clear rider suspension |
| `STATUS` / `BRIEFING` | Executive briefing |
| `SYSTEM PAUSE` / `SYSTEM RESUME` | Catalog + dispatch halt |
| `CLEAR SESSION +254…` | Reset stuck chat state |
| `SET MODE MANUAL\|AUTOMATED +254…` | Mute / unmute bot on a chat |
| `OVERRIDE TEST` / `PING` | Connectivity probe |
| `!force-release` / `OVERRIDE: …` | Legacy aliases |

## Why “I don’t have those exact details…” happened

That line is the **public RAG grounding rule**. Boss freeform was falling through to the shopper LLM+knowledge path. Fix:

1. Natural verbs route to the **code interceptor** before AI
2. Admin LLM turns **drop knowledge/RAG** and use a Boss-only system prompt that forbids that refusal

## Env

```bash
ADMIN_PHONES=254757764009
# Hardwired last-9 757764009 always matches even if env is wrong
MASTER_ADMIN_SECRET=long-random
ADMIN_BOSS_TITLE=Boss
# Webhook auth (at least one in production)
WEBHOOK_HMAC_KEY=shared-with-waha
# Optional Meta Cloud API dual-path
META_APP_SECRET=from-meta-app-dashboard
```

## Audit + dead-man UI

- Every `FORCE RELEASE` / `REFUND BUYER` / `SUSPEND SHOP` / `PAUSE PAYOUTS` writes **`admin_logs`** (Postgres) and mirrors into `audit_logs` when order-linked.
- Module: `src/services/boss-intercept.js` (pre-LLM) → `executeMasterAdminCommand` → `admin-logs.js`
- Dead-man panel: **Boss payout override** on `/admin-command.html` (Overrides tab) and `/admin-finances.html` — calls `POST /admin/command/escrow/:id/release` (no WhatsApp required).
- Fleet desk: `/admin-riders.html` · Finances: `/admin-finances.html`

## Deploy

```bash
SKIP_WAHA_DEPLOY=1 bash scripts/deploy-bot.sh
```

Then text: `OVERRIDE TEST` → expect `Yes, Boss. Executive routing is live…`
Text: `FORCE RELEASE SKN-…` → escrow release + `admin_logs` row (DB online).
