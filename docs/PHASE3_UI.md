# Phase 3 — Depop-Style Mobile Shop UI

Mobile-first browse experience: fixed top shop bar, 2-column product grid, product detail sheet, and saved-items bag.

## What was added

| Path | Purpose |
|------|---------|
| `website/assets/css/depop-ui.css` | Mobile shop bar, Depop grid, bottom sheets |
| `website/assets/js/shop-shell.js` | Top bar: browse, search, Sell, saved-items bag |
| `website/assets/js/product-sheet.js` | Product detail bottom sheet + save + WhatsApp CTAs |
| `website/assets/js/app.js` | Depop cards, grid → sheet, `window.SokoniApp` bridge |
| `website/index.html` | Shop bar markup, sheets, `depop-product-grid` |

## Mobile behaviour (< 768px)

1. **Fixed shop bar** — ☰ browse (opens Phase 2 catalog drawer), search, **Sell** (`suppliers.html`), bag 🛍️
2. **Hero search hidden** — search lives in the shop bar only
3. **Floating Browse button hidden** — replaced by ☰ in shop bar
4. **2-column grid** — compact Depop-style cards; tap opens product sheet
5. **Saved items bag** — localStorage key `sokoni-bag`; not a checkout cart — order via WhatsApp

## Desktop behaviour (≥ 768px)

- Existing sticky header unchanged
- Shop bar hidden
- Grid expands to 4 columns
- Legacy floating Browse button remains

## Product detail sheet

- Full image, price, browse path, condition, description, reviews
- **Order — Pay on Delivery** → pre-filled `wa.me` link
- **Save for later** → adds to bag (♥ Saved)
- **Ask on WhatsApp** → question template

## Deep links

| URL param | Effect |
|-----------|--------|
| `?text=` or `?q=` | Pre-fill search, scroll to deals |
| `?product=sk-xxxx` | Filter to item + open product sheet |

Example: `https://sokonimall.com/?product=sk-0042`

## Catalog empty state

When `website/data/catalog-paused.json` has `"paused": true`, the grid stays hidden and `#catalog-refresh-empty` shows the rebuild message. Shop bar and sheets still work; bag persists saved IDs for when catalog returns.

## JS API (for extensions)

```javascript
window.SokoniApp.getStoreProducts()  // current visible catalog
window.SokoniApp.formatPrice(product)
window.SokoniApp.runSearch(query)

window.SokoniShopShell.toggleBag(productId)
window.SokoniShopShell.openBag()
window.SokoniProductSheet.open(product)
```

## Deploy

Cloudflare Pages deploys `website/` automatically on push to `main`. No VM step for Phase 3.

## Next: Phase 4

AI listing generator (Gemini Vision) — photo → title, price, category, browse path.
