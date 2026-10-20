# Phase 15 — Hybrid logistics engine (Path B)

Countrywide county tiers + optional local map zones, wired into existing **Daraja M-Pesa STK** escrow — not Paystack, not Next.js.

## Architecture (safe)

```
Buyer checkout (vanilla + Leaflet CDN)
        │
        ├─ COUNTY_DROPDOWN → 47 counties / 4 tiers
        └─ MAP_PIN → vendor GeoJSON zones (Turf / builtin PIP)
        │
        ▼
POST /api/checkout/calculate-shipping
POST /api/checkout/:orderId/apply-shipping
        │
        ▼
order.shippingKes → orderBuyerTotal() → Daraja STK
        │
        ▼
Seller payout (seller_express) includes shipping via existing escrow / B2C
```

JSON-first profiles (`whatsapp-bot/data/vendor-shipping.json`) so the bot keeps working when `DATABASE_URL` is unset. Postgres + optional PostGIS mirror via `schema-phase15-hybrid-logistics.sql`.

## Phases shipped

| Phase | Deliverable |
|-------|-------------|
| 1 | `kenya-counties.json` (47), SQL schema, migrate seed |
| 2 | Seller Hub `vendor-shipping-manager.js` (rates + zone drawer + heatmap) |
| 3 | Checkout `checkout-delivery-selector.js` (hybrid toggle) |
| 4 | `POST /api/checkout/calculate-shipping` (+ Turf when installed) |
| 5 | `apply-shipping` → order totals → **Daraja STK** (no Paystack) |
| 6 | Tracking live map (poll + optional Socket.io), seller demand points |

## Default behaviour (no breakage)

- Sellers **without** a shipping profile → shipping stays **KES 0** (current “seller arranges delivery”).
- Existing landmark / hub checkout paths remain.
- Live rider GPS is opt-in via admin token `POST /api/tracking/:orderId/rider`.

## Ops

```bash
# Bot deps
cd whatsapp-bot && npm install
node scripts/test-hybrid-shipping.mjs

# When Postgres is enabled
npm run db:migrate
```

## API cheat sheet

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/checkout/locations/counties` | Public 47 counties |
| POST | `/api/checkout/calculate-shipping` | Fee engine |
| POST | `/api/checkout/:id/apply-shipping` | Mutate order before STK |
| GET/POST | `/api/vendor/shipping-rules` | Seller auth |
| POST | `/api/vendor/shipping-zones` | GeoJSON polygon |
| GET | `/api/vendor/analytics/locations` | Heatmap points |
| GET | `/api/tracking/:id/rider` | Public rider poll |
