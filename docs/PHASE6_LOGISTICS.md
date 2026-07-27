# Phase 6 — Logistics & SK-#### tracking

Depop-style prepaid drop-off adapted for **Kenya hubs and couriers** (Fargo, Pickup Mtaani, Sendy, G4S — manual adapter first, live APIs later).

## Shipment lifecycle

```
PAID → label_ready → dropped_off → in_transit → at_pickup_point → delivered
```

| Status | Meaning |
|--------|---------|
| `label_ready` | Prepaid label / QR generated after M-Pesa (Phase 5) |
| `dropped_off` | Seller dropped parcel at Sokoni hub (scan) |
| `in_transit` | Courier or rider has the parcel |
| `at_pickup_point` | Ready for buyer collection |
| `delivered` | Escrow released · seller payout scheduled |

## Hub scan (admin)

WhatsApp admin commands:

```
#scan SK-1042                    → advance one step
#scan SK-1042 in_transit hub:Umoja
#scan SK-1042 delivered
#transit SK-1042 rider:John phone:0712… eta:2 hours  → in_transit + rider alert
```

HTTP (token-gated):

```
POST /admin/shipments/SK-1042/scan?token=...
Body: { "status": "in_transit", "hub": "Umoja", "courier": "fargo" }
```

## Public tracking

| Method | Path |
|--------|------|
| GET | `/api/tracking/meta` |
| GET | `/api/tracking/SK-1042` — sanitized payload (no payment secrets) |

**Website:** [track.html](../website/track.html) — enter SK-####, fetches live status from bot API.

**WhatsApp:** Customer types `SK-1042` or `track` — shipment timeline when order is paid.

## Courier adapters

`whatsapp-bot/src/services/couriers/` — registry with manual stub. Swap in Fargo / Pickup Mtaani API clients without changing order flow.

## Files

| Area | Files |
|------|--------|
| Shipments | `whatsapp-bot/src/services/shipments.js` |
| Couriers | `whatsapp-bot/src/services/couriers/` |
| Tracking API | `whatsapp-bot/src/routes/trackingApi.js` |
| Admin scans | `whatsapp-bot/src/routes/adminShipments.js`, `admin.js`, `ops-admin.js` |
| DB mirror | `whatsapp-bot/src/db/repositories/shipments.js` |
| Website | `website/track.html`, `website/assets/js/track.js` |

## Deploy

```bash
bash ~/sokoni/scripts/deploy-bot.sh
```

Cloudflare Pages deploys `website/` on push to `main`.

## Test plan

- [ ] Pay order (Phase 5) → `shipmentStatus: label_ready`
- [ ] `#scan SK-####` → `dropped_off` → customer WhatsApp update
- [ ] `#scan SK-#### in_transit` → timeline shows In transit
- [ ] `#status SK-#### delivered` → shipment + escrow release
- [ ] `GET /api/tracking/SK-####` → public JSON
- [ ] `track.html?order=SK-####` → live stepper
- [ ] Customer types SK-#### in WhatsApp → shipment timeline

## Next: Phase 7

Unified AI layer — see [PHASE7_AI.md](./PHASE7_AI.md).
