# Phase 4 — Depop-Style Seller Listing (instant publish)

Approved **suppliers** list products themselves. The flow mirrors Depop: upload media → add details → set price → **Post listing** → **live instantly**. There is no admin pre-approval gate.

Post-publish **automated moderation** scans listings after go-live and can hide policy violations (off-platform contact, prohibited items). Admins can restore or takedown via flagged listings API.

Legacy admin catalog intake (`#add`, `catalog-admin.js`) remains removed.

## Seller workflow

```
[ 1. Upload media ] → [ 2. Title, description & tags ] → [ 3. Category & attributes ]
         → [ 4. Pricing & location ] → [ 5. Post listing → LIVE ]
```

| Step | What the seller does |
|------|----------------------|
| Media | Up to 4 photos + optional video. First photo = cover. AI auto-fills from cover photo. |
| Details | Title, description, up to 5 style hashtags, up to 2 brand tags |
| Attributes | Browse category/subcategory, condition, size, colour, era |
| Pricing | Supply price → retail shown. Dispatch city. |
| Post | **Instant publish** to shop + WhatsApp catalog. Optional **Save draft**. |

## Files

| Path | Purpose |
|------|---------|
| `whatsapp-bot/src/services/listing-generator.js` | AI vision draft from photo |
| `whatsapp-bot/src/services/seller-listings.js` | Instant publish, drafts, catalog sync |
| `whatsapp-bot/src/services/listing-moderation.js` | Post-publish scan, hide/restore |
| `whatsapp-bot/src/routes/sellerListingsApi.js` | Seller REST API |
| `website/suppliers/list.html` | Depop-style 5-step wizard |
| `website/assets/js/seller-listing.js` | Wizard client |
| `website/assets/css/depop-sell.css` | Wizard styles |

## Seller API

Auth = approved supplier `phone`. No admin token.

```
POST /api/seller/listings/generate
  { phone, imageBase64, mimeType?, caption? }

POST /api/seller/listings/publish
  { phone, draft, images[], videoBase64?, draftId? }
  → { productId, status: "live" | "hidden_pending_review", product }

POST /api/seller/listings/draft
  { phone, draft, images[], videoBase64? }

GET /api/seller/listings?phone=254...
GET /api/seller/listings/meta
```

## Admin moderation API

```
GET  /admin/suppliers/seller-listings/flagged?token=...
POST /admin/suppliers/seller-listings/:productId/takedown?token=...
POST /admin/suppliers/seller-listings/:productId/restore?token=...
```

## Moderation rules (automated)

- Off-platform contact: phone numbers, URLs, WhatsApp/Telegram/social links
- Prohibited items: weapons, drugs, counterfeits, etc.
- Missing title, price, or image

Failed scans → listing hidden (`inStock: false`), seller + admin notified on WhatsApp.

## On publish

1. Product added to `products.json` + Postgres (if configured)
2. Catalog unpause if `catalog-paused.json` was set
3. Site catalog rebuild (`build-site-catalog.mjs`)
4. Optional git auto-push (`CATALOG_AUTO_PUSH=true`)
5. Async moderation scan

## Verify

```bash
cd whatsapp-bot
node scripts/test-listing-generator.mjs
curl https://bot.sokonimall.com/api/seller/listings/meta
```

## Next: Phase 5.1

Safaricom Daraja STK push — see [PHASE5_CHECKOUT.md](./PHASE5_CHECKOUT.md).
