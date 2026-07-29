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

### Buyer WhatsApp auth (soft/hard)

Env: `BUYER_AUTH_MODE=soft|hard|off` (default `soft`).

Auth endpoints:

- `POST /api/buyer/auth/send-code` `{ "phone": "2547XXXXXXXX" }`
- `POST /api/buyer/auth/verify-code` `{ "phone": "2547XXXXXXXX", "code": "123456" }` → `sessionToken` + `userId`
- `GET /api/buyer/auth/session?phone=...&sessionToken=...`
- `POST /api/buyer/auth/sign-out` `{ "phone": "2547XXXXXXXX" }`

Buyer identity contract for social writes:

- Soft (default): if `phone` + `sessionToken` are present, server validates the session and overwrites the identity field (`userId` / `followerUserId` / `buyerUserId` / `senderUserId`) from the verified buyer profile. Legacy client-supplied IDs still work when session is omitted.
- Hard: session required on social write actions; missing/invalid session returns `401`.
- Off: skip buyer session checks.

Clients should send `phone` + `sessionToken` in JSON body (or query for GETs). `X-Buyer-Session` is also accepted.

### Product likes (toggle or set)

`POST /api/products/like`

Body:

```json
{
  "userId": 1,
  "productId": "prod_xxx",
  "liked": true,
  "phone": "2547XXXXXXXX",
  "sessionToken": "buyer-session-token"
}
```

- Omit `liked` → toggle
- `liked: true|false` → set absolute state (idempotent)

Response:

```json
{
  "liked": true,
  "likesCount": 12
}
```

### Liked product subset (feed hydration)

`GET /api/products/likes?productIds=prod_a,prod_b`

Optional: buyer session or `viewer` / `userId` query.

Response:

```json
{
  "userId": 1,
  "likedProductIds": ["prod_a"]
}
```

Unauthed soft mode returns `{ "likedProductIds": [], "userId": null }`.

### Follow users (toggle)

`POST /api/social/follow`

Body:

```json
{
  "followerUserId": 1,
  "followingUserId": 2,
  "phone": "2547XXXXXXXX",
  "sessionToken": "buyer-session-token"
}
```

### Follow graph lists

`GET /api/social/users/:userId/followers`

`GET /api/social/users/:userId/following`

Returns `{ userId, direction, users: [{ userId, handle, shopName, … }], pagination }`.

### Storefront social stats

`GET /api/social/users/:userId/stats`

Returns:

- followers/following counts
- active listings count
- likes received
- average rating + total reviews

### Shop storefront profile by handle

`GET /api/social/shop/:handle`

Optional query: `viewer` / `viewerUserId`, or buyer session (`phone` + `sessionToken`).

Returns:

- `shop` (handle, shopName, bio, avatar, verification status)
- `stats` (listings, followers, following, likes, rating summary)
- `products` (active listings only; includes `liked` when viewer is known)
- `pagination`
- `viewer` (optional): `{ userId, isFollowing, likedProductIds }`

Notes:

- Uses user handle when available, with fallback to seller slug.
- Compatible with both new `seller_user_id` and legacy `seller_id` product ownership.
- Invalid buyer sessions are ignored for this public GET (viewer block omitted).
- See [`PHASE2_SOCIAL.md`](PHASE2_SOCIAL.md) for storefront hydration details.

### Offers (Depop-style negotiation)

Create/update pending offer:

`POST /api/social/offers/create`

```json
{
  "productId": "prod_xxx",
  "buyerUserId": 1,
  "sellerUserId": 2,
  "amountKsh": 1200,
  "phone": "2547XXXXXXXX",
  "sessionToken": "buyer-session-token"
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

Handled queue state (seller quick mode):

Get handled states for selected offers:

`GET /api/social/offers/handled?offerIds=120,121`

Set one offer handled/unhandled:

`POST /api/social/offers/:offerId/handled`

```json
{
  "sellerUserId": 2,
  "handled": true,
  "phone": "2547XXXXXXXX",
  "sessionToken": "seller-session-token"
}
```

Reset handled queue:

`POST /api/social/offers/handled/reset`

Read handled queue audit events:

`GET /api/social/offers/handled/events?offerId=120&action=handled&limit=50&offset=0`

Notes:

- Seller session auth is required for all handled-queue endpoints.
- Handled queue actions are allowed only for offers owned by the authenticated seller profile.
- Marking handled is restricted to accepted, non-expired offers.
- Handled queue transitions are recorded server-side (`handled`, `unhandled`, `reset`) for operational tracing.

List offers:

`GET /api/social/offers?userId=1&role=buyer&status=pending`

Seller role auth note:

- `GET /api/social/offers` with `role=seller` now requires `phone` + `sessionToken`.
- `userId` must match the authenticated seller social profile (or is enforced from session).

Buyer role auth note:

- When buyer `phone` + `sessionToken` are present, `userId` must match the authenticated buyer profile (or is enforced from session).

### In-app messaging (moderated)

Send message:

`POST /api/social/chat/send`

```json
{
  "senderUserId": 1,
  "receiverUserId": 2,
  "content": "Hi, is this still available?",
  "phone": "2547XXXXXXXX",
  "sessionToken": "buyer-session-token"
}
```

Seller send auth note:

- Seller-triggered messages should include `phone` + `sessionToken`.
- When seller session context is present, `senderUserId` must match the authenticated seller profile.

Buyer send auth note:

- Buyer messages should include buyer `phone` + `sessionToken` when available (required in hard mode).
- Chat routes try seller session first when `phone` + `sessionToken` are present; if the token is not a valid seller session, they fall through to buyer auth (same field names).
- When buyer identity is used, `senderUserId` is enforced from the verified buyer profile.

Thread:

`GET /api/social/chat/thread?userAId=1&userBId=2`

Seller thread auth note:

- Seller dashboard thread reads should include `phone` + `sessionToken` query params.
- When seller session context is present, one thread participant (`userAId` or `userBId`) must match the authenticated seller profile.

Buyer thread auth note:

- Buyer thread reads may include buyer `phone` + `sessionToken` query params.
- When buyer session context is present (and seller session is not), one thread participant must match the authenticated buyer profile.

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
  "comment": "Fast delivery and exactly as described.",
  "phone": "2547XXXXXXXX",
  "sessionToken": "buyer-session-token"
}
```

Rules:

- Order must exist in DB (`id` or `trackingCode` accepted)
- Order status must be `delivered` or `completed`
- One review per order
- Buyer session soft/hard gate applies (`buyerUserId` enforced from verified session when present)

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

## Phase 1 closure docs

- [`PHASE1_QA.md`](PHASE1_QA.md) — end-to-end + auth regression checklist
- [`PHASE1_OPS.md`](PHASE1_OPS.md) — migrate / rollback / monitoring

Automated auth regression:

```bash
cd whatsapp-bot && npm run test:social
```
