# Phase 9 — Platform ops & admin API

Unified **catalog ops**, **runtime flags**, and a **token-gated REST API** for go-live, pause, sync, stock, and Postgres migration — plus matching WhatsApp `#` commands.

## WhatsApp admin commands

| Command | Action |
|---------|--------|
| `#ops` | Status dashboard + quick reference |
| `#catalog live` | Unpause storefront catalog |
| `#catalog pause` | Pause catalog (empty state on site) |
| `#catalog status` | Pause/live counts |
| `#sync` | Rebuild `website/data/products.json` from master |
| `#sync push` | Build + git commit/push (VM only) |
| `#stock prod_abc in` | Mark product in stock (master + public). Blocked if the SKU was sold. |
| `#stock prod_abc out` | Mark out of stock |
| `#stock prod_abc sold` | Permanently tombstone as sold (sold-skus registry) + sync public catalog |
| `#flags prepaid on\|off` | Toggle prepaid-only checkout |
| `#db migrate` | Run Postgres schema migration |
| `#db seed` | Seed products from master JSON |
| `#db seed-dry` | Validate seed without writes |

All commands require a configured `ADMIN_PHONES` number (same as existing admin console).

## REST API

Base path: `/admin/ops` — token via `?token=` query param.

Token resolution (first match):

1. `ADMIN_SETUP_TOKEN`
2. `SUPPLIER_ADMIN_TOKEN`
3. `TIKTOK_SETUP_TOKEN`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/ops/status` | Full ops snapshot |
| POST | `/admin/ops/catalog/pause` | `{ "reason": "..." }` |
| POST | `/admin/ops/catalog/live` | Unpause catalog |
| POST | `/admin/ops/catalog/sync` | Rebuild public JSON |
| POST | `/admin/ops/catalog/publish` | Build + git push |
| POST | `/admin/ops/stock/:productId` | `{ "inStock": true\|false }` |
| POST | `/admin/ops/flags` | `{ "prepaidOnly", "maintenanceMode", ... }` |
| POST | `/admin/ops/db/migrate` | Run schema migration |
| POST | `/admin/ops/db/seed` | `{ "dryRun": false }` |

### Example

```bash
curl "https://bot.sokonimall.com/admin/ops/status?token=$ADMIN_SETUP_TOKEN"
curl -X POST "https://bot.sokonimall.com/admin/ops/catalog/sync?token=$ADMIN_SETUP_TOKEN"
```

## Runtime flags

Stored in `whatsapp-bot/data/platform-flags.json`:

| Flag | Default | Effect |
|------|---------|--------|
| `prepaidOnly` | `true` | Escrow/STK required before fulfillment |
| `catalogSyncOnPublish` | `true` | Auto-sync on seller publish (future) |
| `maintenanceMode` | `false` | Platform maintenance banner (future) |

`#flags prepaid off` overrides env/config at runtime until changed again.

## Catalog flow

```
whatsapp-bot/src/data/products.json  (master)
        ↓  build-site-catalog.mjs / #sync
website/data/products.json           (public)
        ↓  git push / Cloudflare Pages
sokonimall.com
```

Pause state: `website/data/catalog-paused.json` (`paused: true` → empty storefront).

## Go-live script

Run on the bot VM after seeding master catalog:

```bash
node whatsapp-bot/scripts/phase9-go-live.mjs
node whatsapp-bot/scripts/phase9-go-live.mjs --skip-db    # JSON catalog only
node whatsapp-bot/scripts/phase9-go-live.mjs --dry-run    # DB seed validation
```

Steps: set prepaid flags → unpause → sync public JSON → optional DB migrate/seed.

## Health check

`GET /health` now includes:

- `opsPhase: 9`
- `catalogPaused: true|false`

## Files

| Area | Files |
|------|--------|
| Flags | `whatsapp-bot/src/services/platform-flags.js` |
| Catalog ops | `whatsapp-bot/src/services/catalog-ops.js` |
| WhatsApp handlers | `whatsapp-bot/src/services/platform-admin.js` |
| REST API | `whatsapp-bot/src/routes/adminOpsApi.js` |
| Admin router | `whatsapp-bot/src/services/admin.js` |
| Go-live CLI | `whatsapp-bot/scripts/phase9-go-live.mjs` |
| Build script | `scripts/build-site-catalog.mjs` (payment: `prepaid`) |
| DB seed | `whatsapp-bot/scripts/migrate-catalog-to-db.mjs` |

## Deploy

```bash
bash ~/sokoni/scripts/deploy-bot.sh
```

Cloudflare Pages deploys `website/` on push.

## Test plan

- [ ] `#ops` from admin phone → status with catalog counts
- [ ] `#catalog pause` → site shows empty/paused state
- [ ] `#catalog live` + `#sync` → public JSON rebuilt
- [ ] `#stock prod_xxx out` → product marked unavailable
- [ ] `#flags prepaid off` → legacy COD paths allowed
- [ ] `GET /admin/ops/status?token=...` → JSON snapshot
- [ ] `GET /health` → `opsPhase: 9`, `catalogPaused`
- [ ] `phase9-go-live.mjs --dry-run` on VM with `DATABASE_URL` set

## Note

Master catalog is intentionally empty while the Depop redesign is in progress. Do **not** run go-live until products are re-seeded unless you want an empty live storefront.
