# Seller payouts — operating runbook

What actually happens when a seller withdraws, why a human is currently in the
loop, and how to get the human back out.

## Current state

`PAYSTACK_ONLY=true`, `SELLER_PAYOUT_RAIL=paystack`. Daraja B2C is configured
and `isB2CReady()` returns true, but it is not the active rail.

The Paystack account is on **Starter Business**, which does not expose the
Transfer API. So a withdrawal cannot complete itself: the money is real, the
ledger line is real, but the last hop is an admin sending it by hand.

```
buyer pays (Paystack C2B / M-Pesa STK)
        │
        ▼  escrow held
delivery confirmed  →  seller wallet "Ready for M-Pesa"
        │
        ▼  seller taps Withdraw
withdrawal row queued, settlement line LOCKED
        │
        ▼  ← ADMIN STEP: send M-Pesa, then #paid
settlement marked paid, seller notified
```

Locking matters: `lockSettlementsForAdminQueue` stops the same Ready line being
withdrawn twice while it sits in the queue.

## The admin step

1. Check the queue — `#payouts` on the admin WhatsApp line, or the Finances
   desk at `/admin-finances.html`.
2. For each request, confirm against the ledger:
   - the order is `delivered` or buyer-confirmed
   - no open dispute (`payoutStatus` must not be `held_for_dispute`)
   - the payout number matches the seller's registered M-Pesa number
3. Send the M-Pesa transfer manually from the business account.
4. Record it: `#paid SKN-####` on the admin line.

Only step 4 closes the loop. Sending money without `#paid` leaves the line
locked and the seller un-notified, and the next reconciliation will look like
an unpaid backlog.

### Do not

- Do not `#paid` before the money has actually left. It marks the settlement
  paid and releases the lock.
- Do not pay a seller whose shop is paused or suspended — `quarantineSellerSettlements`
  exists for exactly this and in-flight payouts are quarantined on PAUSE/SUSPEND.
- Do not pay from a personal number.

## Getting the human out of the loop

Two routes, either works.

### A. Upgrade Paystack (preferred)

Move off Starter Business so the Transfer API is available, then:

```bash
PAYSTACK_TRANSFERS=true
SELLER_WITHDRAW_INSTANT_PAYSTACK=true
```

`initiateSettlementPaystack` already handles recipient creation, splitting
amounts over KES 250,000, and applying `transfer.success` / `failed` /
`reversed` from the webhook. Nothing new needs writing — it is gated on the
account tier, not on code.

### B. Switch the payout rail back to Daraja B2C

```bash
PAYSTACK_ONLY=false
SELLER_PAYOUT_RAIL=b2c
MPESA_B2C_AUTO=true          # or leave false and use #payb2c per payout
```

B2C initiator `DavidMuiruri` on shortcode 3439153 is configured and the result
and timeout callbacks are live.

**Known constraint before you try this.** PR #245 raised that `3439153` may be
C2B-only on the Safaricom side, which surfaces as `Invalid Access Token` or a
shortcode-whitelist rejection on the B2C call rather than as a clear error.
If B2C rejects:

- confirm with Safaricom that the shortcode is enabled for **B2C**, not just C2B
- confirm the `SecurityCredential` was generated for `DavidMuiruri` specifically
  — a credential generated for a different org user fails the same way
- `bash scripts/diagnose-daraja-b2c.sh` and `bash scripts/test-daraja-b2c-ready.sh`

Do not flip `MPESA_B2C_AUTO=true` until one manual `#payb2c` has succeeded
end to end.

## Rider payouts are separate

Riders are on Daraja B2C already and run automatically: KES 200 floor,
KES 5,000 daily cap, KES 1,500 single-fee manual review, exponential retry to
8 attempts. `scripts/…` not needed — the scheduler in `server.js` drives it
every 30 minutes. Nothing in this runbook applies to them.

## Reconciliation

Seller money lives in `whatsapp-bot/data/settlements.json` on the VM, not in
Postgres. Statuses: `scheduled → owed → disbursing → paid`, plus `quarantined`.

- `listOwedPayouts()` — what is due
- `listDisbursingPayouts()` — sent but unconfirmed
- `healReleasedSellerPayouts(supplierId)` — repairs historical admin Releases
  that left funds stuck as `scheduled`

Because it is file-backed, the nightly `scripts/backup-bot-data.sh` snapshot is
the only recovery path for payout state. Confirm it is actually installed:

```bash
crontab -l | grep backup-bot-data
```

Off-site target defaults to a private git repo — free, no payment method. See
`docs/BACKUP_SETUP.md`.
