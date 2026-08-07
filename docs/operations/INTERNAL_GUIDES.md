# Sokoni Mall — Internal Operations Guides

Staff, rider, and admin reference templates. Customer-facing copy lives in `whatsapp-bot/src/services/trust-copy.js`.

## Rider delivery protocol

1. **Digital only** — Never collect cash or personal M-Pesa from customers. Customer pays Buy Goods Till **3439153** (SOKONIMA) only.
2. **Inspect before payment** — Hand package to customer; allow unpack and verification before pointing to Buy Goods Till on delivery slip.
3. **Order ID** — Every paid order has an **SKN-####** (or older **SK-####**). Quote it on every handoff.
4. **No side deals** — Do not accept personal Till or Send Money for Sokoni orders.
5. **Verify payment** — Customer replies *paid* on WhatsApp or shows M-Pesa SMS. Do not leave until admin confirms or customer shows valid receipt.
6. **Rejections** — If damaged/wrong item, pack safely and return. Customer owes nothing for COD; prepaid disputes go through escrow / admin.

## Admin M-Pesa verification (Till 3439153)

1. Open Safaricom M-Pesa Business portal for Buy Goods Till **3439153** (SOKONIMA).
2. Match amount + account reference (order id) to the pending claim.
3. Validate customer code (UK… / UL…) against ledger; confirm date matches.
4. Confirm in WhatsApp admin with `#payconfirm SKN-…` when STK callback did not auto-confirm.
5. Never confirm from screenshots alone if ledger shows no entry within 5 minutes.

## Fraud & prank orders

Do not dispatch when: vague addresses, repeated rider abandonments, or incoherent spam. Suspend queue → voice-verify → block if uncooperative.

## Offers policy

All customer promotions are capped at **3% off** (code **SOKONI3**). No free-delivery vouchers or flat KES discounts in automated messaging.

## Contact (public)

- WhatsApp / calls: **+254 117 422 428** (`254117422428`)
- Email: **support@sokonimall.com**
- Till: **3439153** (SOKONIMA)
