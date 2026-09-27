# Shipping & delivery (sellers + buyers)

## Buyers
- After prepaid M-Pesa escrow, local orders may go with a Sokoni-pinned rider (Pickup OTP at the seller, Delivery OTP at your door). Upcountry orders use seller courier / waybill.
- Track with your SKN-#### (or older SK-####). Rider contact appears when a rider has accepted.
- Damaged / wrong item: reply HELP SKN-#### or DISPUTE SKN-#### — escrow is held; send photos for support.
- After delivery confirmation, funds stay briefly in hold (about 15 minutes on local rider jobs) before payout rails run.

## Sellers — set delivery prices

Only for **upcountry** orders. Local rider deliveries inside the Nairobi metro
are priced by Sokoni on distance and a seller's rates do not apply to them —
see `delivery-pricing.md` before answering any question about a fee.

1. Seller Hub → Shipping Rates.
2. Add zones: e.g. local metro vs upcountry Kenya.
3. Save. Quotes at checkout use these zones automatically.
4. Local rider orders: Sokoni pins the rider — sellers do not choose riders. Hand over only after the rider shows/asks for the Pickup OTP.
5. Upcountry: reply *WAYBILL SKN-#### Courier Tracking* and send **two** pre-shipment photos (packaged+waybill receipt, item before sealing).

## What the AI can do
- Explain steps and read shipping / tracking from CONTEXT or LOOKUP RESULTS.
- Never work out a local delivery fee in conversation. It depends on the
  distance between two pins; say how it is calculated and that checkout shows
  the exact figure.
- It will not invent rates, OTPs, or pin riders. Mutations go through WhatsApp commands or Seller Hub (authenticated).
- If a user tries to accept/pickup/confirm in freeform text, point them to the exact command format.
