# Phase 5 — Prepaid escrow + Daraja automation

Sokoni Mall is **100% prepaid** for the local catalog. No pay-on-delivery (COD).

When Safaricom **Daraja** is configured, payment confirms **automatically** via STK callback — no admin `#payconfirm` needed.

## Status (on `main`)

| Slice | State |
|-------|--------|
| Core prepaid + Daraja STK + escrow automation | **Done** (merged earlier) |
| Web checkout page + bag totals | **Done** |
| **5.1 Hardening** — STK/callback tests, web status/till UX, COD copy cleanup | **Done** |
| Photoroom studio | Deferred until more sellers |
| **5.2 Printable drop-off label** — `label.html` + QR, seller Print label links site page | This slice |
| 5.3 B2C auto seller payout | Stub only — manual `#paid` / withdraw for now |
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
5. On delivery (`#status SKN-####-n delivered` or older `#status SK-#### delivered`), escrow releases and seller payout is **scheduled** for 3 business days later.
6. Hourly cron promotes due payouts to `owed` (`#payouts`).

## Daraja configuration

Set in `whatsapp-bot/.env`:

```env
MPESA_CONSUMER_KEY=           # VM only — never commit
MPESA_CONSUMER_SECRET=
MPESA_PASSKEY=
MPESA_SHORTCODE=3439153       # BusinessShortCode (SOKONIMA)
MPESA_TILL_NUMBER=3439153     # PartyB / account display (same for this Paybill)
MPESA_TILL_NAME=SOKONIMA
# MPESA_PARTY_B=              # optional override for PartyB
MPESA_ENV=production
MPESA_TRANSACTION_TYPE=CustomerPayBillOnline   # Till → CustomerBuyGoodsOnline
MPESA_CALLBACK_URL=https://bot.sokonimall.com/api/payments/daraja/callback
```

**Ops on the bot VM:** after pull, set secrets and restart with `bash scripts/set-daraja-env.sh` (exports `MPESA_CONSUMER_KEY` / `SECRET` / `PASSKEY` first). Retire any leftover `4775847` / personal-till values from `.env`.

**Till vs shortcode:** for Paybill they are usually the same (`3439153`). For Buy Goods merchants, Daraja **Short Code** can be the **H.O.** number (`MPESA_SHORTCODE`) and the **store/till** is `MPESA_TILL_NUMBER` (`PartyB`). If STK fails with “Agent number and Store number … do not match”, set those two correctly from Safaricom Business.

Register the callback URL in the [Safaricom Daraja portal](https://developer.safaricom.co.ke/). Prefer `/daraja/callback` — URLs containing `mpesa` are often rejected. Trim keys/secrets (no quotes/spaces) and match `MPESA_ENV=production` to production Consumer Key/Secret. Ensure the Daraja app has **Lipa Na M-Pesa Online** (STK) enabled for the shortcode — Passkey alone is not enough if the product is missing.

**Manual fallback** (Daraja unset): customer pays till + replies `paid` → admin `#payconfirm`. Web checkout shows till details when `GET /api/checkout/meta` reports `darajaConfigured: false`.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/checkout/meta` | Prepaid model, Daraja readiness, till fallback |
| GET | `/api/checkout/SK-1042` | Checkout status for an order |
| GET | `/api/checkout/SK-1042/label` | Label JSON payload (product, QR, paid gate) |
| … | `https://sokonimall.com/label.html?order=SK-1042` | **Printable** drop-off page (seller Print label) |
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
| Admin | `#payconfirm SKN-####-n` | Manual verify (fallback) |
| Admin | `#fulfill SKN-####-n` | Blocked until payment confirmed |
| Admin | `#status SKN-####-n delivered` | Triggers escrow release + payout schedule |

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
| Printable label | `website/label.html`, `website/assets/js/label.js`, `website/assets/css/label.css` |

## Smoke

```bash
cd whatsapp-bot
npm run test:daraja-checkout
curl -s https://bot.sokonimall.com/api/checkout/meta | python3 -m json.tool
```

Manual web:
1. Open `/checkout.html?order=SKN-####` (or older SK-####)
2. Without `MPESA_*`: till block + readiness copy (no fake STK)
3. With Daraja: Pay → STK → page polls until `paymentStatus === confirmed`
4. After pay: seller dashboard **Print label** → `/label.html?order=SKN-####-n` (QR + print)

## Deploy

```bash
bash ~/sokoni/scripts/deploy-bot.sh
```

Cloudflare Pages deploys `website/` automatically on push to `main`.

## Next

- Ops: set live `MPESA_*` + register callback when ready for auto STK
- Later: B2C payout wiring, Postgres payment writes
- Phase 6 logistics — see [PHASE6_LOGISTICS.md](./PHASE6_LOGISTICS.md) (mostly done; live courier APIs later)
