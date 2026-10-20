# Sokoni Mall — Internal Operations Guides

Staff, rider, and admin reference templates. Customer-facing copy lives in `whatsapp-bot/src/services/trust-copy.js`.

## Rider delivery protocol

Every Sokoni order is **already paid** before it reaches a rider. Riders collect nothing at the door.

1. **Collect no money, ever** — Do not take cash, do not take M-Pesa, do not share a till. The buyer paid at checkout and the funds sit in Sokoni escrow. A rider asking for money is grounds for suspension.
2. **Order ID** — Every paid order has an **SKN-####** (or older **SK-####**). Quote it on every handoff.
3. **Pickup** — Take custody only after the seller gives you the 4-digit Pickup OTP: reply *PICKUP SKN-#### ####*.
4. **Let the buyer inspect** — Hand over the parcel and give the buyer time to open and check it before you ask for their code.
5. **Delivery** — The buyer gives you their 4-digit Delivery OTP: reply *CONFIRM SKN-#### ####*. That code is what releases escrow — never ask for it before the buyer has the goods in hand.
6. **No side deals** — Never accept a personal Till or Send Money for a Sokoni order, even if the buyer offers.
7. **Rejections** — If the item is damaged or wrong, do not take the delivery code. Pack it safely, return it, and the buyer opens a dispute; escrow refunds them from the held funds.

## Admin M-Pesa verification (Till 3439153)

1. Open Safaricom M-Pesa Business portal for Buy Goods Till **4775847** (David Thuku Muiruri).
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
- Till: **4775847** (David Thuku Muiruri)
