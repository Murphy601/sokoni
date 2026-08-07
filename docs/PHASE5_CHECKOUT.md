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
MPESA_CONSUMER_KEY=           # VM only — never commit; Copy from Prod-SOKONIMALL
MPESA_CONSUMER_SECRET=
MPESA_PASSKEY=                # Lipa Na M-Pesa Online passkey for shortcode 3439153
MPESA_SHORTCODE=3439153       # BusinessShortCode (org H.O.)
MPESA_TILL_NUMBER=4775847     # PartyB — Buy Goods till (David Thuku Muiruri)
MPESA_TILL_NAME=David Thuku Muiruri
# MPESA_PARTY_B=4775847       # optional override for PartyB
MPESA_ENV=production
MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline
MPESA_CALLBACK_URL=https://bot.sokonimall.com/api/payments/daraja/callback
```

**Ops on the bot VM:** keys are **not** in git. Prefer portal **Copy** into a file (avoids chat/OCR typos):

```bash
# /tmp/daraja-keys.txt — 3 lines: Consumer Key, Consumer Secret, Passkey
bash scripts/apply-daraja-keys-from-file.sh /tmp/daraja-keys.txt
bash scripts/test-daraja-oauth.sh
```

Deploy (`SKIP_CATALOG_PUBLISH=1 bash scripts/deploy-bot.sh`) re-applies shortcode/till mapping and **keeps** existing keys in `.env`.

**HTTP 400 on OAuth** (even with Key len 48 / Secret 64) means Safaricom does not accept that Key:Secret pair. Re-Copy from the portal, regenerate keys, confirm Lipa Na M-Pesa Online / M-Pesa Express is on the app, or contact `apisupport@safaricom.co.ke`. Org API roles do not fix OAuth.

**Seller wallet / withdraw:**
- `ESCROW_HOLD_BUSINESS_DAYS=0` (default) — on delivery / buyer confirm, credit **Ready for M-Pesa** on the Seller Hub immediately.
- Seller **Withdraw** triggers Daraja B2C instantly when initiator `SOKONIMA` + SecurityCredential are set (`SELLER_WITHDRAW_INSTANT_B2C=true`). Otherwise withdraw queues for admin `#paid`.
- Configure B2C on the VM (password never committed):
  1. Download `ProductionCertificate.cer` from Daraja → `whatsapp-bot/certs/`
  2. `export MPESA_INITIATOR_PASSWORD='…'` then `bash scripts/configure-b2c-initiator.sh`
  3. `bash scripts/test-daraja-b2c-ready.sh`
- Bot calls production B2C at `https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest` (Safaricom go-live list).
- Admin Command Center shows Ready / scheduled / B2C failed and can **Pay B2C** or **Release → Ready**.
- Leave `MPESA_B2C_AUTO=false` until the first `#payb2c` / withdraw B2C succeeds.

**Till vs shortcode (Buy Goods — Sokoni live):**
- `MPESA_SHORTCODE=3439153` — Daraja / org H.O. → STK `BusinessShortCode` + password
- Merchant store shortcode `4421485` — portal hierarchy only (not sent on STK)
- `MPESA_TILL_NUMBER=4775847` — Buy Goods till → STK `PartyB` (money lands here)

Proven working combo from live logs: `businessShortCode: 3439153`, `partyB: 4775847`, `CustomerBuyGoodsOnline`.

**Web username vs API:** portal web login is not STK auth. STK uses Consumer Key/Secret/Passkey. Initiator username is for B2C only.

Register callback `https://bot.sokonimall.com/api/payments/daraja/callback` on the Daraja app.

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
