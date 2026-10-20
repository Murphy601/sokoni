# Depop-style social discovery — status

What is wired on Sokoni today (static `website/` + Express bot — not Next.js). Platform fee remains **10%**.

## Already wired

| Feature | Status |
|---|---|
| Hearts / Saved bag | ♡ on cards + bag sheet; dual-write to `product_likes` |
| Follow sellers | Shop profile follow + WA notify |
| In-app offers / inbox | Bargain cards + escrow checkout |
| Dual feed (Explore / Following) | Homepage tabs; Following = shops you follow |
| Refresh listing button | Seller dashboard ↻ Refresh |
| Drop price + liker alerts | Seller ↓ Drop price; WA ping to users who liked the item |
| In-chat / dashboard counter offers | Seller Counter locks a middle buyer-total as accepted (24h checkout) |
| Shipping QR / drop-off label | Post-sale label page |
| AI listing draft (vision tags) | Gemini/OpenRouter on upload |
| Verified seller badge | WhatsApp-linked / seller verified flag |
| Prepaid escrow copy | Cards, checkout, shop policy note |

## Shipped earlier

| Feature | What landed |
|---|---|
| Aesthetic / vibe filters | Homepage `#Y2K`…`#Minimalist` chips; match tags/era/title |
| Bump → feed | Refresh updates JSON + `products.updated_at` / `refreshedAt`; feed ranking recency boost |
| Top seller badge | ★ Top seller when avg rating ≥ 4.8 and ≥ 20 reviews |
| Shop trust metrics | Reviews + ships prepaid + escrow; final-sale / misdescribe policy note |
| Listing escrow note | Product sheet buyer-protection line |
| Seller era options | Expanded aesthetics on listing form |

## Still deferred / partial

| Feature | Why deferred |
|---|---|
| Seller Stories / 15s video posts | Optional listing video exists; no Stories UI or 15s feed playback |
| Get the Look multi-item tags | Not built |
| Visual search (image match) | Future / complex |
| Material + decade micro-filters | Aesthetic chips only; decades/materials not fully wired as filters |
| "Saved by Y / In X bags" card badges | Like counts on shop; no product-card social-proof chips yet |
| Cross-listing inventory sync | Not built |
| Named saved collections | Bag is a single flat list today |
| Bundle % off (2+ same shop) | Prepaid flow is one-item-at-a-time |
| Buyer “My Sizes Only” | No buyer size profile yet |
| Fake response-time / ships-in-2-days meters | No measured signal — would invent trust |
| Seller return-policy toggles | Global escrow + final-sale note for now |
