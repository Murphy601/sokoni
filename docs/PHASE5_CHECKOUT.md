# Phase 5 — Prepaid escrow + Daraja automation

Sokoni Mall is **100% prepaid** for the local catalog. No pay-on-delivery (COD).

When Safaricom **Daraja** is configured, payment confirms **automatically** via STK callback — no admin `#payconfirm` needed.

## Status (on `main`)

| Slice | State |
|-------|--------|
| Core prepaid + Daraja STK + escrow automation | **Done** (merged earlier) |
| Web checkout page + bag totals | **Done** |
| **5.1 Hardening** — STK/callback tests, web status/till UX, COD copy cleanup | This slice |
| Photoroom studio | Deferred until more sellers |
| 5.2 B2C auto seller payout | Stub only — manual `#paid` / withdraw for now |
| Printable drop-off label page | JSON label API only |
| Postgres payment persistence | Schema exists; live path uses `orders.json` |

## Escrow cycle (Depop-style)

```
Buyer checkout → STK push → funds held in escrow
     → prepaid drop-off label / QR generated
     → seller dispatches → In Transit (courier scan)
     → Delivered → seller payout scheduled (2–3 business days)
```

## Buyer flow (WhatsApp)

1. Customer picks an item and sends name, location, phone.
2. Order is created as `awaiting_payment` with `escrowStatus: pending`.
3. **Daraja live:** STK push sent automatically; customer enters M-Pesa PIN.
4. **Daraja callback** (`ResultCode === 0`) → order payment confirmed, product locked, label generated, buyer + seller notified, fulfillment starts.
5. On delivery (`#status SK-#### delivered`), escrow releases and seller payout is **scheduled** for 3 business days later.
6. Hourly cron promotes due payouts to `owed` (`#payouts`).

## Daraja configuration

Set in `whatsapp-bot/.env`:

```env
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_PASSKEY=
MPESA_SHORTCODE=
MPESA_ENV=sandbox
MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline
MPESA_CALLBACK_URL=https://bot.sokonimall.com/api/payments/mpesa-callback
```

Register the callback URL in the [Safaricom Daraja portal](https://developer.safaricom.co.ke/).

**Manual fallback** (Daraja unset): customer pays till + replies `paid` → admin `#payconfirm`. Web checkout shows till details when `GET /api/checkout/meta` reports `darajaConfigured: false`.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/checkout/meta` | Prepaid model, Daraja readiness, till fallback |
| GET | `/api/checkout/SK-1042` | Checkout status for an order |
| GET | `/api/checkout/SK-1042/label` | Prepaid drop-off label / QR payload |
| POST | `/api/checkout/SK-1042/stk` | Initiate Daraja STK push (or `manual_till` when unset) |
| POST | `/api/payments/mpesa-callback` | Safaricom STK callback (auto-confirm) |
| POST | `/api/payments/daraja/callback` | Alias for mpesa-callback |

## Bot commands

| Who | Command | When |
|-----|---------|------|
| Customer | *(automatic)* | STK sent after order placement |
| Customer | `pay` | Retry STK push |
| Customer | `paid` | Manual till fallback only |
| Admin | `#payments` | Unpaid orders or manual claims |
| Admin | `#payconfirm SK-####` | Manual verify (fallback) |
| Admin | `#fulfill SK-####` | Blocked until payment confirmed |
| Admin | `#status SK-#### delivered` | Triggers escrow release + payout schedule |

## Files

| Area | Files |
|------|--------|
| Daraja | `whatsapp-bot/src/services/daraja-mpesa.js` |
| Escrow automation | `whatsapp-bot/src/services/escrow-automation.js` |
| Checkout | `whatsapp-bot/src/services/prepaid-checkout.js` |
| Payments API | `whatsapp-bot/src/routes/paymentsApi.js` |
| Checkout API | `whatsapp-bot/src/routes/checkoutApi.js` |
| Orders | `whatsapp-bot/src/services/orders.js` |
| Settlements | `whatsapp-bot/src/services/settlements.js` |
| WhatsApp flow | `whatsapp-bot/src/services/menu.js`, `webhookHandler.js` |
| Admin | `whatsapp-bot/src/services/admin.js` |
| Web checkout | `website/checkout.html`, `website/assets/js/checkout.js` |

## Smoke

```bash
cd whatsapp-bot
npm run test:daraja-checkout
curl -s https://bot.sokonimall.com/api/checkout/meta | python3 -m json.tool
```

Manual web:
1. Open `/checkout.html?order=SK-####`
2. Without `MPESA_*`: till block + readiness copy (no fake STK)
3. With Daraja: Pay → STK → page polls until `paymentStatus === confirmed`

## Deploy

```bash
bash ~/sokoni/scripts/deploy-bot.sh
```

Cloudflare Pages deploys `website/` automatically on push to `main`.

## Next

- Ops: set live `MPESA_*` + register callback when ready for auto STK
- Later: printable label page, B2C payout wiring, Postgres payment writes
- Phase 6 logistics — see [PHASE6_LOGISTICS.md](./PHASE6_LOGISTICS.md)
