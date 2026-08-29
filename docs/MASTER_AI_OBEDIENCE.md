# Master AI Obedience Architecture (Sokoni)

Multi-layer authority so the Boss line controls the platform **in code**, not by hoping the LLM obeys a prompt.

## Layers

```
Incoming WhatsApp / REST
        │
        ▼
 Identity: ADMIN_PHONES (WA) or MASTER_ADMIN_SECRET / ADMIN_SETUP_TOKEN (API)
        │
   ┌────┴────┐
   │ Boss    │ Regular user
   ▼         ▼
 ! / OVERRIDE:     Standard escrow / OTP / AI
 code interceptor  + PUBLIC_ESCROW_GUARDRAIL prompt
 (no LLM)
   │
   ▼
 Freeform Boss chat → ADMIN SYSTEM PROMPT (executive tone;
 mutations still via ! short-codes)
```

## WhatsApp short-codes (`ADMIN_PHONES` only)

| Command | Effect |
|---------|--------|
| `!force-release SKN-####` | Escrow release (same as `OVERRIDE: RELEASE`) |
| `!override-state SKN-#### STATUS` | Force order status (`force: true`) |
| `!ban-user +254…` / `!unban-user +254…` | Session ban flag (+ rider suspend/verify if found) |
| `!agent-mode MUTE\|ACTIVE +254…` | Silence / resume bot on a chat |
| `!system-pause` / `!system-resume` | Catalog + auto-dispatch pause |
| `FORCE_PAYOUT SKN-####` | Alias for release |
| `OVERRIDE: …` | Long-form aliases (still supported) |
| `!help` | Palette |

## REST

`POST /admin/command/master`  
Headers: `X-Admin-Token` or `X-Master-Admin-Secret`  
Body: `{ "command": "!force-release SKN-8820" }`

## Env

```bash
# Always use international Kenya format (Meta/WAHA send 254…, not 07…)
ADMIN_PHONES=254757764009
# Optional aliases (also accepted; normalized to 254… on boot):
# ADMIN_PHONES=0757764009
# BOSS_PHONES=254757764009,+254757764009
MASTER_ADMIN_SECRET=long-random    # optional permanent dashboard secret
ADMIN_SETUP_TOKEN=…                # existing Command Center token (still valid)
ADMIN_BOSS_TITLE=Boss              # optional honorific
# ADMIN_PHONE_DEBUG=1              # log Incoming Phone on every admin identity check
```

Matching accepts `254757764009`, `0757764009`, and `+254757764009` via last-9 national tail so WAHA/Meta formats never miss the Boss line.

## Explicit identity injection

When `isAdminSender` / `staff_roles` matches SUPER_ADMIN, `messages[0]` (system) gets an **EXECUTIVE DIRECTIVE** with the verified sender phone — salutation required ("Yes, Boss."), mutations still via `!` / `OVERRIDE:` interceptor only. Shoppers get `PUBLIC_ESCROW_GUARDRAIL` instead (no override powers).

## What this does *not* do

- The LLM never executes SQL or escrow mutations — only the interceptor does.
- Shoppers never receive the admin system prompt or command palette.
- Spoofing protection remains WhatsApp sender ID + configured `ADMIN_PHONES` (and token on REST).
