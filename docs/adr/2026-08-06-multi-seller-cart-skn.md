# ADR: Multi-seller cart with SKN parent + per-line children

## Status
Accepted (Phase 0 locked 2026-08-06)

## Context
Sokoni live commerce is one product → one `SK-####` → one STK → one escrow/payout.
Buyers need a multi-seller bag that pays once via M-Pesa while sellers fulfill independently.

## Decisions
1. **IDs:** Parent `SKN-{seq}`; children `SKN-{seq}-{n}` (1-based), one child per line item.
2. **Fees:** Platform commission **per child line**; M-Pesa transaction fee **once** on parent total.
3. **Persistence:** Extend `orders.json` first (`cartOrders` + child rows in `orders`). Postgres dual-write later.
4. **Seller alerts:** After M-Pesa paid webhook only.
5. **Refunds:** Manual admin first; auto B2C later.
6. **Flag:** `multiSellerCart` (env `MULTI_SELLER_CART=1` or platform-flags).

## Consequences
- Single-item `SK-####` path remains default and untouched when flag off.
- Checkout/track/STK accept parent `SKN-####` and child `SKN-####-n`.
- Escrow release / B2C continue to run on **child** orders (per-item commission already stored).
