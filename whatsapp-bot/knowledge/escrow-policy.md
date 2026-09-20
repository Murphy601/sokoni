# Sokoni escrow & payment policy

## Why there is no cash on delivery
Sokoni runs an automated M-Pesa escrow system. It protects buyers from scams and fake goods, and protects sellers from prank orders and delivery theft. Cash handovers leave no record and no way to reverse a bad delivery, so they are not offered.

## How escrow works for a buyer
1. Buyer pays by M-Pesa STK push at checkout (or the Buy Goods till when STK fails).
2. Sokoni holds the funds. The seller does **not** receive the money at this point.
3. Seller packs and dispatches; a Sokoni-pinned rider collects, or the seller ships upcountry by courier.
4. Buyer inspects the parcel on arrival, then releases it: local orders by giving the rider the 4-digit Delivery OTP, upcountry orders by replying *YES SKN-####*.
5. Funds move to the seller only after that confirmation, or after the inspection window closes with no dispute.

## Inspection window
- Local rider delivery: **24 hours** from delivery.
- Upcountry seller-courier delivery: **48 hours** from delivery.
- The exact window for an order is `autoReleaseHours` on that order — quote the order's own value when a lookup returns it.
- Local rider fees additionally sit in a 15-minute HOLD_ESCROW window before the rider is paid.
- Terms §7 accepts wrong/damaged/not-as-described claims for up to 48 hours either way. If escrow has already auto-released, the claim is still valid — it is settled manually by support. Never tell a buyer they are too late.

## Refund guarantee
A buyer who receives a wrong, damaged, or counterfeit item raises it on WhatsApp inside the inspection window. Sokoni freezes the seller payout, collects evidence photos, and refunds to M-Pesa when the claim holds up. Buyers reply *HELP SKN-####* or *DISPUTE SKN-####* to freeze escrow.

## What the AI must never do
Never quote a refund amount, never release escrow, and never promise a payout date. Open the dispute and let support decide.
