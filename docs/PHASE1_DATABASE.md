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

- `sellerId` (optional hint; must match authenticated seller session when provided)
- `description`, `category`, `subCategory`, `brand`

Seller auth (required):

- `phone`
- `sessionToken` (or `verificationToken`)

Notes:

- Seller identity is now resolved from verified seller session + shop handle link.
- If `sellerId` is supplied and does not match the authenticated seller profile, request is rejected.

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

### Shop storefront profile by handle

`GET /api/social/shop/:handle`

Returns:

- `shop` (handle, shopName, bio, avatar, verification status)
- `stats` (listings, followers, following, likes, rating summary)
- `products` (active listings only)
- `pagination`

Notes:

- Uses user handle when available, with fallback to seller slug.
- Compatible with both new `seller_user_id` and legacy `seller_id` product ownership.

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
  "action": "accepted",
  "phone": "2547XXXXXXXX",
  "sessionToken": "seller-session-token"
}
```

Send reminder (seller, cooldown enforced server-side):

`POST /api/social/offers/:offerId/remind`

```json
{
  "sellerUserId": 2,
  "phone": "2547XXXXXXXX",
  "sessionToken": "seller-session-token"
}
```

Notes:

- Only accepted offers can be reminded.
- Seller session must match the offer seller profile.
- Cooldown is enforced server-side (returns `429 reminder_cooldown_active` while active).

List offers:

`GET /api/social/offers?userId=1&role=buyer&status=pending`

Seller role auth note:

- `GET /api/social/offers` with `role=seller` now requires `phone` + `sessionToken`.
- `userId` must match the authenticated seller social profile (or is enforced from session).

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

Seller send auth note:

- Seller-triggered messages should include `phone` + `sessionToken`.
- When seller session context is present, `senderUserId` must match the authenticated seller profile.

Thread:

`GET /api/social/chat/thread?userAId=1&userBId=2`

Seller thread auth note:

- Seller dashboard thread reads should include `phone` + `sessionToken` query params.
- When seller session context is present, one thread participant (`userAId` or `userBId`) must match the authenticated seller profile.

Blocked patterns include:

- Kenyan phone numbers (`07...`, `01...`, `+254...`)
- `pay outside`
- `direct till`
- `send cash`

### Order-locked reviews (DB social flow)

Create:

`POST /api/social/reviews/create`

```json
{
  "orderId": "SK-1042",
  "buyerUserId": 1,
  "sellerUserId": 2,
  "rating": 5,
  "comment": "Fast delivery and exactly as described."
}
```

Rules:

- Order must exist in DB (`id` or `trackingCode` accepted)
- Order status must be `delivered` or `completed`
- One review per order

List seller reviews:

`GET /api/social/reviews/seller/:sellerUserId`

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
