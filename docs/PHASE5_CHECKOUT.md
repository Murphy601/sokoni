# Phase 5 — Prepaid-only checkout (escrow)

Sokoni Mall is **100% prepaid** for the local catalog. No pay-on-delivery (COD).

Safaricom **Daraja** (M-Pesa STK push) will be integrated in Phase 5.1 — the plumbing is in place now.

## Buyer flow

```
Browse → Order details → Pay upfront (escrow) → Verified → Packed → Delivered → Seller paid
```

1. Customer picks an item and sends name, location, phone.
2. Order is created as `awaiting_payment` with `escrowStatus: pending`.
3. Customer receives M-Pesa payment instructions (manual till until Daraja STK is live).
4. Customer replies `paid` → admin `#payconfirm SK-####` → payment held in escrow.
5. Fulfillment starts only after payment is confirmed.
6. On delivery, escrow releases and seller payout is recorded.

## Daraja (coming soon)

Set in `whatsapp-bot/.env`:

```env
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_PASSKEY=
MPESA_SHORTCODE=
MPESA_CALLBACK_URL=https://bot.sokonimall.com/api/checkout/daraja/callback
```

When configured, `POST /api/checkout/:orderId/stk` will trigger STK push instead of manual till copy.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/checkout/meta` | Prepaid model, Daraja readiness |
| GET | `/api/checkout/SK-1042` | Checkout instructions for an order |
| POST | `/api/checkout/SK-1042/stk` | STK stub (501 until Daraja wired) |

## Bot commands (unchanged)

- Customer: `paid` after M-Pesa payment
- Admin: `#payconfirm SK-####` → verifies payment, starts fulfillment
- Admin: `#payments` → pending payment claims
- Admin: `#fulfill SK-####` → blocked until payment confirmed

## Files

| Area | Files |
|------|--------|
| Checkout service | `whatsapp-bot/src/services/prepaid-checkout.js` |
| API | `whatsapp-bot/src/routes/checkoutApi.js` |
| Orders | `whatsapp-bot/src/services/orders.js` — `awaiting_payment`, `paymentModel`, `escrowStatus` |
| WhatsApp flow | `whatsapp-bot/src/services/menu.js` — prepaid order path |
| Copy | `whatsapp-bot/src/services/trust-copy.js` |
| Payments | `whatsapp-bot/src/services/payment.js` |
| Admin | `whatsapp-bot/src/services/admin.js` — payconfirm gates fulfillment |

## Deploy

```bash
bash ~/sokoni/scripts/deploy-bot.sh
```

Cloudflare Pages deploys `website/` automatically on push to `main`.

## Test plan

- [ ] Place order on WhatsApp → status `awaiting_payment`, prepaid checkout message
- [ ] `#fulfill` before `#payconfirm` → blocked
- [ ] Customer `paid` → `#payconfirm` → order moves to confirmed, fulfillment plan applied
- [ ] `GET /api/checkout/meta` → `prepaidOnly: true`, `darajaConfigured: false`
- [ ] Website FAQ/terms say prepaid escrow, not COD
