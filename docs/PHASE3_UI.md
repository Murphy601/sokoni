# Phase 3+ — Depop storefront shell

Homepage (`index.html`) uses a **Depop-style shell** aligned with prepaid + brand new / pre-loved marketplace positioning.

## Layout

| Element | File |
|---------|------|
| Black sticky header + prepaid banner | `assets/css/depop-shell.css` |
| Category strip (Women, Men, Pre-Loved, Brand New…) | `index.html` + `assets/js/depop-nav.js` |
| Compact hero banner | `depop-shell.css` |
| Photo grid first (`#deals`) | `index.html` |
| Mobile bottom nav (Home, Explore, Sell, Inbox, Profile) | `depop-shell.css` |

## Copy model

- **100% prepaid** escrow — not pay-on-delivery
- **Brand new & pre-loved** item types via browse filters
- Product cards show **PREPAID** badge (not COD)
- Legacy marketing blocks (features, how-it-works, WhatsApp float) hidden via `.depop-marketing-extra`

## Viewport

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```

Root font scaling: `depop-shell.css` uses `clamp()` on mobile for readable Android sizing.

## JS hooks

- `SokoniApp.setCatalogFilter()` — category strip filters
- `SokoniShopShell.openBag()` — bag from header / bottom nav
- Search synced across `#depop-search`, `#depop-search-mobile`, legacy `#hero-search`
