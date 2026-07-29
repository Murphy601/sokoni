# Phase 3 — Depop storefront shell

Homepage (`index.html`) uses a **Depop-style matte dark shell**: black chrome, scarlet CTAs, emerald only for escrow/trust chips.

## Slices

1. **Shell baseline** — token-aligned chrome, shippable bottom nav
2. **Buyer profile page** — `profile.html`, WhatsApp session, saved count, Profile tab
3. **Cross-page shell parity** — shared header + bottom nav on activity / inbox / shop / track / profile
4. **Hero polish** — brand-first hero; curated chips below New arrivals
5. **Depop dark fix** — remove neon top banner, matte black + `#FF2300` CTAs, auto-play hero carousel (no lockup graphic)

Phase 3 UI slices above are **complete**. Later product work is Phase 4+.

## Layout

| Element | File |
|---------|------|
| Sticky header (no green trust strip) | `assets/css/depop-shell.css`, `index.html`, `shell-chrome.js` |
| Category strip (Women, Men, Pre-Loved, Brand New…) | `index.html` + `assets/js/depop-nav.js` |
| Hero carousel (buyers / sellers / escrow) | `depop-shell.css` + `depop-hero-carousel.js` |
| Photo grid first (`#deals`) | `index.html` |
| Curated collections | after `#deals` (not in first viewport) |
| Mobile bottom nav (Home, Explore, Sell, Inbox, Profile) | `depop-shell.css` + `index.html` / `shell-chrome.js` |
| Buyer profile | `profile.html` + `assets/js/buyer-profile.js` |
| Shared subpage chrome | `assets/js/shell-chrome.js` |

## Copy model

- **100% prepaid** escrow — not pay-on-delivery
- **Brand new & pre-loved** item types via browse filters
- Product cards show **PREPAID** badge (not COD)
- Legacy marketing blocks (features, how-it-works, WhatsApp float) hidden via `.depop-marketing-extra`

## Visual system (storefront shell)

- Surface matte black `#000` / elevated `#09090b`
- Primary CTA scarlet `#FF2300` (Sell, hero primary)
- Emerald only for escrow / Pre-Loved trust accents
- Logo: heavy sans `SOKONI.` (not serif lockup / bucket graphic)
- Touch targets ≥ 44px; focus-visible rings on shell controls
- Theme toggle kept; shell chrome stays Depop-dark

## Hero rules (slice 4)

First viewport composition:

1. Brand mark **Sokoni** (hero-level)
2. One headline
3. One short supporting sentence
4. CTA group: Shop finds + Start selling
5. Full-bleed atmosphere + lockup visual (desktop)

No carousel dots, no promo chips on the hero. Entrance motion respects `prefers-reduced-motion`.

## Viewport

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
```

Root font scaling: `depop-shell.css` uses `clamp()` on mobile for readable Android sizing.

## JS hooks

- `SokoniApp.setCatalogFilter()` — category strip filters
- `SokoniCatalogNav.open()` — Explore bottom-nav item (falls back to `index.html#deals`)
- `SokoniShopShell.openBag()` — bag from header
- `SokoniBuyerAuth` — profile / activity / inbox WhatsApp session
- `SokoniShellChrome` — mounts compact header + bottom nav on subpages
- Search synced across `#depop-search`, `#depop-search-mobile`, legacy `#hero-search`

## Quick check

1. Mobile first viewport: Sokoni brand + headline + CTAs (no curated chip row)
2. Category chips still filter New arrivals
3. Bottom nav: Explore / Inbox / Profile work
4. Profile: verify WhatsApp → session card; sign out clears it
5. Activity / Inbox / Shop / Track share prepaid banner + bottom nav
6. Hero entrance animates; reduced-motion shows static state
7. Product sheet + bag count still work
