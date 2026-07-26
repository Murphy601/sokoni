# Phase 1 — PostgreSQL Database

Foundation for the Depop-style Sokoni marketplace: **users, sellers, products (new + pre-loved), orders, payments, shipments**.

## What was added

| Path | Purpose |
|------|---------|
| `whatsapp-bot/db/schema.sql` | Full PostgreSQL schema |
| `whatsapp-bot/src/db/pool.js` | Connection pool |
| `whatsapp-bot/src/db/migrate.js` | Apply schema |
| `whatsapp-bot/src/db/product-mapper.js` | DB ↔ legacy catalog shape |
| `whatsapp-bot/src/db/repositories/products.js` | Product queries |
| `whatsapp-bot/src/db/repositories/sellers.js` | Seller helpers |
| `whatsapp-bot/src/routes/productsApi.js` | REST API |
| `scripts/migrate-catalog-to-db.mjs` | Import `products.json` → Postgres |
| `docker-compose.db.yml` | Local Postgres 16 |

## Product fields (marketplace-ready)

- **Condition enum:** `brand_new_with_tags`, `brand_new_without_tags`, `like_new`, `gently_used`, `fair_condition`
- **`is_secondhand`** — filter Brand New vs Pre-Loved
- **`stock_quantity`** — 1 for unique thrift pieces; >1 for retail
- **`product_images`** — 1–4 URLs per listing (Phase 4 upload UI)
- **Private fields kept in DB:** `source_price_kes`, `source_url` (never returned by public API)

## Setup (VM or local)

```bash
# 1. Start Postgres
docker compose -f docker-compose.db.yml up -d

# 2. Configure bot
cd whatsapp-bot
cp .env.example .env   # if needed
# Add: DATABASE_URL=postgresql://sokoni:sokoni@localhost:5432/sokoni

npm install

# 3. Apply schema + import catalog (~1,540 items)
cd whatsapp-bot
npm run db:migrate
npm run db:seed

# 4. Restart bot
npm start
```

## Verify

```bash
curl http://localhost:3001/health
# → dbEnabled: true, dbConnected: true

curl http://localhost:3001/api/products/meta
curl "http://localhost:3001/api/products?limit=5"
curl http://localhost:3001/api/products/pt-001
```

## Behaviour when DATABASE_URL is unset

- Bot **continues using** `whatsapp-bot/src/data/products.json` (no breaking change)
- `/api/products` returns `503 database_not_configured`

## VM production notes

Use a managed Postgres or install on the VM. Example:

```
DATABASE_URL=postgresql://sokoni:STRONG_PASSWORD@127.0.0.1:5432/sokoni
```

Run migration once after deploy. WhatsApp `#add` still writes JSON today — Phase 2 will write to DB directly.

## Restore catalog on website

Website still reads `website/data/products.json` (currently paused). Phase 2 will either:

- export DB → JSON via build script, or
- site reads `/api/products` directly

To unpause storefront later: set `"paused": false` in `website/data/catalog-paused.json` and rebuild.
