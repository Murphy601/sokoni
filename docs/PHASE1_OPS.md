# Phase 1 — Ops: migration, rollback, monitoring

Operational notes for the social marketplace foundation (schema phase10 + seller/buyer session hardening).

## Migrate (forward)

Additive SQL: `whatsapp-bot/db/schema-phase10-social.sql` (applied by `npm run db:migrate` / `#db migrate` / `POST /admin/ops/db/migrate`).

```bash
cd whatsapp-bot
# DATABASE_URL must be set
npm run db:migrate
```

Safe to re-run: uses `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / enum guards.

Creates/extends:

- User social profile columns (`handle`, `shop_name`, bio, balances, …)
- Product `size_label`, `gender_fit`, `seller_user_id`
- `follows`, `product_likes`, `offers`, `messages`, `order_reviews`
- `offer_reminders`, `offer_handled_queue`, `offer_handled_queue_events`

File-backed sessions (not Postgres):

- Seller OTP: `whatsapp-bot/data/seller-verification-store.json` (gitignored under `whatsapp-bot/data/`)
- Buyer OTP: `whatsapp-bot/data/buyer-verification-store.json`

## Env flags

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | unset | Social DB features need Postgres |
| `BUYER_AUTH_MODE` | `soft` | `soft` \| `hard` \| `off` |
| Seller verification | existing seller OTP env | Unchanged |

Roll forward to hard buyer auth only after [`PHASE1_QA.md`](PHASE1_QA.md) auth table passes:

```bash
BUYER_AUTH_MODE=hard
```

## Rollback

Schema is additive — prefer feature flags over dropping tables in production.

1. **Disable buyer session enforcement:** `BUYER_AUTH_MODE=off` (or keep `soft` for legacy `?viewer=`).
2. **Disable social UI entry points** if needed (shop/inbox links) without dropping tables.
3. **Hard schema rollback (staging only):** drop social tables/columns only if no production data depends on them:

```sql
-- DANGEROUS — staging/dev only. Order matters for FKs.
DROP TABLE IF EXISTS offer_handled_queue_events;
DROP TABLE IF EXISTS offer_handled_queue;
DROP TABLE IF EXISTS offer_reminders;
DROP TABLE IF EXISTS order_reviews;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS offers;
DROP TABLE IF EXISTS product_likes;
DROP TABLE IF EXISTS follows;
-- Optional column drops omitted; keep user/product columns unless recreating DB.
```

4. Restart bot after env changes: `bash scripts/deploy-bot.sh` (or process manager restart).

## Monitoring

| Signal | Where | Alert if |
|--------|-------|----------|
| Bot liveness | `GET /health/live` | Non-200 |
| DB connectivity | `GET /health` → `dbConnected` | `false` while `dbEnabled` true |
| Buyer OTP send failures | Bot logs `[buyer-verification]` | Sustained send/rate-limit spikes |
| Seller OTP failures | Bot logs `[seller-verification]` | Same |
| Offer reminder cooldown | API `429 reminder_cooldown_active` | Unexpected flood of 429s from one seller |
| Handled queue audit | `GET /api/social/offers/handled/events` | Missing events after mark/reset |
| Auth failures | API `401 session_*` / `403 *_session_mismatch` | Spike after deploy (clients missing tokens) |
| Chat moderation blocks | Chat send error responses | Sudden block-rate change |

Suggested post-deploy checks:

```bash
curl -s "$BOT/health"
cd whatsapp-bot && npm run test:social
# Seller inbox + one buyer offer smoke from PHASE1_QA.md
```

## Related docs

- [`PHASE1_DATABASE.md`](PHASE1_DATABASE.md) — API contracts
- [`PHASE1_QA.md`](PHASE1_QA.md) — manual E2E checklist
- [`PHASE9_OPS.md`](PHASE9_OPS.md) — admin migrate/seed commands
