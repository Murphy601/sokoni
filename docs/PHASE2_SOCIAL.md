# Phase 2 — Social Engine & Seller Storefronts (slice 1)

First slice after Phase 1 buyer OTP: **hydrate follow + like state on shop storefronts**, and dual-write homepage/bag hearts to social likes when a buyer session exists.

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

When `SokoniBuyerAuth` has a session, `shop-shell.js` best-effort syncs bag toggles to `/api/products/like` with absolute `liked`. Heart visuals still follow bag state until a later feed-hydration slice.

## Out of scope (next slices)

- Feed / homepage heart hydration from server liked set
- Follower lists / activity feed
- Seller storefront edit UI beyond listing wizard
- WAHA / WhatsApp linking (deferred; not required for this slice)

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
