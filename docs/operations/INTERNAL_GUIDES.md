# Sokoni Mall — Internal Operations Guides

Staff, rider, and admin reference templates. Customer-facing copy lives in `whatsapp-bot/src/services/trust-copy.js`.

## Rider delivery protocol

1. **Digital only** — Never collect cash or personal M-Pesa from customers. Customer pays Buy Goods Till **4775847** (David Thuku Muiruri) only.
2. **Inspect before payment** — Hand package to customer; allow unpack and verification before pointing to Till on delivery slip.
3. **Verify payment** — Customer replies *paid* on WhatsApp or shows M-Pesa SMS. Do not leave until admin confirms or customer shows valid receipt.
4. **Rejections** — If damaged/wrong item, pack safely and return. Customer owes nothing (zero upfront deposit policy).

## Admin M-Pesa verification (Till 4775847)

1. Open Safaricom M-Pesa Business portal for Till **4775847** (David Thuku Muiruri).
2. Match inbound amount to order `priceKes` when rider marks delivered.
3. Validate customer code (UK… / UL…) against ledger; confirm date matches delivery.
4. Run `#payconfirm SK-xxxx` then `#notify-store SK-xxxx` when verified.
5. Never confirm from screenshots alone if ledger shows no entry within 5 minutes.

## Fraud & prank orders

Do not dispatch when: vague addresses, repeated rider abandonments, or incoherent spam. Suspend queue → voice-verify → block if uncooperative.

## Offers policy

All customer promotions are capped at **3% off** (code **SOKONI3**). No free-delivery vouchers or flat KES discounts in automated messaging.

## Contact (public)

- WhatsApp / calls: **+254 117 422 428** (`254117422428`)
- Email: **support@sokonimall.com**
- Till: **4775847** (David Thuku Muiruri)
