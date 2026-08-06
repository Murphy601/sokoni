# Multi-seller cart runbook (SKN)

## Enable (Phase 9)

On the VM bot `.env`:

```bash
MULTI_SELLER_CART=1
```

Or via admin flags:

```bash
curl -X POST https://bot.sokonimall.com/admin/ops/flags \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"multiSellerCart":true}'
```

Redeploy bot **without** WAHA bounce:

```bash
cd ~/sokoni
SKIP_WAHA_DEPLOY=1 bash scripts/deploy-bot.sh
```

Rollback: set `MULTI_SELLER_CART=0` / `multiSellerCart:false` and redeploy. Single-item `SK-####` keeps working.

## Buyer flow

1. Save items in website bag → **Order cart on WhatsApp**
2. Bot shows fee summary (10% **per line**, one M-Pesa fee)
3. Buyer sends name + landmark + phone
4. Parent `SKN-####` created; children `SKN-####-1`, `-2`, …
5. One STK for parent total → escrow held per child
6. Sellers notified **only after paid**, each with their child IDs
7. Track parent or any child on `/track.html?order=SKN-…`

## Admin manual refund (child line)

```bash
curl -X POST https://bot.sokonimall.com/api/cart/admin/refund-child \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"childId":"SKN-8921-2","reason":"damaged on arrival"}'
```

Marks child `escrowStatus=refunded`, `refundPendingManual=true`. Process M-Pesa refund manually until auto B2C exists.

## Fee rules

- Platform commission: **per child line** (10% of that line’s sellerNet+shipping)
- M-Pesa txn fee: **once** on sum of line charges (parent STK)
- Seller B2C payout: child’s `sellerPayoutKes` (already net of that line’s commission)

## Fee test

```bash
cd ~/sokoni/whatsapp-bot && node scripts/test-cart-fees.mjs
```
