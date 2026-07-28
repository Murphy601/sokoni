# Phase 1 — PostgreSQL Database

Foundation for the Depop-style Sokoni marketplace: **users, sellers, products (new + pre-loved), orders, payments, shipments**.

## What was added

| Path | Purpose |
|------|---------|
| `whatsapp-bot/db/schema.sql` | Full PostgreSQL schema |
| `whatsapp-bot/db/schema-phase10-social.sql` | Additive social marketplace foundation (users profile fields, follows, likes, offers, messages, order_reviews, product metadata) |
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
- **`size_label` + `gender_fit`** — mandatory listing metadata for social marketplace cards
- **`stock_quantity`** — 1 for unique thrift pieces; >1 for retail
- **`product_images`** — 1–4 URLs per listing (Phase 4 upload UI)
- **Private fields kept in DB:** `source_price_kes`, `source_url` (never returned by public API)

## New listing create endpoint (Phase 1 foundation)

`POST /api/products/create`

Required fields:

- `title`
- `priceKsh`
- `images` (array, at least one URL for cover)
- `size`
- `condition` (`BRAND_NEW`, `LIKE_NEW`, `GOOD`, `FAIR` or existing Sokoni condition values)
- `genderFit` (`MENS`, `WOMENS`, `UNISEX`, `KIDS`)

Optional:

- `sellerId` (falls back to default seller if omitted)
- `description`, `category`, `subCategory`, `brand`

## Social foundation endpoints (additive)

### Product likes (toggle)

`POST /api/products/like`

Body:

```json
{
  "userId": 1,
  "productId": "prod_xxx"
}
```

Response:

```json
{
  "liked": true,
  "likesCount": 12
}
```

### Follow users (toggle)

`POST /api/social/follow`

Body:

```json
{
  "followerUserId": 1,
  "followingUserId": 2
}
```

### Storefront social stats

`GET /api/social/users/:userId/stats`

Returns:

- followers/following counts
- active listings count
- likes received
- average rating + total reviews

### Offers (Depop-style negotiation)

Create/update pending offer:

`POST /api/social/offers/create`

```json
{
  "productId": "prod_xxx",
  "buyerUserId": 1,
  "sellerUserId": 2,
  "amountKsh": 1200
}
```

Respond (seller):

`POST /api/social/offers/:offerId/respond`

```json
{
  "sellerUserId": 2,
  "action": "accepted"
}
```

List offers:

`GET /api/social/offers?userId=1&role=buyer&status=pending`

### In-app messaging (moderated)

Send message:

`POST /api/social/chat/send`

```json
{
  "senderUserId": 1,
  "receiverUserId": 2,
  "content": "Hi, is this still available?"
}
```

Thread:

`GET /api/social/chat/thread?userAId=1&userBId=2`

Blocked patterns include:

- Kenyan phone numbers (`07...`, `01...`, `+254...`)
- `pay outside`
- `direct till`
- `send cash`

## Setup (VM or local)

```bash
# 1. Start Postgres (VM uses docker-compose v1 — not "docker compose")
bash scripts/start-postgres.sh

# 2. Configure bot
cd whatsapp-bot
# Ensure .env has exactly one line:
# DATABASE_URL=postgresql://sokoni:sokoni@localhost:5432/sokoni
npm install

# 3. Apply schema + import catalog (~1,540 items) — optional; skip db:seed for empty DB
npm run db:migrate
npm run db:seed

# 4. Restart bot
bash ../scripts/deploy-bot.sh
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

Run migration once after deploy. Seller listings (Phase 4) upsert to Postgres on admin approve when `DATABASE_URL` is set.

## Restore catalog on website

Phase 2 loads the storefront from **`/api/products`** when the bot DB is live (see [`PHASE2_BROWSE.md`](PHASE2_BROWSE.md)).

Legacy JSON path (`website/data/products.json`) remains as fallback. To unpause JSON export: set `"paused": false` in `website/data/catalog-paused.json` and rebuild.
