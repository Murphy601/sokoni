# Depop-style social discovery — status

What is wired on Sokoni today (static `website/` + Express bot — not Next.js). Platform fee remains **10%**.

## Already wired

| Feature | Status |
|---|---|
| Hearts / Saved bag | ♡ on cards + bag sheet; dual-write to `product_likes` |
| Follow sellers | Shop profile follow + WA notify |
| In-app offers / inbox | Separate slices — bargain cards + escrow |
| Refresh listing button | Seller dashboard ↻ Refresh |
| Verified seller badge | WhatsApp-linked / seller verified flag |
| Prepaid escrow copy | Cards, checkout, shop policy note |

## Shipped in this slice

| Feature | What landed |
|---|---|
| Aesthetic / vibe filters | Homepage `#Y2K`…`#Minimalist` chips; match tags/era/title |
| Bump → feed | Refresh updates JSON + `products.updated_at` / `refreshedAt`; feed ranking recency boost |
| Top seller badge | ★ Top seller when avg rating ≥ 4.8 and ≥ 20 reviews |
| Shop trust metrics | Reviews + ships prepaid + escrow; final-sale / misdescribe policy note |
| Listing escrow note | Product sheet buyer-protection line |
| Seller era options | Expanded aesthetics on listing form |

## Deferred (needs more product work)

| Feature | Why deferred |
|---|---|
| Named saved collections | Bag is a single flat list today |
| Price-drop notify to likers | Needs reliable seller price-edit → notify pipeline |
| Bundle % off (2+ same shop) | Prepaid flow is one-item-at-a-time |
| Buyer “My Sizes Only” | No buyer size profile yet |
| Fake response-time / ships-in-2-days meters | No measured signal — would invent trust |
| Seller return-policy toggles | Global escrow + final-sale note for now |
