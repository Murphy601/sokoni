# Phase 3 — Depop storefront shell

Homepage (`index.html`) uses a **Depop-style layout** with Sokoni design tokens (cream / purple / WhatsApp green actions).

## Slices

1. **Shell baseline** — prepaid trust banner, token-aligned chrome, shippable bottom nav
2. **Buyer profile page** — `profile.html`, WhatsApp session, saved count, Profile tab
3. _(next)_ Cross-page shell parity (shop, activity, inbox share header/nav)
4. _(later)_ Hero media polish without cluttering first viewport

## Layout

| Element | File |
|---------|------|
| Sticky header + prepaid banner | `assets/css/depop-shell.css`, `index.html` |
| Category strip (Women, Men, Pre-Loved, Brand New…) | `index.html` + `assets/js/depop-nav.js` |
| Compact hero carousel | `depop-shell.css` + `depop-hero-carousel.js` |
| Photo grid first (`#deals`) | `index.html` |
| Mobile bottom nav (Home, Explore, Sell, Inbox, Profile) | `depop-shell.css` + `index.html` / `profile.html` |
| Buyer profile | `profile.html` + `assets/js/buyer-profile.js` |

## Copy model

- **100% prepaid** escrow — not pay-on-delivery
- **Brand new & pre-loved** item types via browse filters
- Product cards show **PREPAID** badge (not COD)
- Legacy marketing blocks (features, how-it-works, WhatsApp float) hidden via `.depop-marketing-extra`

## Visual system

Follow `website/DESIGN.md` / design tokens — Depop is **layout density** inspiration only:

- Surface cream, ink purple, green for actions / focus / Sell
- Display: Fraunces · Body: DM Sans
- Touch targets ≥ 44px; focus-visible rings on shell controls

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
- Search synced across `#depop-search`, `#depop-search-mobile`, legacy `#hero-search`

## Buyer profile (slice 2)

- Page: `/profile.html`
- Reuses buyer WhatsApp OTP panel (same session keys as Activity)
- Shows masked phone, buyer id, local bag saved count
- Sign out calls `POST /api/buyer/auth/sign-out` then clears local session
- Quick links: Activity, Inbox, Track, Sell
- No new bot profile API (editable name/avatar later)

## Quick check

1. Mobile: prepaid green banner visible under header
2. Category chips still filter New arrivals
3. Bottom nav: Explore opens catalog drawer; Inbox → `inbox.html`; Profile → `profile.html`
4. Profile: verify WhatsApp → session card; sign out clears it
5. Sell CTA uses green; no Depop red in shell chrome
6. Product sheet + bag count still work
