# Phase 2 — Social Engine & Seller Storefronts

Slices so far:

1. Shop storefront follow/like hydration + bag dual-write
2. Homepage/feed heart hydration from server liked set
3. Follower / following lists on shop profiles
4. Seller storefront profile edit (name, handle, bio, location, avatar URL)
5. Seller shop activity feed (followers + likes)

## What shipped

### Shop profile viewer hydration

`GET /api/social/shop/:handle`

Optional viewer resolution (does not fail the public GET):

1. Buyer WhatsApp session (`phone` + `sessionToken` query / headers), preferred
2. Legacy `?viewer=` / `?viewerUserId=`

When resolved, response includes:

```json
{
  "viewer": {
    "userId": 12,
    "isFollowing": true,
    "likedProductIds": ["prod_abc"]
  },
  "products": [
    { "id": "prod_abc", "liked": true, "likesCount": 4 }
  ]
}
```

Shop page (`website/assets/js/shop-profile.js`) uses this to show **Following** / **♥ Liked** on load, and reloads after OTP verify.

### Absolute like set (bag sync)

`POST /api/products/like`

```json
{
  "userId": 12,
  "productId": "prod_abc",
  "liked": true,
  "phone": "2547XXXXXXXX",
  "sessionToken": "…"
}
```

- Omit `liked` → toggle (existing shop like buttons)
- `liked: true|false` → idempotent set (used by bag / homepage hearts)

### Homepage / product-sheet hearts

Local bag (`sokoni-bag`) stays the guest save-for-later UX.

When `SokoniBuyerAuth` has a session:

1. Bag toggles dual-write to `/api/products/like` with absolute `liked`
2. On homepage load, `GET /api/products/likes?productIds=…` hydrates heart visuals from the server liked set
3. Heart state is **bag ∪ server likes** (`SokoniShopShell.isHearted`)

### Batch liked lookup

`GET /api/products/likes?productIds=id1,id2`

Optional auth: buyer session or `viewer` / `userId` query (soft mode).

```json
{ "userId": 12, "likedProductIds": ["prod_abc"] }
```

### Follower / following lists

`GET /api/social/users/:userId/followers`

`GET /api/social/users/:userId/following`

Returns `{ userId, direction, users[], pagination }`.

Shop page Followers / Following counters open an inline list with links to each handle.

### Seller storefront profile edit

`PATCH /api/social/shop/profile` (seller session)

Body fields (all optional): `handle` / `shopHandle`, `shopName` / `businessName`, `bio`, `avatarUrl`, `location` / `city`.

Updates `users` storefront fields, soft-syncs linked `sellers` row + JSON supplier handle/name so session auth still resolves.

Seller dashboard (`suppliers/list.html`) has a Shop profile form under the profile bar.

### Seller shop activity

`GET /api/social/activity` (seller session)

Returns recent `{ type: "follow"|"like", actor, product?, createdAt }` events for the signed-in seller.

Dashboard shows a Shop activity panel with refresh.

## Out of scope (next slices)

- Buyer-facing activity / notifications center
- Push / WhatsApp notification delivery for social events
- WAHA / WhatsApp linking (deferred; not required for storefront slices)

## Quick checks

```bash
cd whatsapp-bot
node --check src/db/repositories/social.js
node --check src/routes/socialApi.js
node --check src/routes/productsApi.js
npm run test:social
```

Manual:

1. Open `shop.html?handle=<seller>` signed out → Follow hidden / likes prompt verify
2. Verify WhatsApp → shop reloads with `viewer` → Follow / Liked state matches DB
3. Toggle follow + like → refresh → state persists
4. With session, homepage ♡ still saves to bag and dual-writes social like
5. Tap Followers / Following on a shop → list loads with handle links
6. Seller dashboard → Shop activity shows new follows/likes
